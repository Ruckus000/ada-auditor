import type { RemediationSummary } from './document-remediation';
import type { DocumentLinkKind } from './discovery';

/**
 * The catalog the screens read: clients, journeys, triage, reports, activity,
 * document inspections.
 *
 * Deliberately NOT part of `RunStore`. That interface is the audit engine's
 * persistence dependency — injected into the browser path, chaos, and every
 * handler test — and its in-memory double exists so the fast suite needs no
 * database. Bolting twenty CRUD methods onto it would make the engine's
 * contract describe the product's admin screens, and would grow the double by
 * twenty methods the engine never calls.
 */

/**
 * The client row that anchors journeys nobody registered.
 *
 * `saveRun` materialises a journey for any `journeyId` it has never seen, and
 * `journeys.client_id` is a foreign key, so *some* client row has to exist for
 * that write to succeed. This is it.
 *
 * It is a foreign-key anchor, not a catalog entry, so `listClients` leaves it
 * out — the portfolio starts empty, and a run posted straight to
 * `/api/audit/run` must not put a client on it that nobody added. `getClient`
 * still resolves it, so `/clients/client-unassigned` remains reachable by an
 * operator who knows the id: hidden from the catalog, not from the product.
 */
export const UNASSIGNED_CLIENT_ID = 'client-unassigned';

export type StoredClient = {
  id: string;
  name: string;
  /** A free-text name. There is no per-user identity to point at. */
  owner?: string;
  createdAt: string;
};

/**
 * The longest a journey's name may be.
 *
 * Exported for the same reason `MAX_STEP_TEXT` and `MAX_STEPS_PER_JOURNEY`
 * are: the create route caps this and answers `invalid_request_body` past it,
 * a code that names no field — so a screen that offers a name box has to know
 * the number in order to stop an operator reaching that answer at all.
 * `DiscoverPages` puts it on the input as `maxLength`.
 *
 * Here rather than in the route, because a client component importing a route
 * module would drag the persistence layer into the browser bundle, and because
 * a cap on a stored journey's field belongs beside the type that field is on.
 */
export const MAX_JOURNEY_NAME = 120;

/**
 * The longest a triage note may be.
 *
 * Here for the same reason `MAX_JOURNEY_NAME` is: the triage route caps this
 * and answers `invalid_request_body` past it, a code that names no field — so
 * the textarea that offers the note has to know the number in order to stop an
 * operator reaching that answer at all. This file has no runtime imports —
 * its one import is type-only, erased at compile — so a client component can
 * read it without dragging persistence into the browser bundle.
 *
 * The note is required for `dismissed` and `accepted-risk` alike, so both
 * decisions are capped by this one number rather than by two that can drift.
 */
export const MAX_TRIAGE_NOTE = 2000;

export type JourneySchedule = 'off' | 'daily' | 'weekly';

