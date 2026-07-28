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

export function emitAuditRunLog(fields: AuditRunLog): void {
  console.log(JSON.stringify({ type: 'audit_run_log', ...fields }));
}
