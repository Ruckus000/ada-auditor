import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { environmentSchema } from '../../../../../../../../domain/contracts';
import { journeyStepSchema } from '../../../../../../../../domain/journey-step';
import { journeyRunRefusal } from '../../../../../../../../domain/platform';
import { firstForbiddenAction } from '../../../../../../../../domain/policy';
import { runJourney } from '../../../../../../../../integrations/browser/journey-runner';
import { PartialJourneyError } from '../../../../../../../../integrations/browser/partial-run';
import type { PageAudit } from '../../../../../../../../integrations/browser/types';
import { getPlatformStore } from '../../../../../../../../integrations/persistence';
import { logInfo, logWarn } from '../../../../../../../../services/logger';
import { consumeRunBudget } from '../../../../../../../../services/run-budget';
import { authorizePrincipal } from '../../../../../../_lib/authorize';
import { createRequestId } from '../../../../../../_lib/request-id';
import { getRunCounter } from '../../../../../../_lib/run-counter';
import { classifyRunFailure } from '../../../../../../_lib/run-failure';

/**
 * Verify a journey's stored steps: the runner minus the audit.
 *
 * Same ownership check, same SSRF/target guards, same `allowedHosts` union and
 * the same action policy as a real run — `runJourney` owns all of those — but
 * no axe scan, no advisory, no scoring, and **nothing persisted**. Verdicts,
 * baselines and the portfolio never see a preview. The response carries the
 * pixels inline instead: throwaway screenshots of a client's authenticated
 * pages must not enter the blob store and its lifecycle.
 *
 * It replays the *stored* steps. The editor saves first, then verifies — one
 * source of truth, no "preview of unsaved steps" variant to disagree with it.
 *
 * It spends the shared run budget. Browser time against a client's live site
 * is the cost `AUDITOR_MAX_RUNS_PER_HOUR` exists to cap, and a preview is
 * exactly that; a free variant would be the loophole.
 */

// Launches Chromium, exactly like the runs route beside it.
export const runtime = 'nodejs';
export const maxDuration = 300;

/** The last screenshot the walk wrote, inlined; null when nothing captured. */
async function lastScreenshot(
  pages: PageAudit[],
): Promise<{ mimeType: string; base64: string } | null> {
  const path = [...pages].reverse().find((p) => p.artifacts.screenshotPath)?.artifacts
    .screenshotPath;
  if (!path) return null;
  try {
    return { mimeType: 'image/png', base64: (await readFile(path)).toString('base64') };
  } catch {
    // A missing file degrades the preview, it does not fail it.
    return null;
  }
}

/** What a screen needs to say "the walk reached these pages" — nothing else. */
function pageMeta(pages: PageAudit[]) {
  return pages.map((p) => ({
    url: p.page.url,
    title: p.page.title,
    statusCode: p.page.statusCode,
  }));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string; journeyId: string }> },
) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId, journeyId } = await params;
  const platform = getPlatformStore();

  const journey = await platform.getJourney(journeyId);
  // Same check as the runs route: naming any journey under any client's URL
  // must not walk it.
  if (!journey || journey.clientId !== clientId || journey.archivedAt) {
    return Response.json({ error: 'journey_not_found', requestId }, { status: 404 });
  }

  const refusal = journeyRunRefusal(journey);
  if (refusal) {
    return Response.json({ error: refusal, requestId, journeyId }, { status: 422 });
  }

  const validated = z.array(journeyStepSchema).safeParse(journey.steps);
  if (!validated.success) {
    return Response.json({ error: 'invalid_journey_steps', requestId, journeyId }, { status: 422 });
  }

  const environment = environmentSchema.safeParse(journey.environment).data ?? 'production';

  // Refused before a browser launches, not at step N of a client's live site.
  const forbidden = firstForbiddenAction(validated.data, environment);
  if (forbidden) {
    return Response.json(
      { error: 'action_not_allowed_here', requestId, action: forbidden },
      { status: 422 },
    );
  }

  const budget = await consumeRunBudget(getRunCounter());
  if (!budget.allowed) {
    return Response.json(
      {
        error: 'run_budget_exceeded',
        requestId,
        window: budget.window,
        resetsInSeconds: budget.resetsInSeconds,
      },
      { status: 429 },
    );
  }

  // The target's own host plus anything the journey named — the same union
  // `runBrowserAudit` builds, for the same reason.
  const targetUrl = journey.targetUrl as string; // journeyRunRefusal guarantees it
  const allowedHosts = [new URL(targetUrl).hostname, ...(journey.allowedHosts ?? [])];

  // Always under tmpdir, never the repo's artifacts/: these files exist only
  // long enough to be read back into the response.
  const artifactsDir = join(tmpdir(), 'preview-artifacts', requestId);
  const startedAt = Date.now();

  try {
    const result = await runJourney({
      journeyId: journey.id,
      environment,
      stepId: 'preview',
      fixtureDir: join(process.cwd(), 'fixtures/journey-app'),
      artifactsDir,
      steps: validated.data,
      targetUrl,
      allowedHosts,
      omitAxTree: true,
      skipScan: true,
    });

    const screenshot = await lastScreenshot(result.pages);
    logInfo('journey_preview', {
      requestId,
      journeyId,
      pages: result.pages.length,
      durationMs: Date.now() - startedAt,
    });

    return Response.json({
      requestId,
      ok: true,
      pages: pageMeta(result.pages),
      truncatedPages: result.truncatedPages,
      ...(screenshot ? { screenshot } : {}),
    });
  } catch (error) {
    const partial = error instanceof PartialJourneyError ? error.captured.pages : [];
    const message = error instanceof Error ? error.message : 'preview_failed';
    const code = classifyRunFailure(message, error instanceof Error ? error.name : undefined);
    const screenshot = await lastScreenshot(partial);

    logWarn('journey_preview_failed', {
      requestId,
      journeyId,
      reason: code,
      pages: partial.length,
      durationMs: Date.now() - startedAt,
    });

    return Response.json(
      {
        requestId,
        ok: false,
        error: code,
        // Only the step sentence `attemptStep` composes — its first line is
        // value-free by construction. Any other error stays a bare code, the
        // same rule the run handler applies.
        ...(error instanceof PartialJourneyError
          ? { detail: (message.split('\n')[0] ?? '').trim() }
          : {}),
        pages: pageMeta(partial),
        ...(screenshot ? { screenshot } : {}),
      },
      { status: 422 },
    );
  } finally {
    await rm(artifactsDir, { recursive: true, force: true }).catch(() => {});
  }
}