export type StoredJourney = {
  id: string;
  clientId: string;
  name: string;
  targetUrl?: string;
  /**
   * Which action policy a run against this journey gets. Absent on rows
   * written before it existed; callers treat that as `production`, the
   * strictest set — widening is a deliberate act, never a default.
   */
  environment?: string;
  /**
   * The `JourneyStep[]` the runner walks, stored whole. A credential is
   * referenced here, never inlined — the same rule that keeps secrets out of
   * request bodies keeps them out of this column.
   */
  steps: unknown[];
  /**
   * Extra hosts a run of this journey may pass through, beyond the target's
   * own.
   *
   * For third-party sign-in and nothing else: an app that hands off to Okta,
   * Entra or Auth0 fails on its first step without one, because the allowlist
   * is otherwise the target's host alone. Absent on every row written before
   * the column, which reads the same as empty.
   *
   * Matched as host-or-subdomain, so one entry covers a provider's tenants.
   * `allowedHostsSchema` in `domain/allowed-hosts.ts` is what may be written
   * here; the target's own host is added by the runner and is never in this
   * list.
   */
  allowedHosts?: string[];
  /**
   * How often this journey re-runs. `off` unless somebody chose otherwise —
   * a tool that walks other people's sites does not start doing so on a timer
   * because a row defaulted.
   */
  schedule?: JourneySchedule;
  /** UTC hour the daily/weekly tick fires in. Defaults to 3 when unset. */
  scheduleHour?: number;
  /** Stamped when the scheduler claims this journey. Idempotence hangs on it. */
  lastScheduledAt?: string;
  /** Journeys archive rather than delete: `runs` cascades from them. */
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Why a journey cannot be run, or `null` when it can.
 *
 * One decision, because it had become four that disagreed. Each was written
 * for the case in front of it:
 *
 * - the run route refused a journey with no target, and (since the
 *   fixture-walk fix) one with no steps;
 * - the schedule route refused only the first, so a journey that could never
 *   run could still be booked daily, forever;
 * - `client-detail` offered the "Run now" button on the same half-check, so
 *   the operator learned by clicking;
 * - the scheduler's claim query selected on `target_url is not null` alone.
 *
 * The disagreement is the bug. A caller asks here and renders or refuses on
 * the answer; the code it returns is the same string the routes put on the
 * wire, so the screen and the API cannot drift apart either.
 *
 * Both refusals exist for the same reason: a journey names a site and a path
 * through it, and a run missing either one gets the gap filled in with our own
 * fixture app — a green audit of demo pages, or of `https://their-site/
 * login.html`, filed under a real client's name.
 */
export type JourneyRunRefusal = 'journey_not_runnable' | 'journey_has_no_steps';

export function journeyRunRefusal(
  journey: Pick<StoredJourney, 'targetUrl' | 'steps'>,
): JourneyRunRefusal | null {
  if (!journey.targetUrl) return 'journey_not_runnable';
  // `steps` is `unknown[]` on the way out of the store and genuinely arbitrary
  // JSON on the way in, so a row can hold something that is not an array at
  // all. That is not a runnable journey either.
  if (!Array.isArray(journey.steps) || journey.steps.length === 0) {
    return 'journey_has_no_steps';
  }
  return null;
}

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
  /** The assignee's name as it read at assignment time. */
  assignee?: string;
  /** The account, when the assignee is a real operator. */
  assigneeOperatorId?: string;
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

/**
 * One document as an issued report describes it. The shape a report SNAPSHOT
 * stores — plain data, in domain for the same reason `RemediationSummary` is:
 * the store and the services both speak it, and domain imports from neither.
 *
 * Field by field from the inventory record, never a spread of a summary:
 * `RemediationSummary` carries `titleText`, the shared report page is
 * public-by-token, and document content stays off the public surface.
 */
export type DocumentReportEntry = {
  /** The document's address, or the operator's filename for an upload. */
  url: string;
  kind: DocumentLinkKind;
  source: DocumentInspectionSource;
  foundOn?: string;
  /** When the latest reading was taken, and by which instrument pass. */
  readAt: string;
  readBy: 'inspection' | 'conversion';
  tagged: boolean;
  pages: number;
  /** Verbatim gap strings — rephrasing them would be a copy free to drift. */
  gaps: string[];
};

export type DocumentReportSection = {
  capturedAt: string;
  totals: {
    documents: number;
    byKind: Partial<Record<DocumentLinkKind, number>>;
    /** Documents with at least one instrument reading. */
    read: number;
    /** Read documents whose latest reading still names gaps. */
    withGaps: number;
    /**
     * On record, never read. Counted but contributing no gap lines — a gap
     * list comes from an instrument reading, not from absence.
     */
    unread: number;
  };
  /** Only documents WITH a reading; the totals account for the rest. */
  entries: DocumentReportEntry[];
};

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
  /**
   * The client's document inventory as it stood when this report was issued —
   * a SNAPSHOT, captured once by the issuing route and never recomputed, so
   * the pinning guarantee above covers the whole document. Absent on reports
   * issued before the section existed, and on clients with no documents;
   * absent renders as nothing.
   */
  documents?: DocumentReportSection;
  /** Null means revoked; the token is cleared rather than the row deleted. */
  shareToken?: string;
  revokedAt?: string;
  createdAt: string;
};

