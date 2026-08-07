import type { Environment } from './contracts';

/**
 * A persisted finding.
 *
 * This used to be `{code, severity, source}`, which discarded the message and
 * would have discarded every field the rule engine produces — leaving stored
 * runs unable to tell a developer *which* element failed or *why*. The
 * locating and citing fields are the point of a finding, so they persist.
 *
 * `htmlSnippet` is markup captured from the audited site. It is untrusted
 * input and must be escaped wherever it is rendered — report, UI, or PDF.
 */
export type StoredFinding = {
  code: string;
  severity: string;
  source: string;
  message?: string;
  wcagCriteria?: string[];
  conformanceLevel?: string | null;
  selector?: string;
  htmlSnippet?: string;
  helpUrl?: string;
  gateable?: boolean;
  confidence?: number;
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
