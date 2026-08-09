import type { Environment } from './contracts';
import type { StoredArtifacts } from './artifacts';

/**
 * Lifecycle of a run record.
 *
 * A record is written as `running` before the audit starts, so a run that
 * times out or crashes leaves evidence that it began instead of vanishing
 * without trace — which is what happened when records were only written on
 * success.
 */
export type RunStatus = 'running' | 'complete' | 'failed';

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
  /**
   * Page the finding was found on. Present on deterministic findings; absent on
   * advisory ones, which are produced once over the whole journey rather than
   * per page.
   */
  pageUrl?: string;
  selector?: string;
  htmlSnippet?: string;
  helpUrl?: string;
  gateable?: boolean;
  confidence?: number;
};

/**
 * One audited page within a run.
 *
 * A run is a journey, and a journey is several pages. Each carries its own
 * evidence and its own artifacts, so a finding's `pageUrl` leads to the exact
 * screenshot and DOM it came from — and a page whose evidence was incomplete
 * can be named rather than merely dragging the whole run to `inconclusive`.
 */
export type StoredRunPage = {
  url: string;
  route: string;
  title: string;
  evidenceStatus: string;
  artifacts?: StoredArtifacts;
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
  /**
   * Every page the journey walked through, in visit order, each with its own
   * uploaded evidence. This replaced a single run-level `artifacts` field,
   * which could only ever describe one page and so described the last one — the
   * same single-page assumption that made a run miss the violations it walked
   * past.
   */
  pages?: StoredRunPage[];
  /**
   * Pages the run's page cap refused to audit. Non-zero means this run did not
   * cover the whole journey — persisted because a partial audit must never
   * read as a complete one once the log line that recorded it is gone.
   */
  truncatedPages?: number;
  status?: RunStatus;
  /** Populated when `status` is `failed`; a stable code, never raw error text. */
  failureReason?: string;
};

export type ListRunsOptions = {
  journeyId?: string;
  environment?: Environment;
  /** Clamped by the store. A caller cannot ask for the whole table. */
  limit?: number;
};

export interface RunStore {
  saveRun(record: StoredRunRecord): Promise<void>;
  getRun(requestId: string): Promise<StoredRunRecord | null>;
  getLatestRun(
    journeyId: string,
    environment: Environment,
    excludeRequestId?: string,
  ): Promise<StoredRunRecord | null>;
  /**
   * Run history, newest first.
   *
   * Called out in the Phase 1 plan and never delivered, so until now there was
   * no way to enumerate history at all — every screen showing "past runs" had
   * to invent them.
   */
  list(options?: ListRunsOptions): Promise<StoredRunRecord[]>;
}
