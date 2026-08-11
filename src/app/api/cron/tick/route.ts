import { machinePrincipal } from '../../../../domain/operator';
import { staleAfterMs } from '../../../../domain/run-staleness';
import { getPlatformStore, getRunStore } from '../../../../integrations/persistence';
import { logInfo, logWarn } from '../../../../services/logger';
import { extractRunToken, isRunAuthorized } from '../../_lib/auth';
import { safeEqual } from '../../_lib/console-session';
import { createRequestId } from '../../_lib/request-id';

/**
 * The scheduler.
 *
 * `compareToBaseline` has always computed what changed between run N and run
 * N-1 — which is the actual product promise, "tell me what broke since last
 * week". Nothing ever triggered run N. Somebody had to remember.
 *
 * ## It dispatches; it does not audit
 *
 * One 300s function cannot walk N journeys through a browser. So this claims
 * the journeys that are due and posts each to `/api/audit/run`, where each gets
 * its own invocation, its own 300s and its own Chromium.
 *
 * That is deliberately *not* the anti-pattern removed from `/api/audit/console`.
 * There, a user's request was rebuilt with a forged Authorization header to
 * reach in-process code. Here a server holding its own machine credential
 * issues a fresh request to obtain separate compute. The first is
 * impersonation; the second is fan-out.
 *
 * ## The dispatches are awaited
 *
 * A serverless function is frozen the moment it responds. Fire-and-forget
 * `fetch` calls would never leave the box, and the failure mode is the worst
 * kind: a scheduler that reports success and audits nothing.
 */

export const runtime = 'nodejs';
// Small on purpose. This route does not audit — if it ever needs 300s,
// something has gone wrong with the fan-out.
export const maxDuration = 60;

const DEFAULT_MAX_STARTS = 3;

function maxStartsPerTick(): number {
  const configured = Number(process.env.CRON_MAX_STARTS_PER_TICK);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_STARTS;
}

/**
 * Where to post the dispatched runs.
 *
 * Never from a request header. `host` and `x-forwarded-host` are attacker-
 * controlled, and this function attaches the machine token to whatever it
 * posts to — so trusting them would hand the token to anyone who could reach
 * the cron endpoint with a spoofed header.
 */
function selfUrl(): string | null {
  const explicit = process.env.AUDITOR_SELF_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() || process.env.VERCEL_URL?.trim();
  return vercel ? `https://${vercel.replace(/\/$/, '')}` : null;
}

/**
 * Vercel sends `Authorization: Bearer $CRON_SECRET`.
 *
 * The run token is also accepted so an operator can tick by hand — useful when
 * a schedule is first set up and nobody wants to wait an hour to find out
 * whether it works.
 */
function authorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const provided = extractRunToken(request);
    if (provided && safeEqual(provided, cronSecret)) return true;
  }
  return isRunAuthorized(request);
}

export async function GET(request: Request) {
  const requestId = createRequestId();

  if (!process.env.CRON_SECRET && !process.env.AUDITOR_RUN_TOKEN) {
    // Never 200. An unauthenticated scheduler that starts browser runs against
    // customer sites is worse than one that does not run.
    return Response.json({ error: 'cron_secret_not_configured', requestId }, { status: 503 });
  }

  if (!authorized(request)) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  // Housekeeping first, and unconditionally: it is cheap, it needs no
  // dispatching, and a run abandoned yesterday should not wait for a journey
  // to be due before the database admits it.
  const reconciled = await getRunStore().reconcileStaleRuns(staleAfterMs());

  const platform = getPlatformStore();
  const limit = maxStartsPerTick();
  const due = await platform.claimDueJourneys(limit);

  const base = selfUrl();
  if (due.length > 0 && !base) {
    logWarn('cron_tick_no_self_url', {
      requestId,
      claimed: due.length,
      note: 'AUDITOR_SELF_URL is unset and no Vercel URL is available, so nothing could be dispatched.',
    });
    return Response.json(
      { error: 'self_url_not_configured', requestId, reconciled },
      { status: 503 },
    );
  }

  const started: string[] = [];
  const failed: string[] = [];

  for (const journey of due) {
    try {
      const response = await fetch(`${base}/api/audit/run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.AUDITOR_RUN_TOKEN}`,
        },
        body: JSON.stringify({
          journeyId: journey.id,
          environment: journey.environment ?? 'production',
          targetUrl: journey.targetUrl,
          ...(Array.isArray(journey.steps) && journey.steps.length > 0
            ? { steps: journey.steps }
            : {}),
        }),
      });

      if (!response.ok) {
        failed.push(journey.id);
        continue;
      }

      const payload = (await response.json().catch(() => null)) as { requestId?: string } | null;
      started.push(payload?.requestId ?? journey.id);

      // The payoff of named actors: an activity feed can now distinguish
      // "Alex ran this" from "the schedule ran this".
      await platform.recordEvent({
        clientId: journey.clientId,
        actor: 'Scheduler',
        action: 'started a scheduled run',
        subject: journey.name,
        metadata: { requestId: payload?.requestId, journeyId: journey.id },
      });
    } catch {
      failed.push(journey.id);
    }
  }

  // A tick that claimed its whole allowance probably left work behind. Said
  // out loud, because a silent cap reads as "everything due has run".
  if (due.length === limit) {
    logWarn('scheduled_runs_deferred', {
      requestId,
      limit,
      note: 'The per-tick cap was reached, so any remaining due journeys wait for the next tick.',
    });
  }

  logInfo('cron_tick', {
    requestId,
    reconciled,
    claimed: due.length,
    started: started.length,
    failed: failed.length,
    actor: machinePrincipal().name,
  });

  return Response.json(
    { requestId, reconciled, claimed: due.length, started, failed },
    { status: 200 },
  );
}
