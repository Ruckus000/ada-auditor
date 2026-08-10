import { logEvent } from './logger';

export type AuditRunLog = {
  journey: string;
  env: string;
  platform: string;
  evidenceStatus: string;
  ciStatus: string;
  durationMs: number;
  failureReason?: string;
  requestId: string;
  browserMode?: boolean;
  /**
   * Timing, present on a run that completed. This is the dataset the page cap
   * and the function limit get re-decided from — `AGENTS.md` calls the current
   * cap "a guess, not a measurement", and these fields are how it stops being
   * one.
   */
  phaseMs?: Record<string, number>;
  pagesAudited?: number;
  truncatedPages?: number;
  slowestPageMs?: number;
  /** What was left of the function's budget. Negative is a run that got lucky. */
  headroomMs?: number;
};

export function createAuditRunLog(fields: AuditRunLog): AuditRunLog {
  return { ...fields };
}

/**
 * A failed run logs at `warn`: it is an operational event someone should see,
 * not the routine success line. Everything else about the shape is unchanged,
 * because callers and any log query built on it depend on the field names.
 */
export function emitAuditRunLog(fields: AuditRunLog): void {
  logEvent(fields.failureReason ? 'warn' : 'info', 'audit_run_log', { ...fields });
}
