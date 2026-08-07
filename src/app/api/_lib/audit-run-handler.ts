import { join } from 'node:path';
import { environmentSchema } from '../../../domain/contracts';
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

const auditRunBodySchema = z.object({
  journeyId: z.string().min(1),
  environment: environmentSchema,
  platformHint: z.string().min(1).optional(),
  omitAxTree: z.boolean().optional(),
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
 * Runs one audit.
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

  const chaosParams = parsedBody.chaosScenario
    ? resolveChaosRunParams(parsedBody.chaosScenario, parsedBody.journeyId, parsedBody.environment)
    : undefined;

  try {
    const report = await runBrowserAudit({
      journeyId: parsedBody.journeyId,
      environment: parsedBody.environment,
      stepId: chaosParams?.stepId ?? parsedBody.stepId ?? 'dashboard',
      fixtureDir: DEFAULT_FIXTURE_DIR,
      artifactsDir: join(process.cwd(), 'artifacts', requestId),
      omitAxTree: chaosParams?.omitAxTree ?? parsedBody.omitAxTree,
      steps: chaosParams?.steps,
      platformHint: parsedBody.platformHint,
    });

    const durationMs = Date.now() - startedAt;
    const store = getRunStore();
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
        ...(regression ? { regression } : {}),
      },
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const failureReason = error instanceof Error ? error.message : 'audit_run_failed';

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

    return {
      ok: false,
      status: 422,
      // The log above keeps the full message; the response gets a stable code,
      // so internal detail (paths, action and environment names) stays server-side.
      body: { error: classifyRunFailure(failureReason), requestId },
    };
  }
}
