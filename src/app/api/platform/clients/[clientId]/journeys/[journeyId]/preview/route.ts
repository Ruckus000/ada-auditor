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
import { consumePreviewBudget } from '../../../../../../../../services/run-budget';
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
 * It spends a budget — its own, `AUDITOR_MAX_PREVIEWS_PER_HOUR`. Browser time
 * against a client's live site is a real cost and a free variant would be the
 * loophole, so previews are counted; but they are counted separately from
 * audits, because sharing one ceiling made authoring and auditing compete for
 * it. An operator iterating on a stale selector could spend the hour's audits
 * without running one, and the scheduler would then refuse a real client's
 * audit because somebody was typing.
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
 * Every page the walk reached, each with the screenshot taken there — as far
 * as the response can afford.
 *
 * The evidence is per page because the question an operator is answering is
 * per page: "did the path go where I meant at *this* step", not "where did it
 * end". One trailing screenshot answered the second question only, which made
 * a walk that went somewhere unexpected in the middle and recovered look
 * identical to one that went straight there.
 *
 * The budget is shared across all of them rather than applied per screenshot,
 * because the ceiling being defended is the *response*, and a per-item cap
 * multiplied by twenty pages is not a cap at all. Filled last-first: the page
 * the walk ended on is the one most likely to explain a failure, and the
 * earlier ones degrade to `screenshotOmitted` rather than pushing the body
 * past the limit.
 *
 * Three states per page, not two — a page with no screenshot on disk and a
 * page whose screenshot did not fit are different facts, and only the second
 * is worth telling the operator about.
 */
type PageScreenshot = { mimeType: string; base64: string };

async function pagesWithEvidence(
  pages: PageAudit[],
): Promise<
  Array<{
    url: string;
    title: string;
    statusCode?: number;
    screenshot?: PageScreenshot;
    screenshotOmitted?: true;
  }>
> {
  const meta = pages.map((p) => ({
    url: p.page.url,
    title: p.page.title,
    statusCode: p.page.statusCode,
  }));

  const evidence = new Map<number, PageScreenshot | 'omitted'>();
  let spent = 0;

  // Last-first, so a budget that runs out costs the least useful pictures.
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const path = pages[index]?.artifacts.screenshotPath;
    if (!path) continue;

    try {
      const bytes = await readFile(path);
      if (spent + bytes.byteLength > MAX_INLINE_SCREENSHOT_BYTES) {
        evidence.set(index, 'omitted');
        continue;
      }
      spent += bytes.byteLength;
      evidence.set(index, { mimeType: 'image/png', base64: bytes.toString('base64') });
    } catch {
      // A missing file degrades the preview, it does not fail it.
    }
  }

  return meta.map((page, index) => {
    const found = evidence.get(index);
    if (found === 'omitted') return { ...page, screenshotOmitted: true as const };
    if (found) return { ...page, screenshot: found };
    return page;
  });
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

  const budget = await consumePreviewBudget(getRunCounter());
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

    const pages = await pagesWithEvidence(result.pages);
    logInfo('journey_preview', {
      requestId,
      journeyId,
      steps: validated.data.length,
      pages: result.pages.length,
      // How much of the walk the operator can actually see. A preview that
      // reached six pages and could afford one picture is a different thing
      // from one that shows all six, and only this number says which happened.
      screenshots: pages.filter((page) => page.screenshot).length,
      durationMs: Date.now() - startedAt,
    });

    return Response.json({
      requestId,
      ok: true,
      pages,
      truncatedPages: result.truncatedPages,
      // Which bound cut the walk short, when one did. Absent means it did not —
      // the operator authoring a journey needs to know whether to shorten it or
      // to expect the run to time out, and those are different answers.
      ...(result.truncationReason ? { truncationReason: result.truncationReason } : {}),
    });
  } catch (error) {
    const partial = error instanceof PartialJourneyError ? error.captured.pages : [];
    const truncatedPages =
      error instanceof PartialJourneyError ? error.captured.truncatedPages : undefined;
    const truncationReason =
      error instanceof PartialJourneyError ? error.captured.truncationReason : undefined;
    const message = error instanceof Error ? error.message : 'preview_failed';
    const code = classifyRunFailure(message, error instanceof Error ? error.name : undefined);
    const pages = await pagesWithEvidence(partial);

    logWarn('journey_preview_failed', {
      requestId,
      journeyId,
      reason: code,
      pages: partial.length,
      screenshots: pages.filter((page) => page.screenshot).length,
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
        ...(truncationReason ? { truncationReason } : {}),
        // Gated on the code, not only on the error type. `PartialJourneyError`
        // wraps whatever killed the walk, and most of what reaches here is not
        // safe to echo: `UnsafeTargetError` embeds the full page URL —
        // including the query string, where an SSO `?code=` or a reset token
        // lives — and a filesystem error would leak a tmpdir path. Only
        // `journey_step_failed` is anchored on the runner's own
        // `Step N ("action") could not …` prefix, which is what
        // `classifyRunFailure` recognises.
        //
        // That the runner composed the *template* was once taken to mean the
        // whole sentence was value-free. It was not: `attemptStep` interpolates
        // the first line of whatever Playwright threw, and a click wraps its
        // navigation settle, so this branch shipped Chromium's `net::ERR_… at
        // https://host/cb?code=…` verbatim to an operator. The fix is at the
        // formatter, where the sentence is built. `withUrlsReduced` here is the
        // cheap half of defence in depth: it enforces the claim where the
        // content is echoed rather than trusting it from three modules away, so
        // the next error path that happens to match the anchor cannot re-open
        // the hole.
        ...(code === 'journey_step_failed' && error instanceof PartialJourneyError
          ? { detail: withUrlsReduced((message.split('\n')[0] ?? '').trim()) }
          : {}),
        pages,
      },
      { status: 422 },
    );
  } finally {
    await rm(artifactsDir, { recursive: true, force: true }).catch(() => {});
  }
}
