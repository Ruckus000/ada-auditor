/**
 * The catalog the screens read: clients, journeys, triage, reports, activity.
 *
 * Deliberately NOT part of `RunStore`. That interface is the audit engine's
 * persistence dependency — injected into the browser path, chaos, and every
 * handler test — and its in-memory double exists so the fast suite needs no
 * database. Bolting twenty CRUD methods onto it would make the engine's
 * contract describe the product's admin screens, and would grow the double by
 * twenty methods the engine never calls.
 */

export type StoredClient = {
  id: string;
  name: string;
  /** A free-text name. There is no per-user identity to point at. */
  owner?: string;
  createdAt: string;
};

export type StoredJourney = {
  id: string;
  clientId: string;
  name: string;
  targetUrl?: string;
  /**
   * The `JourneyStep[]` the runner walks, stored whole. A credential is
   * referenced here, never inlined — the same rule that keeps secrets out of
   * request bodies keeps them out of this column.
   */
  steps: unknown[];
  /** Journeys archive rather than delete: `runs` cascades from them. */
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * One human decision about one defect.
 *
 * `findingKey` is `source:code:pageUrl:selector` — produced by `findingKey` in
 * `services/regression.ts`, never recomputed, so triage and the regression
 * diff cannot disagree about what "the same finding" means.
 *
 * There is no `fixed` state. A finding is fixed when the next run stops
 * reporting it; storing that as a human decision lets the flag and the
 * evidence contradict each other.
 */
export type TriageEntry = {
  clientId: string;
  findingKey: string;
  source: string;
  code: string;
  pageUrl?: string;
  selector?: string;
  state: TriageState;
  /** Required by the UI for `dismissed` and `accepted-risk`. */
  note?: string;
  assignee?: string;
  actor: string;
  createdAt?: string;
  updatedAt?: string;
};

/**
 * The human decisions that are stored.
 *
 * Lives here rather than beside the display mapping because it is a domain
 * fact — what an operator is allowed to decide about a defect — and `services`
 * depends on `domain`, never the other way round.
 */
export type TriageState = 'dismissed' | 'accepted-risk' | 'assigned';

export type ReportAudience = 'legal' | 'dev' | 'exec';

export type StoredReport = {
  id: string;
  /**
   * The run this report was issued against. Pinned, never "the latest" — a
   * link sent to a regulator must not change meaning after the next nightly.
   */
  requestId: string;
  audience?: ReportAudience;
  title?: string;
  issuedBy?: string;
  /** Null means revoked; the token is cleared rather than the row deleted. */
  shareToken?: string;
  revokedAt?: string;
  createdAt: string;
};

export type ActivityEvent = {
  id?: number;
  clientId?: string;
  /** The configured operator name. A name, not a foreign key. */
  actor: string;
  action: string;
  subject?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

export interface ClientStore {
  listClients(): Promise<StoredClient[]>;
  getClient(id: string): Promise<StoredClient | null>;
  upsertClient(client: Omit<StoredClient, 'createdAt'>): Promise<void>;
  getClientConfig(clientId: string): Promise<Record<string, unknown> | null>;
  setClientConfig(clientId: string, data: Record<string, unknown>): Promise<void>;
}

export interface JourneyStore {
  listJourneys(clientId?: string): Promise<StoredJourney[]>;
  getJourney(id: string): Promise<StoredJourney | null>;
  upsertJourney(
    journey: Omit<StoredJourney, 'createdAt' | 'updatedAt' | 'archivedAt'>,
  ): Promise<void>;
  /** Archive, never delete: deleting a journey cascades away its run history. */
  archiveJourney(id: string): Promise<void>;
}

export interface TriageStore {
  listTriage(clientId: string): Promise<TriageEntry[]>;
  setTriage(entry: TriageEntry): Promise<void>;
  clearTriage(clientId: string, findingKey: string): Promise<void>;
}

export interface ReportStore {
  createReport(input: Omit<StoredReport, 'createdAt'>): Promise<void>;
  getReport(id: string): Promise<StoredReport | null>;
  getReportByToken(token: string): Promise<StoredReport | null>;
  revokeShareToken(id: string): Promise<void>;
  listReports(requestIds: string[]): Promise<StoredReport[]>;
}

export interface ActivityStore {
  recordEvent(event: ActivityEvent): Promise<void>;
  listEvents(options?: { clientId?: string; limit?: number }): Promise<ActivityEvent[]>;
}

export type PlatformStore = ClientStore &
  JourneyStore &
  TriageStore &
  ReportStore &
  ActivityStore;
