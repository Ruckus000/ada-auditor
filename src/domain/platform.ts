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
  listJourneys(clientId?: string): Promise<StoredJourney[]>;
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

export type PlatformStore = OperatorStore &
  ClientStore &
  JourneyStore &
  TriageStore &
  ReportStore &
  ActivityStore;
