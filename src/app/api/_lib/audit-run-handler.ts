import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitUntil } from '@vercel/functions';
import { environmentSchema } from '../../../domain/contracts';
import { getArtifactStore } from '../../../integrations/artifacts/blob-store';
import { worstEvidenceStatus } from '../../../domain/evidence';
import { getRunStore } from '../../../integrations/persistence';
import { runBrowserAudit } from '../../../integrations/browser/run-browser-audit';
import { PartialAuditError } from '../../../integrations/browser/partial-run';
import { createAuditRunLog, emitAuditRunLog } from '../../../services/audit-run-log';
import { compareToBaseline } from '../../../services/regression';
import { toStoredRunRecord } from '../../../services/run-persistence';
import { z } from 'zod';
import {
  CHAOS_SCENARIOS,
  isChaosEnabled,
  resolveChaosRunParams,
  type ChaosScenario,
} from './chaos';
import { createRequestId } from './request-id';
import { classifyRunFailure } from './run-failure';
import { getRunCounter } from './run-counter';
import { consumeRunBudget } from '../../../services/run-budget';
import { logWarn } from '../../../services/logger';

const DEFAULT_FIXTURE_DIR = join(process.cwd(), 'fixtures/journey-app');

/**
 * The ceiling a run has to fit inside, mirroring `maxDuration` on the routes.
 *
 * Only used to report headroom. A run is not stopped at this number — the
 * platform stops it, and rather more abruptly.
 */
const MAX_RUN_DURATION_MS = 300_000;

/**
 * Every free-text field on a step, bounded.
 *
 * These were `z.string().min(1)` with no ceiling, and a step's `action`,
 * `selector` and `path` are stored on the run's `intent`, echoed into failure
 * messages by `attemptStep`, and serialised on both sides of every regression
 * diff. One step carrying a multi-megabyte string reached all three, bounded
 * only by the request body limit. 512 is generous for a CSS selector or a
 * path; `deterministic-audit` caps axe's `outerHTML` at the same number.
 *
 * This covers running, not writing. The journeys collection route validates
 * with its own loose `z.record(z.string(), z.unknown())` — deliberately, so
 * the step contract has one owner — so a stored journey can still hold a step
 * this would refuse. It simply cannot be run or scheduled: both routes
 * re-validate `journey.steps` against this schema first. `journeys.steps` is
 * bounded separately, by size rather than by shape, for the same reason.
 */
const STEP_TEXT = z.string().min(1).max(512);

/**
 * A `fill` step carries either a literal value or a credential reference.
 * Passwords must use the reference: steps travel in this request body and get
 * persisted with the journey, and would otherwise be recoverable from both.
 *
 * The literal variant is still accepted, and that is a known hole rather than
 * a decision — `containsInlineCredential` rejects a key *named* `password` and
 * does not run on this route at all. What has changed is that a literal no
 * longer reaches the run record: `redactIntent` keeps only the keys that say
 * *where* a step went, so the hole ends at the journey row it already had.
 */
export const journeyStepSchema = z.union([
  z.object({ action: STEP_TEXT, type: z.literal('goto'), path: STEP_TEXT }),
  z.object({ action: STEP_TEXT, type: z.literal('click'), selector: STEP_TEXT }),
  // Two `fill` shapes, so these are a plain union rather than a discriminated
  // one — `type` alone does not tell them apart.
  z.object({
    action: STEP_TEXT,
    type: z.literal('fill'),
    selector: STEP_TEXT,
    value: z.string().max(4096),
  }),
  z.object({
    action: STEP_TEXT,
    type: z.literal('fill'),
    selector: STEP_TEXT,
    credentialRef: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    field: z.enum(['user', 'pass']),
  }),
]);

/**
 * Where a run may write its evidence.
 *
 * `process.cwd()` is `/var/task` on a serverless function and that filesystem
 * is read-only, so the first real audit on the deployment died at
 *
 *   ENOENT: no such file or directory, mkdir '/var/task/artifacts/<id>'
 *
 * before a page was ever opened. `/tmp` is the one writable path there, and it
 * is the right one anyway: these files are uploaded to the blob store and the
 * invocation's disk does not outlive the request. Locally the repo's own
 * `artifacts/` is kept, because being able to open the last run's screenshot
 * without a network round trip is worth more than the symmetry.
 */
function artifactsRoot(): string {
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  return serverless ? join(tmpdir(), 'artifacts') : join(process.cwd(), 'artifacts');
}

