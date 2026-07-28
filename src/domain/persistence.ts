import type { Environment } from './contracts';

export type StoredFinding = {
  code: string;
  severity: string;
  source: string;
};

export type StoredRunRecord = {
  requestId: string;
  journeyId: string;
  environment: Environment;
  platform: string;
  evidenceStatus: string;
  ciStatus: string;
  findings: StoredFinding[];
  durationMs: number;
  createdAt: string;
  browserMode?: boolean;
};

export interface RunStore {
  saveRun(record: StoredRunRecord): Promise<void>;
  getRun(requestId: string): Promise<StoredRunRecord | null>;
  getLatestRun(
    journeyId: string,
    environment: Environment,
    excludeRequestId?: string,
  ): Promise<StoredRunRecord | null>;
}
