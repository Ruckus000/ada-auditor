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
  /**
   * What the rule checks, in the engine's own words.
   *
   * Optional because every run stored before the column existed has none, and
   * a screen has to render those without pretending otherwise.
   */
  title?: string;
  message?: string;
  /**
   * How to fix it, in the engine's words.
   *
   * Two lists because the engine evaluates them differently: any **one** entry
   * in `remediationAnyOf` clears the finding, every entry in
   * `remediationAllOf` has to be done. Flattening them into one list would tell
   * a developer to do three things when one would do.
   *
   * Optional: runs stored before these columns existed have none.
   */
  remediationAnyOf?: string[];
  remediationAllOf?: string[];
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
  /**
   * The conformance score's inputs, per page. Absent on runs recorded before
   * check counting existed — which must read as "not measured", never as zero.
   */
  checksPassed?: number;
  checksFailed?: number;
  /** Counted in neither term of the score; the human-review queue. */
  checksIncomplete?: number;
  /**
   * Wall clock for this page: navigate, scan, write artifacts. Absent means
   * not measured — the distinction that decides whether the page cap and the
   * 300s function limit are the right numbers, so a zero here would be a
   * measurement nobody made.
   */
  durationMs?: number;
  /** The axe scan alone, within `durationMs`. */
  scanMs?: number;
};

/**
 * The steps a run was given, stored whole.
 *
 * `unknown[]`, matching `StoredJourney.steps`: the step contract lives in the
 * run handler, and a second definition here would be a second thing to
 * disagree with it. Nothing in the domain reads inside these — the only
 * question asked of them is whether two runs were given the same ones.
 *
 * An object rather than a bare array so that what a run intended can grow
 * without another nullable column each time.
 */
export type RunIntent = {
  steps: unknown[];
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
  /**
   * When the run began, as distinct from when this record was written.
   *
   * `createdAt` used to carry both meanings depending on how the run ended —
   * see the note in `schema.sql`. Absent on runs recorded before this existed.
   */
  startedAt?: string;
  /**
   * Where the run spent itself: launch, journey, upload, advisory, persist.
   * Open-ended on purpose — these names will change while we are still
   * learning, and this is measurement data rather than a contract.
   */
  phaseMs?: Record<string, number>;
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
   * What this run was asked to do, as opposed to what happened.
   *
   * Everything else on this record is outcome. Nothing said what the outcome
   * was supposed to be, so nothing could tell a run that walked five pages
   * from one that walked five *different* pages — and the regression diff
   * compares runs by `journeyId` alone (`getLatestRun`). `/api/audit/run`
   * takes `journeyId` and `steps` independently, so one call naming an
   * existing journey with a different path becomes the next run's baseline,
   * and every finding the real journey has that the impostor did not reports
   * as *resolved*. A clean bill of health, produced by working code.
   *
   * Recorded on the run rather than read from the journey, because the journey
   * is mutable and this is history. A run's own copy is what makes a later
   * comparison honest, and it is what will survive journeys becoming editable.
   *
   * Absent on runs written before this existed. Absent means *not recorded* —
   * never "the same path as some other run".
   */
  intent?: RunIntent;
  /**
   * Pages the run's page cap refused to audit. Non-zero means this run did not
   * cover the whole journey — persisted because a partial audit must never
   * read as a complete one once the log line that recorded it is gone.
   */
  truncatedPages?: number;
  /**
   * Conformance rate over the checks evaluated, or absent when the run could
   * not be scored — incomplete evidence has no denominator.
   */
  score?: number;
  /** Which formula produced `score`. See `services/score.ts`. */
  scoreVersion?: number;
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
  /**
   * Writes the truth about runs that died mid-flight, and returns how many.
   *
   * Reads already reconcile — see `domain/run-staleness.ts` — so a screen is
   * never wrong. This is the other half: without it the database goes on
   * disagreeing with the screen, and anything querying it directly (a report,
   * a later migration, a human in psql) sees runs that have been in progress
   * for weeks.
   */
  reconcileStaleRuns(olderThanMs: number): Promise<number>;
  /**
   * Clears artifact URLs for runs older than the cutoff, returning how many
   * pages were cleared.
   *
   * `prune-artifacts` deletes the blobs but never touched the database, so a
   * pruned run kept URLs that 404 forever and nothing said why. Now the
   * pointers go with the bytes, and a page with no artifacts reads as "no
   * evidence" rather than as a broken link.
   */
  clearArtifactsBefore(cutoffIso: string): Promise<number>;
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