export const auditRunBodySchema = z.object({
  journeyId: z.string().min(1),
  environment: environmentSchema,
  platformHint: z.string().min(1).optional(),
  omitAxTree: z.boolean().optional(),
  /**
   * Origin of the site to audit. Absent means the built-in fixture app.
   * The scheme, host, and every resolved address are checked before a browser
   * launches; after each navigation both the settled URL and the address the
   * browser actually connected to are checked — see
   * `integrations/browser/target-url.ts`.
   */
  targetUrl: z.url().optional(),
  steps: z.array(journeyStepSchema).min(1).max(50).optional(),
  chaosScenario: z
    .enum([
      'browser_omit_ax_tree',
      'browser_complete_critical',
      'browser_complete_clean',
      'browser_passthrough_violations',
    ])
    .optional(),
  // stepId names the artifact files for this run. It is concatenated onto the
  // artifacts directory, so it must be a bare filename segment -- no
  // separators and no dots, which rules out `..` traversal. runJourney
  // re-checks containment before writing.
  stepId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, 'stepId may only contain letters, numbers, hyphens, underscores')
    .optional(),
  // fixtureDir is deliberately NOT accepted over HTTP. It feeds
  // page.goto(file://...), so a caller-supplied value turns an audit run into
  // a local file read primitive. It stays a parameter of runBrowserAudit for
  // tests and scripts, which are already trusted; the route always uses
  // DEFAULT_FIXTURE_DIR.
});

export type AuditRunHandlerResult =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Runs the audit and persists the outcome. Shared by both response modes.
 *
 * Returns the same body either mode would produce, so the async path is purely
 * about when the caller is unblocked — not about what eventually gets stored.
 */
/**
 * Uploads one run's evidence and returns the rows to store.
 *
 * Extracted because it lived only on the success path, and that was the third
 * place a partial run lost its work: pages carried out of a failed journey
 * would have been recorded pointing at a filesystem that vanished with the
 * invocation. Both paths call this now, so a partial run's evidence is as
 * durable as a complete one's.
 */
async function uploadPages(
  requestId: string,
  audited: Array<{
    page: { url: string; route: string; title: string; statusCode?: number };
    evidenceStatus: string;
    checks?: { passed?: number; failed?: number; incomplete?: number };
    timing?: { totalMs?: number; scanMs?: number };
    artifacts: Parameters<ReturnType<typeof getArtifactStore>['upload']>[1];
    pageKey: string;
  }>,
) {
  const artifactStore = getArtifactStore();
  const pages = [];

  for (const one of audited) {
    pages.push({
      url: one.page.url,
      route: one.page.route,
      title: one.page.title,
      evidenceStatus: one.evidenceStatus,
      statusCode: one.page.statusCode,
      checksPassed: one.checks?.passed,
      checksFailed: one.checks?.failed,
      checksIncomplete: one.checks?.incomplete,
      durationMs: one.timing?.totalMs,
      scanMs: one.timing?.scanMs,
      artifacts: await artifactStore.upload(requestId, one.artifacts, one.pageKey),
    });
  }

  return pages;
}