export type ActivityEvent = {
  id?: number;
  clientId?: string;
  /**
   * The name as it read at the time. Still text, still not a foreign key.
   *
   * `actorOperatorId` beside it is the account, when there was one. The name
   * stays authoritative for display and is never backfilled or rewritten: an
   * activity feed is a historical record, and an operator who has since been
   * renamed did not do the thing under their new name. It is also what keeps
   * events written by automation legible, since those have no account at all.
   */
  actor: string;
  /** Absent for anything done by CI, a script, or the scheduler. */
  actorOperatorId?: string;
  action: string;
  subject?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

/**
 * A person who signs in.
 *
 * The product ran on one shared `AUDITOR_RUN_TOKEN` that was simultaneously
 * identity, authentication, authorization and the session signing key. That
 * made three things impossible at once: attributing an action to a person,
 * assigning a finding to anyone, and revoking one operator without logging out
 * everybody. This type is what makes all three possible.
 *
 * There is still exactly one organisation. Every operator sees every client —
 * that is the product, not an oversight — so nothing here scopes data. What it
 * scopes is *who did it*.
 *
 * `passwordHash` never leaves the store. `listOperators` omits it entirely
 * rather than blanking it, so there is no shape in which a hash can be
 * accidentally serialised into a response.
 */
export type StoredOperator = {
  id: string;
  email: string;
  name: string;
  /**
   * Bumped to invalidate that operator's outstanding sessions without touching
   * anyone else's. The session cookie carries the epoch it was minted at, so a
   * bump is a revocation with no server-side session table to keep.
   */
  sessionEpoch: number;
  disabledAt?: string;
  createdAt: string;
  updatedAt: string;
};

/** As above, plus the hash. Returned only by the lookups that verify a sign-in. */
export type StoredOperatorWithSecret = StoredOperator & { passwordHash: string };

export interface OperatorStore {
  listOperators(): Promise<StoredOperator[]>;
  getOperator(id: string): Promise<StoredOperator | null>;
  /** Case-insensitive: an email address is not case-sensitive to its owner. */
  getOperatorByEmail(email: string): Promise<StoredOperatorWithSecret | null>;
  /**
   * Creates or updates by **email**, not by id.
   *
   * `email` is unique and a disabled operator keeps their row, so an insert
   * would fail for anyone ever disabled — turning "re-hire" into a manual psql
   * session. Upserting on email also means re-enabling is `disabledAt: undefined`
   * rather than a second code path.
   */
  upsertOperator(input: {
    id: string;
    email: string;
    name: string;
    passwordHash: string;
    disabledAt?: string;
  }): Promise<void>;
  bumpSessionEpoch(id: string): Promise<void>;
  setOperatorDisabled(id: string, disabled: boolean): Promise<void>;
}

export interface ClientStore {
  listClients(): Promise<StoredClient[]>;
  getClient(id: string): Promise<StoredClient | null>;
  upsertClient(client: Omit<StoredClient, 'createdAt'>): Promise<void>;
  getClientConfig(clientId: string): Promise<Record<string, unknown> | null>;
  setClientConfig(clientId: string, data: Record<string, unknown>): Promise<void>;
}

export interface JourneyStore {
  /**
   * `includeArchived` exists for one caller: minting a new journey's id. An
   * archived journey's id is retired, not vacant — `upsertJourney`'s
   * on-conflict update preserves `archived_at`, so reusing the id would
   * resurrect the old row as a journey that is born archived, invisible and
   * unrunnable from the moment it is "created". Every other caller wants the
   * default: archived journeys hidden from the catalog.
   */
  listJourneys(
    clientId?: string,
    options?: { includeArchived?: boolean },
  ): Promise<StoredJourney[]>;
  getJourney(id: string): Promise<StoredJourney | null>;
  upsertJourney(
    journey: Omit<StoredJourney, 'createdAt' | 'updatedAt' | 'archivedAt'>,
  ): Promise<void>;
  /** Archive, never delete: deleting a journey cascades away its run history. */
  archiveJourney(id: string): Promise<void>;
  /**
   * Claims the journeys due to run now, stamping `lastScheduledAt` as it goes.
   *
   * Claim and select in one operation: a select-then-update would let two
   * overlapping ticks both start the same journey, and read-committed
   * isolation means a transaction around the pair would not stop them. Only claimed rows
   * are returned, so a tick that crashes after claiming loses one cycle rather
   * than looping on one journey forever.
   */
  claimDueJourneys(limit: number, now?: Date): Promise<StoredJourney[]>;
  /**
   * Gives a claimed journey back, because dispatching it failed.
   *
   * Without this a claim was permanent: `claimDueJourneys` stamps
   * `lastScheduledAt` inside the claiming statement, before anything has been
   * dispatched, and a failed dispatch left the stamp — so a run that never
   * started was recorded as done and waited for its next window.
   *
   * Releases to null rather than to the previous timestamp. Nothing reads this
   * column except the claim query itself, so the only question it has to
   * answer is "is this journey claimable", and null is the unambiguous yes.
   */
  releaseJourneyClaim(journeyId: string): Promise<void>;
}

export interface TriageStore {
  listTriage(clientId: string): Promise<TriageEntry[]>;
  setTriage(entry: TriageEntry): Promise<void>;
  clearTriage(clientId: string, findingKey: string): Promise<void>;
}

/**
 * A stored login for one client, named by the same `credentialRef` a journey
 * step uses.
 *
 * Both halves together, because a login is a pair: the schema's two ciphertext
 * columns are `not null`, and a store that accepted half a credential would
 * hand the runner a login guaranteed to fail its `expect` step.
 */
export type ClientCredentialValues = { user: string; pass: string };

/**
 * What a screen may know about a stored credential: that it exists, which
 * fields it carries, and when it last changed. Deliberately value-free — the
 * write-only API is built on this shape, and a value here would be one spread
 * away from a response body.
 */
export type ClientCredentialPresence = {
  ref: string;
  user: boolean;
  pass: boolean;
  updatedAt: string;
};

/**
 * Where a client's login values live, encrypted, once an operator pastes them.
 *
 * The *reference* stays in the journey — "credentials are referenced, never
 * inlined" is unchanged. What this moves is the value: from a deployment
 * environment variable somebody sets by hand and redeploys for, to a row
 * written once through the UI. Resolution at run time is store first, env
 * fallback second, so every journey that predates this keeps working.
 *
 * `getClientCredentialValues` is the run path's read and the only member that
 * returns a value. Routes never call it: no HTTP response carries a credential
 * out, which is what makes the store write-only from the outside.
 */
export interface ClientCredentialStore {
  setClientCredential(
    clientId: string,
    ref: string,
    values: ClientCredentialValues,
  ): Promise<void>;
  /** Presence only, ordered by ref. Never a value. */
  listClientCredentialRefs(clientId: string): Promise<ClientCredentialPresence[]>;
  deleteClientCredential(clientId: string, ref: string): Promise<void>;
  /** Decrypts. Run path only — never behind an HTTP response. */
  getClientCredentialValues(
    clientId: string,
    ref: string,
  ): Promise<ClientCredentialValues | null>;
}

export interface ReportStore {
  createReport(input: Omit<StoredReport, 'createdAt'>): Promise<void>;
  getReport(id: string): Promise<StoredReport | null>;
  getReportByToken(token: string): Promise<StoredReport | null>;
  revokeShareToken(id: string): Promise<void>;
  listReports(requestIds: string[]): Promise<StoredReport[]>;
}

/**
 * What the scheduler records when a due journey did not start.
 *
 * A run refused before it was recorded leaves no run row, and that is the
 * decision rather than an oversight: `getLatestRun` has no status filter and
 * four screens read "the latest run" unfiltered, so a synthetic row would
 * become the last run on every one of them and the next run's regression
 * baseline. An activity event has neither problem — the tick already writes
 * one on the success path, so this is the same record for the other outcome.
 *
 * The action is a constant rather than a literal because three parties have to
 * agree on it: the tick writes it, `/api/platform/activity` filters on it, and
 * `.github/workflows/failed-runs.yml` counts it. Free-text `action` is
 * load-bearing for a machine here, and the exported string plus the workflow's
 * pinning test is what stops a copy-edit breaking an alert.
 */
export const SCHEDULED_RUN_NOT_STARTED = 'could not start a scheduled run';

/**
 * Why it did not start. One action, cause in metadata.
 *
 * `status` is absent when there was no response at all — a thrown `fetch` did
 * not receive one, and a null would claim otherwise. `code` is the run route's
 * own refusal code where it could be read, and `dispatch_error` /
 * `unreadable_response` where it could not.
 */
export type ScheduledRunNotStarted = {
  journeyId: string;
  status?: number;
  code: string;
};

/**
 * How many activity events one `listEvents` call may return.
 *
 * Mirrors `clampRunListLimit` in `domain/persistence.ts`, and exists for the
 * reason that helper exists: the rule was spelled out twice, in the Postgres
 * store and the memory double — the two places whose whole purpose is to
 * behave identically — and the contract's `length <= 200` assertion is
 * satisfied by any smaller number, so it could never have caught a drift.
 * It lives here rather than beside `clampRunListLimit` because this is the
 * activity log's cap and this file is the activity log's vocabulary.
 *
 * `Number.isFinite` for the same reason: the bare `Math.min(Math.max(...))`
 * answers `NaN` for a `NaN` input, which reaches Postgres as `limit NaN`.
 */
export const EVENT_LIST_DEFAULT = 50;
export const EVENT_LIST_MAX = 200;

export function clampEventListLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return EVENT_LIST_DEFAULT;
  return Math.min(Math.max(Math.floor(limit), 1), EVENT_LIST_MAX);
}

