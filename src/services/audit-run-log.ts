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
