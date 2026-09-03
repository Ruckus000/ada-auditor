import { machinePrincipal } from '../../../../domain/operator';
import {
  SCHEDULED_RUN_NOT_STARTED,
  type ActivityEvent,
  type ScheduledRunNotStarted,
  type StoredJourney,
} from '../../../../domain/platform';
import { DEFAULT_MAX_STARTS_PER_TICK } from '../../../../domain/run-limits';
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

function maxStartsPerTick(): number {
  const configured = Number(process.env.CRON_MAX_STARTS_PER_TICK);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_STARTS_PER_TICK;
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
/**
 * What a refused dispatch is allowed to say about itself.
 *
 * The run route answers `{ error: '<code>' }`, and that code is worth keeping
 * — it is the difference between a spent budget and a malformed journey. But
 * the response comes from over the network, and this value goes into a `jsonb`
 * column and a log line every consumer greps, so nothing from the body is
 * stored verbatim: it must be JSON, it is read up to a cap, and it must match
 * the shape a refusal code has.
 *
 * The allowlist is the control, not the logger's redaction. That matches on
 * the *key*, and nothing about `error` looks secret — so a token arriving
 * there is precisely the case key-based redaction cannot help with. The same
 * check is what stops a newline-bearing "code" forging a second line into the
 * log.
 */
const REFUSAL_CODE = /^[a-z][a-z0-9_]{0,63}$/;

/** Enough for any refusal envelope; anything longer is not one. */
const MAX_REFUSAL_BODY = 4096;

async function refusalCode(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) return 'unreadable_response';

  try {
    // Truncated before parsing rather than after, so an oversized body costs
    // a failed parse instead of the memory to hold it.
    const body = (await response.text()).slice(0, MAX_REFUSAL_BODY);
    const parsed: unknown = JSON.parse(body);
    const code = (parsed as { error?: unknown } | null)?.error;
    return typeof code === 'string' && REFUSAL_CODE.test(code) ? code : 'unreadable_response';
  } catch {
    return 'unreadable_response';
  }
}

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

  // Resolved before anything is claimed. Claiming first meant a tick with no
  // self URL stamped every due journey and then returned 503 without
  // dispatching one of them — the journeys were marked done by a tick that
  // could never have started them.
  const base = selfUrl();
  if (!base) {
    logWarn('cron_tick_no_self_url', {
      requestId,
      note: 'AUDITOR_SELF_URL is unset and no Vercel URL is available, so nothing could be dispatched.',
    });
    return Response.json(
      { error: 'self_url_not_configured', requestId, reconciled },
      { status: 503 },
    );
  }

  const due = await platform.claimDueJourneys(limit);

  const started: string[] = [];
  const failed: string[] = [];

  /**
   * Undoes a claim whose dispatch did not land.
   *
   * `claimDueJourneys` stamps the journey before anything is dispatched, so
   * without this a failed dispatch reads as a completed one and the journey
   * waits for its next window having never run. Releasing is best-effort: if
   * it throws, the tick has already recorded the dispatch as failed, and
   * turning that into a 500 would lose the journeys that did start.
   *
   * Released on a thrown `fetch` as well as on a non-ok response, even though
   * a throw cannot prove the run did not start — a timeout after the run
   * endpoint accepted the request leaves it in flight. The alternative is
   * worse: a genuine connection failure would silently cost the journey its
   * turn. What bounds the risk is that a release does not make the journey due
   * again on the next tick — the claim query gates on `schedule_hour`, so only
   * a second tick inside the same hour, which in practice means a manual one,
   * can pick it up.
   */
  const releaseClaim = async (journeyId: string): Promise<void> => {
    try {
      await platform.releaseJourneyClaim(journeyId);
    } catch {
      logWarn('cron_tick_release_failed', { requestId, journeyId });
    }
  };

  /**
   * Writes an activity event, best-effort.
   *
   * The same stance `releaseClaim` takes, for the same reason: the tick's job
   * is that journeys get audited, and turning a store hiccup into a 500 would
   * lose the ones that did start. A failed write is said out loud and the tick
   * carries on.
   */
  const recordEventSafely = async (event: ActivityEvent): Promise<void> => {
    try {
      await platform.recordEvent(event);
    } catch {
      logWarn('cron_tick_event_write_failed', { requestId, action: event.action });
    }
  };

  /**
   * Records that a due journey did not start.
   *
   * This answers the question `services/activity-view.ts:12-15` raises head-on
   * — "a run is deliberately not an activity event" — and it is not a
   * contradiction. A run that never started has no row to disagree with, which
   * is the whole reason the duplicate-record objection does not apply here,
   * and the tick already writes an event on the other branch.
   */
  const notStarted = async (
    journey: StoredJourney,
    metadata: ScheduledRunNotStarted,
  ): Promise<void> => {
    logWarn('scheduled_run_not_started', { requestId, ...metadata });
    await recordEventSafely({
      ...(journey.clientId ? { clientId: journey.clientId } : {}),
      actor: 'Scheduler',
      action: SCHEDULED_RUN_NOT_STARTED,
      subject: journey.name,
      metadata,
    });
  };

  for (const journey of due) {
    let response: Response;

    try {
      response = await fetch(`${base}/api/audit/run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.AUDITOR_RUN_TOKEN}`,
        },
        body: JSON.stringify({
          journeyId: journey.id,
          environment: journey.environment ?? 'production',
          targetUrl: journey.targetUrl,
          // Sent unconditionally. This used to omit `steps` when they were
          // empty, which is how a claimed stepless journey reached the runner
          // with none and had our fixture login substituted against the
          // client's origin. `claimDueJourneys` cannot hand back a journey
          // without steps now, so the conditional guarded nothing and read as
          // though the tick still expected one.
          steps: journey.steps,
          // Without this a journey that signs in through a provider runs by
          // hand and fails on the timer, which is the shape of bug the shared
          // step cap was created to stop: a difference between two doors into
          // the same run that only shows up once a window.
          ...(journey.allowedHosts ? { allowedHosts: journey.allowedHosts } : {}),
        }),
      });
    } catch {
      // No response arrived, so there is no status to record. `status: null`
      // would claim one came back and said nothing.
      failed.push(journey.id);
      await notStarted(journey, { journeyId: journey.id, code: 'dispatch_error' });
      await releaseClaim(journey.id);
      continue;
    }

    if (!response.ok) {
      failed.push(journey.id);
      // Event first, then the release, so a failing release still leaves the
      // record behind — the record is the only trace a refused run has.
      await notStarted(journey, {
        journeyId: journey.id,
        status: response.status,
        code: await refusalCode(response),
      });
      await releaseClaim(journey.id);
      continue;
    }

    const payload = (await response.json().catch(() => null)) as { requestId?: string } | null;
    started.push(payload?.requestId ?? journey.id);

    // Outside the dispatch's failure handling, and that is the fix rather than
    // tidying. It used to sit inside a `try` whose `catch` pushed to `failed`
    // and released the claim, so a store hiccup after a dispatch that landed
    // recorded a started run as failed *and* handed back the claim on a run
    // that was in flight — inviting a second tick to dispatch it again.
    //
    // The payoff of named actors: an activity feed can distinguish "Alex ran
    // this" from "the schedule ran this".
    await recordEventSafely({
      clientId: journey.clientId,
      actor: 'Scheduler',
      action: 'started a scheduled run',
      subject: journey.name,
      metadata: { requestId: payload?.requestId, journeyId: journey.id },
    });
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