export type ListEventsOptions = {
  clientId?: string;
  /** Matched exactly. The workflow pins one value; there is no prefix search. */
  action?: string;
  /** An ISO timestamp. Events at or after it, so a window has a start key. */
  since?: string;
  limit?: number;
};

export interface ActivityStore {
  recordEvent(event: ActivityEvent): Promise<void>;
  listEvents(options?: ListEventsOptions): Promise<ActivityEvent[]>;
}

/** How this document reached the instrument. */
export type DocumentInspectionSource = 'crawl' | 'upload';

/**
 * What the document instrument said about one document, kept.
 *
 * Before this existed, nothing persisted: an operator who inspected thirty
 * documents and closed the tab had nothing. The record is the
 * `RemediationSummary` exactly as the instrument returned it — `titleText`
 * included, because the database already stores client DOM snippets in
 * `findings` and a title is milder than either. The rule that stays absolute
 * is about **logs**: a log line carries `logSafe(summary)` and the hostname
 * only, never the title and never a path, because paths name people.
 */
export type StoredDocumentInspection = {
  id: string;
  clientId: string;
  /**
   * The document this is a reading OF. Inspections and conversions both hang
   * off `StoredClientDocument` — the entity — rather than floating as rows
   * keyed by URL string, which is how two records of the same document drift
   * into looking like two documents.
   */
  documentId: string;
  /**
   * The document's address for a crawl record; the operator's own filename
   * for an upload, which is the only handle an upload has. Fine to store,
   * never to log. Kept on the inspection too, deliberately: an inspection is
   * immutable evidence, and this is the address it was true of at reading
   * time, even if the document row's own fields evolve.
   */
  url: string;
  /** The page the crawl found the link on. An upload has none. */
  foundOn?: string;
  source: DocumentInspectionSource;
  /** The summary verbatim. A store that reworded the instrument has drifted. */
  summary: RemediationSummary;
  inspectedAt: string;
};

