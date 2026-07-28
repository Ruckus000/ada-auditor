import { environmentSchema } from '../../../domain/contracts';
import { runAudit } from '../../../services/run-audit';
import { createAuditRunLog, emitAuditRunLog } from '../../../services/audit-run-log';
import { z } from 'zod';
import {
  CHAOS_SCENARIOS,
  isChaosEnabled,
  resolveChaosRunParams,
  type ChaosScenario,
} from './chaos';
import { createRequestId } from './request-id';

const auditRunBodySchema = z.object({
  journeyId: z.string().min(1),
  environment: environmentSchema,
  html: z.string().min(1),
  platformHint: z.string().min(1).optional(),
  omitAxTree: z.boolean().optional(),
  chaosScenario: z.enum(['omit_ax_tree', 'complete_critical', 'complete_clean']).optional(),
});

export type AuditRunHandlerResult =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> };

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
    const log = createAuditRunLog({
      journey: 'unknown',
      env: 'unknown',
      platform: 'unknown',
      evidenceStatus: 'unknown',
      ciStatus: 'unknown',
      durationMs,
      failureReason: 'invalid_request_body',
      requestId,
    });
    emitAuditRunLog(log);

    return {
      ok: false,
      status: 400,
      body: { error: 'invalid_request_body', requestId },
    };
  }

  let runInput: {
    journeyId: string;
    environment: z.infer<typeof environmentSchema>;
    html: string;
    omitAxTree?: boolean;
    platformHint?: string;
  };

  if (parsedBody.chaosScenario) {
    if (!isChaosEnabled()) {
      const durationMs = Date.now() - startedAt;
      const log = createAuditRunLog({
        journey: parsedBody.journeyId,
        env: parsedBody.environment,
        platform: 'unknown',
        evidenceStatus: 'unknown',
        ciStatus: 'unknown',
        durationMs,
        failureReason: 'chaos_not_enabled',
        requestId,
      });
      emitAuditRunLog(log);

      return {
        ok: false,
        status: 403,
        body: { error: 'chaos_not_enabled', requestId },
      };
    }

    if (!CHAOS_SCENARIOS.includes(parsedBody.chaosScenario as ChaosScenario)) {
      const durationMs = Date.now() - startedAt;
      const log = createAuditRunLog({
        journey: parsedBody.journeyId,
        env: parsedBody.environment,
        platform: 'unknown',
        evidenceStatus: 'unknown',
        ciStatus: 'unknown',
        durationMs,
        failureReason: 'invalid_chaos_scenario',
        requestId,
      });
      emitAuditRunLog(log);

      return {
        ok: false,
        status: 400,
        body: { error: 'invalid_chaos_scenario', requestId },
      };
    }

    runInput = resolveChaosRunParams(
      parsedBody.chaosScenario,
      parsedBody.journeyId,
      parsedBody.environment,
    );
  } else {
    runInput = {
      journeyId: parsedBody.journeyId,
      environment: parsedBody.environment,
      html: parsedBody.html,
      omitAxTree: parsedBody.omitAxTree,
      platformHint: parsedBody.platformHint,
    };
  }

  try {
    const report = await runAudit(runInput);
    const durationMs = Date.now() - startedAt;

    const log = createAuditRunLog({
      journey: report.journeyId,
      env: report.environment,
      platform: report.platform.id,
      evidenceStatus: report.evidenceStatus,
      ciStatus: report.ciStatus,
      durationMs,
      requestId,
    });
    emitAuditRunLog(log);

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
      },
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const failureReason =
      error instanceof Error ? error.message : 'audit_run_failed';

    const log = createAuditRunLog({
      journey: runInput.journeyId,
      env: runInput.environment,
      platform: 'unknown',
      evidenceStatus: 'unknown',
      ciStatus: 'unknown',
      durationMs,
      failureReason,
      requestId,
    });
    emitAuditRunLog(log);

    return {
      ok: false,
      status: 422,
      body: { error: failureReason, requestId },
    };
  }
}
