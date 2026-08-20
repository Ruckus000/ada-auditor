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
import { withUrlsReduced } from '../../../../../../../../services/safe-url';
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

/**
 * The function response has to fit inside the platform's ~4.5MB body limit,
 * shared with the rest of the JSON this route returns. Base64 inflates raw
 * bytes by a third (~3.4MB encoded at this cap), leaving ~1MB of headroom for
 * the pages array, the detail fields and the rest of the envelope under that
 * ~4.5MB ceiling — comfortably under it, not at it.
 */
const MAX_INLINE_SCREENSHOT_BYTES = 2_500_000;

/**
 * The last screenshot the walk wrote, inlined — `'omitted'` when it exists
 * but is too large to inline, null when nothing was captured at all. Three
 * states, not two: a preview with no evidence and a preview whose evidence
 * did not fit are different facts, and the caller needs to tell them apart to
 * answer `screenshotOmitted` correctly.
 */
async function lastScreenshot(
  pages: PageAudit[],
): Promise<{ mimeType: string; base64: string } | 'omitted' | null> {
  const path = [...pages].reverse().find((p) => p.artifacts.screenshotPath)?.artifacts
    .screenshotPath;
  if (!path) return null;
  try {
    const bytes = await readFile(path);
    if (bytes.byteLength > MAX_INLINE_SCREENSHOT_BYTES) {
      return 'omitted';
    }
    return { mimeType: 'image/png', base64: bytes.toString('base64') };
  } catch {
    // A missing file degrades the preview, it does not fail it.
    return null;
  }
}

/** Spreads a `lastScreenshot` result into a response body's fields. */
function screenshotFields(
  screenshot: Awaited<ReturnType<typeof lastScreenshot>>,
): { screenshot: { mimeType: string; base64: string } } | { screenshotOmitted: true } | Record<string, never> {
  if (screenshot === 'omitted') return { screenshotOmitted: true };
  if (screenshot) return { screenshot };
  return {};
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

  // The target's own host plus anything the journey named — the same union
  // `runBrowserAudit` builds, for the same reason.
  const targetUrl = journey.targetUrl as string; // journeyRunRefusal guarantees it
  let targetHostname: string;
  try {
    targetHostname = new URL(targetUrl).hostname;
  } catch {
    // `journeyRunRefusal` only checks that a target string is present, not
    // that it parses — a row written before `targetUrl` was validated at the
    // write end can hold something that is not a URL at all. That is not a
    // runnable journey either, and answering 422 here is the difference
    // between that and a 500 on `new URL()`.
    return Response.json(
      { error: 'journey_not_runnable', requestId, journeyId },
      { status: 422 },
    );
  }
  const allowedHosts = [targetHostname, ...(journey.allowedHosts ?? [])];

  const budget = await consumeRunBudget(getRunCounter());
  if (!budget.allowed) {
    logWarn('run_budget_exceeded', {
      requestId,
      journeyId,
      window: budget.window,
      resetsInSeconds: budget.resetsInSeconds,
    });
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
      steps: validated.data.length,
      pages: result.pages.length,
      durationMs: Date.now() - startedAt,
    });

    return Response.json({
      requestId,
      ok: true,
      pages: pageMeta(result.pages),
      truncatedPages: result.truncatedPages,
      ...screenshotFields(screenshot),
    });
  } catch (error) {
    const partial = error instanceof PartialJourneyError ? error.captured.pages : [];
    const truncatedPages =
      error instanceof PartialJourneyError ? error.captured.truncatedPages : undefined;
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
        // A journey can be truncated and then die; truncation must never go
        // quiet just because the run also failed. Present whenever the error
        // carries captured evidence to read it from, regardless of value.
        ...(truncatedPages !== undefined ? { truncatedPages } : {}),
        // Gated on the code, not only on the error type. `PartialJourneyError`
        // wraps whatever killed the walk, and most of what reaches here is not
        // safe to echo: `UnsafeTargetError` embeds the full page URL —
        // including the query string, where an SSO `?code=` or a reset token
        // lives — and a filesystem error would leak a tmpdir path. Only
        // `journey_step_failed` is built exclusively from the runner's own
        // `Step N ("action") could not …` sentence, which `classifyRunFailure`
        // recognises by anchoring on that exact prefix — so a message reaching
        // this branch is, by construction, one the runner composed and never
        // one that echoes operator- or site-controlled text.
        // Reduced again here, and the comment above is why this is not
        // redundant. It claimed a `journey_step_failed` message is "by
        // construction" free of site-controlled text; that was true of the
        // template and false of what the runner interpolated into it, so this
        // branch shipped Chromium's `net::ERR_… at https://host/cb?code=…`
        // verbatim to an operator. `attemptStep` now reduces URLs at the point
        // it formats the sentence, which is the real fix. This second pass is
        // the cheap half of defence in depth: the next error path that happens
        // to match the classifier's anchor does not get to re-open the hole,
        // and a claim about content is enforced where the content is echoed
        // rather than trusted from three modules away.
        ...(code === 'journey_step_failed' && error instanceof PartialJourneyError
          ? { detail: withUrlsReduced((message.split('\n')[0] ?? '').trim()) }
          : {}),
        pages: pageMeta(partial),
        ...screenshotFields(screenshot),
      },
      { status: 422 },
    );
  } finally {
    await rm(artifactsDir, { recursive: true, force: true }).catch(() => {});
  }
}