/**
 * One of a client's documents — the entity itself, with a lifecycle.
 *
 * Before this existed the system knew *actions* (an inspection, a conversion)
 * but not the *thing*: scans were thrown away when the tab closed, a re-crawl
 * started from nothing, and two readings of one document were related only by
 * URL-string equality. This row is the identity everything else attaches to.
 *
 * `url` is the document's address for a crawl sighting and the operator's own
 * filename for an upload — one row per distinct `url` per client, first
 * sighting wins the `foundOn`. `lastSeenAt` is what a merge updates: a
 * re-scan refreshes it rather than duplicating the row, so "still linked as
 * of the last scan" is a fact the screen can state.
 */
export type StoredClientDocument = {
  id: string;
  clientId: string;
  /** Address (crawl) or the operator's filename (upload). Store, never log. */
  url: string;
  kind: DocumentLinkKind;
  source: DocumentInspectionSource;
  /** The page the crawl first saw the link on. An upload has none. */
  foundOn?: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

/** One sighting of a document, as a merge consumes it. */
export type DocumentSighting = {
  url: string;
  kind: DocumentLinkKind;
  source: DocumentInspectionSource;
  foundOn?: string;
};

/**
 * One conversion of a client's document, kept — the audit trail.
 *
 * The bytes go to the operator; what stays is the identity of what went in
 * and what came out (`sha256` each way) plus the pipeline's own account. The
 * hashes are the record's teeth: "the file we delivered is exactly the file
 * this row describes" is checkable by anyone holding the file, without the
 * store ever holding document bytes. An artifact pointer can join this row
 * later without reshaping it.
 */
export type StoredDocumentConversion = {
  id: string;
  clientId: string;
  documentId: string;
  /** The summary verbatim, as the conversion returned it. */
  summary: RemediationSummary;
  inputSha256: string;
  outputSha256: string;
  convertedAt: string;
};

/**
 * A document with the latest word on it — what the inventory screen renders.
 * History stays queryable through the per-record listings; this is the
 * one-row-per-document view an operator scans.
 */
export type ClientDocumentRecord = StoredClientDocument & {
  latestInspection?: StoredDocumentInspection;
  latestConversion?: StoredDocumentConversion;
};

/**
 * How many documents one inventory listing returns. A cap rather than paging,
 * for the reason `DOCUMENT_INSPECTION_LIST_MAX` gives — and larger than the
 * per-kind discovery caps combined, so a full scan's merge is never silently
 * absent from the very screen that asked for it.
 */
export const CLIENT_DOCUMENT_LIST_MAX = 200;

/**
 * How many inspections one listing may return.
 *
 * A cap rather than paging: the screen renders a client's recent inspections,
 * and a municipal site with more than a hundred inspected documents is a
 * paging decision to make deliberately when it happens, not a default to
 * pre-build. Newest first, so what falls off the end is the oldest.
 */
export const DOCUMENT_INSPECTION_LIST_MAX = 100;

export interface DocumentInspectionStore {
  /**
   * Saves what the instrument said, as it said it.
   *
   * A record is immutable evidence: a second save under the same id is a
   * retry, not a revision, so both stores keep the first record rather than
   * rewriting it — the same stance the runs table takes on `created_at`.
   */
  saveDocumentInspection(record: StoredDocumentInspection): Promise<void>;
  /** Newest first, capped at `DOCUMENT_INSPECTION_LIST_MAX`. */
  listDocumentInspections(clientId: string): Promise<StoredDocumentInspection[]>;
}

export interface ClientDocumentStore {
  /**
   * Merges one scan's sightings into the client's inventory. A URL not yet on
   * record gets a row (`firstSeenAt = lastSeenAt = seenAt`); a known URL gets
   * `lastSeenAt` refreshed and keeps everything else — first sighting wins
   * `foundOn`, the same rule discovery itself applies. Returns how the merge
   * fell, because "42 documents" alone cannot tell an operator whether a scan
   * found anything new.
   */
  recordDocumentSightings(
    clientId: string,
    sightings: DocumentSighting[],
    seenAt: string,
  ): Promise<{ added: number; seenAgain: number }>;
  /**
   * The single-document form of the merge, for the inspect and convert paths:
   * acting on a document the inventory has never heard of (a pasted URL, an
   * upload) must create its row, not leave the action orphaned. Returns the
   * row, existing or new.
   */
  ensureClientDocument(
    clientId: string,
    sighting: DocumentSighting,
    seenAt: string,
  ): Promise<StoredClientDocument>;
  /**
   * The inventory: every document with the latest word on it, most recently
   * seen first, capped at `CLIENT_DOCUMENT_LIST_MAX`.
   */
  listClientDocuments(clientId: string): Promise<ClientDocumentRecord[]>;
  /**
   * Immutable evidence, like an inspection: a second save under the same id
   * is a retry and the first record stands.
   */
  saveDocumentConversion(record: StoredDocumentConversion): Promise<void>;
}

export type PlatformStore = OperatorStore &
  ClientStore &
  JourneyStore &
  TriageStore &
  ClientCredentialStore &
  ReportStore &
  ActivityStore &
  DocumentInspectionStore &
  ClientDocumentStore;
