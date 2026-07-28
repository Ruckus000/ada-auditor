import type { StoredRunRecord } from '../domain/persistence';
import type { AuditFinding } from './reporting';
import type { CiStatus } from './reporting';

type PersistRunInput = {
  requestId: string;
  journeyId: string;
  environment: StoredRunRecord['environment'];
  platform: string;
  evidenceStatus: string;
  ciStatus: CiStatus;
  findings: AuditFinding[];
  durationMs: number;
  browserMode?: boolean;
};

export function toStoredRunRecord(input: PersistRunInput): StoredRunRecord {
  return {
    requestId: input.requestId,
    journeyId: input.journeyId,
    environment: input.environment,
    platform: input.platform,
    evidenceStatus: input.evidenceStatus,
    ciStatus: input.ciStatus,
    findings: input.findings.map((finding) => ({
      code: finding.code,
      severity: finding.severity,
      source: finding.source,
    })),
    durationMs: input.durationMs,
    createdAt: new Date().toISOString(),
    ...(input.browserMode ? { browserMode: true } : {}),
  };
}