async function executeRun(
  parsedBody: z.infer<typeof auditRunBodySchema>,
  requestId: string,
  startedAt: number,
): Promise<AuditRunHandlerResult> {
  const chaosParams = parsedBody.chaosScenario
    ? resolveChaosRunParams(parsedBody.chaosScenario, parsedBody.journeyId, parsedBody.environment)
    : undefined;

  const store = getRunStore();

  try {
    const report = await runBrowserAudit({
      journeyId: parsedBody.journeyId,
      environment: parsedBody.environment,
      stepId: chaosParams?.stepId ?? parsedBody.stepId ?? 'dashboard',
      fixtureDir: DEFAULT_FIXTURE_DIR,
      artifactsDir: join(artifactsRoot(), requestId),
      omitAxTree: chaosParams?.omitAxTree ?? parsedBody.omitAxTree,
      steps: chaosParams?.steps ?? parsedBody.steps,
      targetUrl: chaosParams ? undefined : parsedBody.targetUrl,
      platformHint: parsedBody.platformHint,
    });

    // Upload before persisting so the record points at durable evidence rather
    // than at a filesystem that disappears with the invocation. One upload per
    // audited page, each keyed by that page so they cannot overwrite one
    // another.
    const uploadStartedAt = Date.now();
    const pages = await uploadPages(requestId, report.pages);

    const uploadMs = Date.now() - uploadStartedAt;
    const durationMs = Date.now() - startedAt;
    const baseline = await store.getLatestRun(report.journeyId, report.environment, requestId);

    const phaseMs = { ...(report.phaseMs ?? {}), upload: uploadMs };
    const slowestPageMs = pages.reduce(
      (slowest, page) => Math.max(slowest, page.durationMs ?? 0),
      0,
    );

    const storedRun = toStoredRunRecord({
      requestId,
      journeyId: report.journeyId,
      environment: report.environment,
      // What this run was asked to walk, taken from the runner rather than
      // from the request: on the fixture path the request names no steps and
      // the runner substitutes the demo journey, so the request is not a
      // record of what happened.
      intent: { steps: report.steps },
      platform: report.platform.id,
      evidenceStatus: report.evidenceStatus,
      ciStatus: report.ciStatus,
      findings: report.findings,
      durationMs,
      startedAt: new Date(startedAt).toISOString(),
      phaseMs,
      browserMode: true,
      pages,
      truncatedPages: report.truncatedPages,
      score: report.score,
      scoreVersion: report.scoreVersion,
      status: 'complete',
    });
    await store.saveRun(storedRun);

    const regression = baseline ? compareToBaseline(storedRun, baseline) : undefined;

    emitAuditRunLog(
      createAuditRunLog({
        journey: report.journeyId,
        env: report.environment,
        platform: report.platform.id,
        evidenceStatus: report.evidenceStatus,
        ciStatus: report.ciStatus,
        durationMs,
        requestId,
        browserMode: true,
        // The dataset the page-cap decision gets made from. `headroomMs` is
        // what was left of the function's budget: the number that says whether
        // twenty pages was ever a realistic ceiling.
        phaseMs,
        pagesAudited: pages.length,
        truncatedPages: report.truncatedPages,
        slowestPageMs,
        headroomMs: MAX_RUN_DURATION_MS - durationMs,
      }),
    );

    return {
      ok: true,
      status: 200,
      body: {
        requestId,
        journeyId: report.journeyId,
        environment: report.environment,
        platform: report.platform.id,
        evidenceStatus: report.evidenceStatus,
        ciStatus: report.ciStatus,
        executionStatus: report.executionStatus,
        findings: report.findings,
        executiveSummary: report.executiveSummary,
        durationMs,
        browserMode: true,
        status: 'complete',
        pages,
        // Null means not measured — sent as-is rather than coerced, so a
        // caller can tell "we could not score this" from "it scored zero".
        score: report.score,
        checksPassed: report.checksPassed,
        checksFailed: report.checksFailed,
        checksNeedingReview: report.checksNeedingReview,
        ...(report.truncatedPages > 0 ? { truncatedPages: report.truncatedPages } : {}),
        ...(regression ? { regression } : {}),
      },
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const failureReason = error instanceof Error ? error.message : 'audit_run_failed';
    const code = classifyRunFailure(
      failureReason,
      error instanceof Error ? error.name : undefined,
    );

    /**
     * What the run managed to audit before it died.
     *
     * A journey that failed at step five of eight had already scanned four
     * pages, and this path threw them away: `findings: []`, no pages, and the
     * artifacts left on a filesystem that disappears with the invocation. A
     * run that found real violations and then hit a stale selector reported
     * nothing at all — indistinguishable from one that found nothing.
     *
     * Uploaded through the same function the success path uses, so partial
     * evidence is as durable and as strictly judged as complete evidence. If
     * the upload itself fails there is nothing useful left to do about it: the
     * run is already failing, and losing the pages is what happened before.
     */
    const partial =
      error instanceof PartialAuditError
        ? await uploadPages(requestId, error.auditedPages).catch((uploadError: unknown) => {
            // Said, not swallowed. Losing the upload loses the pages and the
            // findings with them, which puts the record back to "the walk
            // found nothing" — the exact reading this path exists to prevent,
            // and indistinguishable from it without a line here.
            logWarn('partial_run_upload_failed', {
              requestId,
              pages: error.auditedPages.length,
              reason: uploadError instanceof Error ? uploadError.name : 'unknown',
            });
            return [];
          })
        : [];
    const partialFindings = partial.length
      ? (error as PartialAuditError).auditedPages.flatMap((one) => one.findings)
      : [];

    emitAuditRunLog(
      createAuditRunLog({
        journey: parsedBody.journeyId,
        env: parsedBody.environment,
        platform: 'unknown',
        evidenceStatus: 'unknown',
        ciStatus: 'unknown',
        durationMs,
        failureReason,
        requestId,
        browserMode: true,
      }),
    );

    // Record the failure so a poll gets an answer instead of a record stuck at
    // `running` forever. The stored reason is the same stable code the caller
    // sees — never the raw message, which carries paths.
    await store
      .saveRun(
        toStoredRunRecord({
          requestId,
          journeyId: parsedBody.journeyId,
          environment: parsedBody.environment,
          platform: 'unknown',
          /**
           * The worst of the pages this run did capture, exactly as a
           * complete run computes it — not a literal.
           *
           * This was hardcoded `'unknown'`, which was true when a failed run
           * had no pages and became a contradiction the moment it had some:
           * the record now carries pages that say `complete`, under a run-level
           * banner saying we do not know. `'unknown'` is also not a member of
           * `EvidenceStatus`; it survives only because the stored field is
           * typed `string`. It stays for the case it was written for — a run
           * that captured nothing has nothing to judge.
           */
          evidenceStatus: partial.length
            ? worstEvidenceStatus(
                (error as PartialAuditError).auditedPages.map((one) => one.evidenceStatus),
              )
            : 'unknown',
          ciStatus: 'inconclusive',
          // Reported, not withheld. These are real violations on real pages
          // that were really visited; the run is `failed` and `inconclusive`
          // either way, and `score` stays absent because an incomplete walk
          // has no denominator. Saying nothing was found would be the lie.
          findings: partialFindings,
          ...(partial.length ? { pages: partial } : {}),
          // A run can be truncated *and* fail. Reported as 0, that reads as
          // "we audited everything" about a walk cut short twice over.
          ...(error instanceof PartialAuditError && error.truncatedPages > 0
            ? { truncatedPages: error.truncatedPages }
            : {}),
          durationMs,
          browserMode: true,
          status: 'failed',
          failureReason: code,
          /**
           * No `intent` here, and that is not an omission.
           *
           * `getLatestRun` does not filter on status, so this record is
           * eligible as the next run's regression baseline — and it now
           * carries real pages and findings where it used to carry none.
           * Recording what it walked would make `walkedTheSamePath` compare
           * it, and a baseline that stopped at page two would report pages
           * three and four's findings as **resolved**. The product's worst
           * output, reached by what looks like a completeness fix.
           *
           * A partial walk is not a walk of the journey. It stays
           * incomparable until it is safe to say otherwise, which needs the
           * diff to know how far each run got — not just what each was asked
           * to do. `tests/services/regression.test.ts` holds this.
           */
        }),
      )
      .catch(() => {
        // A failed run that also fails to record is not worth masking the
        // original error for.
      });

    return {
      ok: false,
      status: 422,
      // The log above keeps the full message; the response gets a stable code,
      // so internal detail (paths, action and environment names) stays server-side.
      body: { error: code, requestId },
    };
  }
}

/** An already-validated run request, plus the caller's choice of mode. */
export type AuditRunParams = z.infer<typeof auditRunBodySchema> & {
  /** Block and return the result, rather than 202 + a poll URL. */
  wait?: boolean;
};

/**
 * Start a run. **This is the entry point every caller should use.**
 *
 * It takes a validated body rather than a `Request` on purpose. When the only
 * way in was an HTTP handler, a server-side caller that already held the
 * operator's trust had to manufacture one — `/api/audit/console` built a
 * synthetic `Request` with `authorization: Bearer <the server's own token>`
 * forged onto it, because that was the only shape `handleAuditRun` accepted.
 * Forging a credential onto a user's request to reach your own code is an
 * anti-pattern that gets worse the moment identity is per-user, since there is
 * then a real principal being impersonated rather than a shared secret being
 * passed along.
 *
 * The distinction worth keeping straight: a server holding its own machine
 * credential and issuing a *fresh* HTTP request to obtain a separate compute
 * budget is not this anti-pattern — that is fan-out, and the scheduler does it
 * deliberately. What was wrong here was reaching in-process code through a
 * fabricated request.
 */
export async function startRun(
  params: AuditRunParams,
  requestId = createRequestId(),
  startedAt = Date.now(),
): Promise<AuditRunHandlerResult> {
  const { wait, ...parsedBody } = params;

  if (parsedBody.chaosScenario) {
    if (!isChaosEnabled()) {
      const durationMs = Date.now() - startedAt;
      emitAuditRunLog(
        createAuditRunLog({
          journey: parsedBody.journeyId,
          env: parsedBody.environment,
          platform: 'unknown',
          evidenceStatus: 'unknown',
          ciStatus: 'unknown',
          durationMs,
          failureReason: 'chaos_not_enabled',
          requestId,
        }),
      );

      return { ok: false, status: 403, body: { error: 'chaos_not_enabled', requestId } };
    }

    if (!CHAOS_SCENARIOS.includes(parsedBody.chaosScenario as ChaosScenario)) {
      const durationMs = Date.now() - startedAt;
      emitAuditRunLog(
        createAuditRunLog({
          journey: parsedBody.journeyId,
          env: parsedBody.environment,
          platform: 'unknown',
          evidenceStatus: 'unknown',
          ciStatus: 'unknown',
          durationMs,
          failureReason: 'invalid_chaos_scenario',
          requestId,
        }),
      );

      return { ok: false, status: 400, body: { error: 'invalid_chaos_scenario', requestId } };
    }
  }

  /**
   * The budget, checked here rather than in a route.
   *
   * Every caller funnels through `startRun` — the HTTP endpoint, the console,
   * the platform's Run now button, and the scheduler — so putting the check
   * here covers all of them by construction. A route-level check would be four
   * copies and would miss whichever one gets added next.
   *
   * After the chaos gating and before the placeholder write: a refused run must
   * leave no row behind, because it never started. That is also why this is not
   * a `RunFailureCode` — nothing failed, the run was declined.
   */
  const budget = await consumeRunBudget(getRunCounter());
  if (!budget.allowed) {
    logWarn('run_budget_exceeded', {
      requestId,
      journeyId: parsedBody.journeyId,
      window: budget.window,
      resetsInSeconds: budget.resetsInSeconds,
    });

    return {
      ok: false,
      status: 429,
      body: {
        error: 'run_budget_exceeded',
        requestId,
        window: budget.window,
        resetsInSeconds: budget.resetsInSeconds,
      },
    };
  }

  // Two response modes.
  //
  // Async (default): persist a `running` placeholder, hand back 202 and a
  // request id, and finish the work in the background. The caller polls
  // `GET /api/audit/runs/{id}`. This unblocks the client — a run takes tens of
  // seconds and a browser or proxy may not wait — but it does NOT buy more
  // compute: background work is bounded by the same `maxDuration` as the
  // request. Nothing here makes a long crawl fit where it otherwise would not.
  //
  // Sync (`wait`): block and return the result. CI wants a single call with a
  // pass/fail, and the chaos script and handler tests want determinism.
  if (wait) {
    return executeRun(parsedBody, requestId, startedAt);
  }

  // Written before the work starts so a run that times out or crashes leaves a
  // trace. Previously a record only appeared on success, so a run that died
  // mid-flight was indistinguishable from one that never happened.
  await getRunStore().saveRun(
    toStoredRunRecord({
      requestId,
      journeyId: parsedBody.journeyId,
      environment: parsedBody.environment,
      platform: 'unknown',
      evidenceStatus: 'unknown',
      ciStatus: 'inconclusive',
      findings: [],
      durationMs: 0,
      browserMode: true,
      status: 'running',
    }),
  );

  const work = executeRun(parsedBody, requestId, startedAt);
  waitUntil(work);

  return {
    ok: true,
    status: 202,
    body: {
      requestId,
      journeyId: parsedBody.journeyId,
      environment: parsedBody.environment,
      status: 'running',
      pollUrl: `/api/audit/runs/${requestId}`,
    },
  };
}

/**
 * HTTP entry point for `POST /api/audit/run`.
 *
 * Nothing but a boundary: parse the body, read the mode off the query string,
 * hand both to `startRun`. Everything that decides what a run *does* lives
 * there, so a server-side caller gets identical behaviour without inventing a
 * request to carry it.
 *
 * There is a single execution path: drive a real browser through the journey
 * and evaluate the rendered page. The HTML-string path that used to sit
 * alongside it was removed — it evaluated markup with no stylesheet and no
 * layout, and reported complete evidence while naming artifact files it never
 * wrote.
 */
export async function handleAuditRun(
  request: Request,
  requestId = createRequestId(),
): Promise<AuditRunHandlerResult> {
  const startedAt = Date.now();

  let parsedBody: z.infer<typeof auditRunBodySchema>;
  try {
    parsedBody = auditRunBodySchema.parse(await request.json());
  } catch {
    emitAuditRunLog(
      createAuditRunLog({
        journey: 'unknown',
        env: 'unknown',
        platform: 'unknown',
        evidenceStatus: 'unknown',
        ciStatus: 'unknown',
        durationMs: Date.now() - startedAt,
        failureReason: 'invalid_request_body',
        requestId,
      }),
    );

    return { ok: false, status: 400, body: { error: 'invalid_request_body', requestId } };
  }

  const wait = new URL(request.url).searchParams.get('wait') === '1';

  return startRun({ ...parsedBody, wait }, requestId, startedAt);
}
