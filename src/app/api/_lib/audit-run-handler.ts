import { join } from 'node:path';
import { waitUntil } from '@vercel/functions';
import { environmentSchema } from '../../../domain/contracts';
import { getArtifactStore } from '../../../integrations/artifacts/blob-store';
import { getRunStore } from '../../../integrations/persistence';
import { runBrowserAudit } from '../../../integrations/browser/run-browser-audit';
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

const DEFAULT_FIXTURE_DIR = join(process.cwd(), 'fixtures/journey-app');

/**
 * A `fill` step carries either a literal value or a credential reference.
 * Passwords must use the reference: steps travel in this request body, get
 * persisted with the journey, and would otherwise be recoverable from both.
 */
const journeyStepSchema = z.union([
  z.object({ action: z.string().min(1), type: z.literal('goto'), path: z.string().min(1) }),
  z.object({ action: z.string().min(1), type: z.literal('click'), selector: z.string().min(1) }),
  // Two `fill` shapes, so these are a plain union rather than a discriminated
  // one — `type` alone does not tell them apart.
  z.object({
    action: z.string().min(1),
    type: z.literal('fill'),
    selector: z.string().min(1),
    value: z.string(),
  }),
  z.object({
    action: z.string().min(1),
    type: z.literal('fill'),
    selector: z.string().min(1),
    credentialRef: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    field: z.enum(['user', 'pass']),
  }),
]);

const auditRunBodySchema = z.object({
  journeyId: z.string().min(1),
  environment: environmentSchema,
  platformHint: z.string().min(1).optional(),
  omitAxTree: z.boolean().optional(),
  /**
   * Origin of the site to audit. Absent means the built-in fixture app.
   * The scheme, host, and every resolved address are checked before a browser
   * launches, and the settled URL is re-checked after each navigation — see
   * `integrations/browser/target-url.ts`.
   */
  targetUrl: z.url().optional(),
  steps: z.array(journeyStepSchema).min(1).max(50).optional(),
  chaosScenario: z
    .enum(['browser_omit_ax_tree', 'browser_complete_critical', 'browser_complete_clean'])
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
      artifactsDir: join(process.cwd(), 'artifacts', requestId),
      omitAxTree: chaosParams?.omitAxTree ?? parsedBody.omitAxTree,
      steps: chaosParams?.steps ?? parsedBody.steps,
      targetUrl: chaosParams ? undefined : parsedBody.targetUrl,
      platformHint: parsedBody.platformHint,
    });

    // Upload before persisting so the record points at durable evidence rather
    // than at a filesystem that disappears with the invocation.
    const artifacts = await getArtifactStore().upload(requestId, report.artifacts);

    const durationMs = Date.now() - startedAt;
    const baseline = await store.getLatestRun(report.journeyId, report.environment, requestId);

    const storedRun = toStoredRunRecord({
      requestId,
      journeyId: report.journeyId,
      environment: report.environment,
      platform: report.platform.id,
      evidenceStatus: report.evidenceStatus,
      ciStatus: report.ciStatus,
      findings: report.findings,
      durationMs,
      browserMode: true,
      artifacts,
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
        ...(Object.keys(artifacts).length > 0 ? { artifacts } : {}),
        ...(regression ? { regression } : {}),
      },
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const failureReason = error instanceof Error ? error.message : 'audit_run_failed';
    const code = classifyRunFailure(failureReason);

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
          evidenceStatus: 'unknown',
          ciStatus: 'inconclusive',
          findings: [],
          durationMs,
          browserMode: true,
          status: 'failed',
          failureReason: code,
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

/**
 * Entry point for `POST /api/audit/run`.
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
    const json = await request.json();
    parsedBody = auditRunBodySchema.parse(json);
  } catch {
    const durationMs = Date.now() - startedAt;
    emitAuditRunLog(
      createAuditRunLog({
        journey: 'unknown',
        env: 'unknown',
        platform: 'unknown',
        evidenceStatus: 'unknown',
        ciStatus: 'unknown',
        durationMs,
        failureReason: 'invalid_request_body',
        requestId,
      }),
    );

    return { ok: false, status: 400, body: { error: 'invalid_request_body', requestId } };
  }

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

  // Two response modes.
  //
  // Async (default): persist a `running` placeholder, hand back 202 and a
  // request id, and finish the work in the background. The caller polls
  // `GET /api/audit/runs/{id}`. This unblocks the client — a run takes tens of
  // seconds and a browser or proxy may not wait — but it does NOT buy more
  // compute: background work is bounded by the same `maxDuration` as the
  // request. Nothing here makes a long crawl fit where it otherwise would not.
  //
  // Sync (`?wait=1`): block and return the result. CI wants a single call with
  // a pass/fail, and the chaos script and handler tests want determinism.
  const wantsSync = new URL(request.url).searchParams.get('wait') === '1';

  if (wantsSync) {
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
