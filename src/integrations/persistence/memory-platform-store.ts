import {
  clampEventListLimit,
  DOCUMENT_INSPECTION_LIST_MAX,
  journeyRunRefusal,
  UNASSIGNED_CLIENT_ID,
} from '../../domain/platform';
import type {
  ActivityEvent,
  ClientCredentialPresence,
  ClientCredentialValues,
  ListEventsOptions,
  PlatformStore,
  StoredClient,
  StoredDocumentInspection,
  StoredJourney,
  StoredOperator,
  StoredOperatorWithSecret,
  StoredReport,
  TriageEntry,
} from '../../domain/platform';

/**
 * The catalog, in process. For tests and nothing else.
 *
 * Held to the same shared contract as `PostgresPlatformStore` — a double that
 * quietly disagrees with the real store means every route test is green about
 * behaviour production does not have. Structured-cloned on read and write for
 * the same reason: a caller cannot mutate a Postgres row by holding onto the
 * object it saved, and a double that allows it hides the bug.
 */
/**
 * A stored decision plus the order it was written in.
 *
 * The sequence is kept beside the entry rather than on it so it cannot escape
 * into a `TriageEntry` a caller reads back — the doubles' whole job is to hand
 * out exactly the shape Postgres does.
 */
type StoredTriage = { entry: TriageEntry; seq: number };

/**
 * A stored inspection plus the order it arrived in, for the same reason
 * `StoredTriage` carries one: `now()` here has millisecond resolution, so two
 * saves in one millisecond stamp the same instant and a sort on `inspectedAt`
 * alone is free to return either order. Postgres does not need it — separate
 * statements get distinct transaction timestamps.
 */
type StoredInspection = { record: StoredDocumentInspection; seq: number };

export class MemoryPlatformStore implements PlatformStore {
  private readonly operators = new Map<string, StoredOperatorWithSecret>();
  private readonly clients = new Map<string, StoredClient>();
  private readonly configs = new Map<string, Record<string, unknown>>();
  private readonly journeys = new Map<string, StoredJourney>();
  private readonly triage = new Map<string, StoredTriage>();
  /**
   * Plaintext, and that is correct *here*: this is a test double, not a secret
   * store. Encryption is the Postgres store's behaviour, exercised by the db
   * suite with a real key; a double that encrypted would need
   * `AUDITOR_CREDENTIAL_KEY` in the fast suite and would be testing the
   * cipher, which has its own tests. Nothing this class holds outlives the
   * process, and nothing real is ever put in it.
   */
  private readonly credentials = new Map<
    string,
    { values: ClientCredentialValues; updatedAt: string }
  >();
  private readonly reports = new Map<string, StoredReport>();
  private readonly documentInspections = new Map<string, StoredInspection>();
  private readonly events: ActivityEvent[] = [];
  private nextEventId = 1;
  private nextTriageSeq = 1;
  private nextInspectionSeq = 1;

  private static now(): string {
    return new Date().toISOString();
  }

  // ----------------------------------------------------------- operators --

  /** Strips the hash, mirroring the columns the Postgres store names. */
  private static withoutSecret(operator: StoredOperatorWithSecret): StoredOperator {
    const { passwordHash: _passwordHash, ...rest } = operator;
    return structuredClone(rest);
  }

  async listOperators(): Promise<StoredOperator[]> {
    return [...this.operators.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((operator) => MemoryPlatformStore.withoutSecret(operator));
  }

  async getOperator(id: string): Promise<StoredOperator | null> {
    const found = this.operators.get(id);
    return found ? MemoryPlatformStore.withoutSecret(found) : null;
  }

  async getOperatorByEmail(email: string): Promise<StoredOperatorWithSecret | null> {
    const found = [...this.operators.values()].find(
      (operator) => operator.email.toLowerCase() === email.toLowerCase(),
    );
    return found ? structuredClone(found) : null;
  }

  async upsertOperator(input: {
    id: string;
    email: string;
    name: string;
    passwordHash: string;
    disabledAt?: string;
  }): Promise<void> {
    // Matched on email rather than id, because Postgres conflicts on email:
    // a double that keyed on id would let a test add the same person twice.
    const existing = [...this.operators.values()].find(
      (operator) => operator.email.toLowerCase() === input.email.toLowerCase(),
    );
    const now = MemoryPlatformStore.now();

    this.operators.set(existing?.id ?? input.id, {
      id: existing?.id ?? input.id,
      email: existing?.email ?? input.email,
      name: input.name,
      passwordHash: input.passwordHash,
      sessionEpoch: existing?.sessionEpoch ?? 1,
      ...(input.disabledAt ? { disabledAt: input.disabledAt } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async bumpSessionEpoch(id: string): Promise<void> {
    const found = this.operators.get(id);
    if (!found) return;
    found.sessionEpoch += 1;
    found.updatedAt = MemoryPlatformStore.now();
  }

  async setOperatorDisabled(id: string, disabled: boolean): Promise<void> {
    const found = this.operators.get(id);
    if (!found) return;

    // Disabling bumps the epoch too, matching Postgres. Without it "disabled"
    // would mean "cannot sign in again" rather than "is out now".
    if (disabled) {
      found.disabledAt = MemoryPlatformStore.now();
    } else {
      delete found.disabledAt;
    }
    found.sessionEpoch += 1;
    found.updatedAt = MemoryPlatformStore.now();
  }

  // ------------------------------------------------------------- clients --

  async listClients(): Promise<StoredClient[]> {
    return [...this.clients.values()]
      .filter((client) => client.id !== UNASSIGNED_CLIENT_ID)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((client) => structuredClone(client));
  }

  async getClient(id: string): Promise<StoredClient | null> {
    const client = this.clients.get(id);
    return client ? structuredClone(client) : null;
  }

  async upsertClient(client: Omit<StoredClient, 'createdAt'>): Promise<void> {
    const existing = this.clients.get(client.id);
    // Falls back to the stored owner rather than dropping it, matching the
    // `coalesce` in the Postgres store: an omitted optional field must not
    // erase a value nobody asked to change.
    const owner = client.owner ?? existing?.owner;
    const next: StoredClient = {
      id: client.id,
      name: client.name,
      ...(owner === undefined ? {} : { owner }),
      createdAt: existing?.createdAt ?? MemoryPlatformStore.now(),
    };
    this.clients.set(client.id, structuredClone(next));
  }

  async getClientConfig(clientId: string): Promise<Record<string, unknown> | null> {
    const config = this.configs.get(clientId);
    return config ? structuredClone(config) : null;
  }

  async setClientConfig(clientId: string, data: Record<string, unknown>): Promise<void> {
    this.configs.set(clientId, structuredClone(data));
  }

  // ------------------------------------------------------------ journeys --

  async listJourneys(
    clientId?: string,
    options?: { includeArchived?: boolean },
  ): Promise<StoredJourney[]> {
    return [...this.journeys.values()]
      .filter((journey) => options?.includeArchived || journey.archivedAt === undefined)
      .filter((journey) => clientId === undefined || journey.clientId === clientId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((journey) => structuredClone(journey));
  }

  async getJourney(id: string): Promise<StoredJourney | null> {
    const journey = this.journeys.get(id);
    return journey ? structuredClone(journey) : null;
  }

  async upsertJourney(
    journey: Omit<StoredJourney, 'createdAt' | 'updatedAt' | 'archivedAt'>,
  ): Promise<void> {
    const existing = this.journeys.get(journey.id);
    const next: StoredJourney = {
      id: journey.id,
      clientId: journey.clientId,
      name: journey.name,
      ...(journey.targetUrl === undefined ? {} : { targetUrl: journey.targetUrl }),
      // Defaulted rather than left absent, matching Postgres: the columns have
      // backfills, so a journey read back always names both.
      environment: journey.environment ?? 'production',
      schedule: journey.schedule ?? 'off',
      ...(journey.scheduleHour === undefined ? {} : { scheduleHour: journey.scheduleHour }),
      // Absent rather than `[]` when unset, matching the Postgres column,
      // which is nullable for the same reason: a row written before the column
      // existed and one an operator deliberately cleared read the same, and
      // neither is worth telling apart.
      ...(journey.allowedHosts === undefined ? {} : { allowedHosts: journey.allowedHosts }),
      ...(existing?.lastScheduledAt ? { lastScheduledAt: existing.lastScheduledAt } : {}),
      steps: journey.steps ?? [],
      ...(existing?.archivedAt === undefined ? {} : { archivedAt: existing.archivedAt }),
      createdAt: existing?.createdAt ?? MemoryPlatformStore.now(),
      updatedAt: MemoryPlatformStore.now(),
    };
    this.journeys.set(journey.id, structuredClone(next));
  }

  /** Mirrors the Postgres claim, including the interval slack. */
  async claimDueJourneys(limit: number, now: Date = new Date()): Promise<StoredJourney[]> {
    const hour = now.getUTCHours();
    const dailyCutoff = now.getTime() - 23 * 60 * 60 * 1000;
    const weeklyCutoff = now.getTime() - 6 * 24 * 60 * 60 * 1000;

    const due = [...this.journeys.values()]
      .filter((journey) => {
        if (!journey.schedule || journey.schedule === 'off') return false;
        if (journey.archivedAt) return false;
        // The same refusal the run route applies, so the tick cannot claim a
        // journey that is certain to fail. Postgres spells it out in SQL.
        if (journeyRunRefusal(journey)) return false;
        if ((journey.scheduleHour ?? 3) !== hour) return false;
        if (!journey.lastScheduledAt) return true;

        const last = Date.parse(journey.lastScheduledAt);
        return last < (journey.schedule === 'weekly' ? weeklyCutoff : dailyCutoff);
      })
      .sort((a, b) => (a.lastScheduledAt ?? '').localeCompare(b.lastScheduledAt ?? ''))
      .slice(0, Math.max(1, Math.floor(limit)));

    const stamped = now.toISOString();
    return due.map((journey) => {
      const claimed = { ...journey, lastScheduledAt: stamped };
      this.journeys.set(journey.id, structuredClone(claimed));
      return structuredClone(claimed);
    });
  }

  async releaseJourneyClaim(journeyId: string): Promise<void> {
    const journey = this.journeys.get(journeyId);
    if (!journey) return;

    const { lastScheduledAt: _released, ...rest } = journey;
    this.journeys.set(journeyId, structuredClone(rest));
  }

  async archiveJourney(id: string): Promise<void> {
    const journey = this.journeys.get(id);
    if (!journey) return;
    this.journeys.set(id, { ...journey, archivedAt: MemoryPlatformStore.now() });
  }

  // -------------------------------------------------------------- triage --

  private triageKey(clientId: string, findingKey: string): string {
    return `${clientId} ${findingKey}`;
  }

  async listTriage(clientId: string): Promise<TriageEntry[]> {
    return [...this.triage.values()]
      .filter((held) => held.entry.clientId === clientId)
      // Newest decision first, matching `order by updated_at desc` and the
      // index built for it. `seq` breaks the ties, and it is not decoration:
      // `now()` here has millisecond resolution, so two writes in one
      // millisecond — which the contract does on purpose — stamp the same
      // instant and leave a sort on `updatedAt` alone free to return either
      // order. Postgres does not need it because its `now()` is per
      // transaction and these are separate statements.
      .sort((a, b) => {
        const left = a.entry.updatedAt ?? '';
        const right = b.entry.updatedAt ?? '';
        if (left !== right) return left < right ? 1 : -1;
        return b.seq - a.seq;
      })
      .map((held) => structuredClone(held.entry));
  }

  async setTriage(entry: TriageEntry): Promise<void> {
    const key = this.triageKey(entry.clientId, entry.findingKey);
    const existing = this.triage.get(key);
    this.triage.set(key, {
      // A replacement is a fresh decision, so it takes a fresh sequence and
      // sorts to the front — the same thing `updated_at = now()` does to it in
      // Postgres.
      seq: this.nextTriageSeq++,
      entry: structuredClone({
        ...entry,
        createdAt: existing?.entry.createdAt ?? MemoryPlatformStore.now(),
        updatedAt: MemoryPlatformStore.now(),
      }),
    });
  }

  async clearTriage(clientId: string, findingKey: string): Promise<void> {
    this.triage.delete(this.triageKey(clientId, findingKey));
  }

  // -------------------------------------------------- client credentials --

  private credentialKey(clientId: string, ref: string): string {
    return `${clientId} ${ref}`;
  }

  async setClientCredential(
    clientId: string,
    ref: string,
    values: ClientCredentialValues,
  ): Promise<void> {
    this.credentials.set(this.credentialKey(clientId, ref), {
      values: structuredClone(values),
      updatedAt: MemoryPlatformStore.now(),
    });
  }

  async listClientCredentialRefs(clientId: string): Promise<ClientCredentialPresence[]> {
    const prefix = `${clientId} `;
    return [...this.credentials.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, held]) => ({
        ref: key.slice(prefix.length),
        // Computed from what is held rather than hardcoded `true`, matching
        // how Postgres reads it off the ciphertext columns: the booleans are a
        // statement about the row, not about the schema.
        user: held.values.user.length > 0,
        pass: held.values.pass.length > 0,
        updatedAt: held.updatedAt,
      }))
      .sort((a, b) => a.ref.localeCompare(b.ref));
  }

  async deleteClientCredential(clientId: string, ref: string): Promise<void> {
    this.credentials.delete(this.credentialKey(clientId, ref));
  }

  async getClientCredentialValues(
    clientId: string,
    ref: string,
  ): Promise<ClientCredentialValues | null> {
    const held = this.credentials.get(this.credentialKey(clientId, ref));
    return held ? structuredClone(held.values) : null;
  }

  // ------------------------------------------------------------- reports --

  async createReport(input: Omit<StoredReport, 'createdAt'>): Promise<void> {
    const existing = this.reports.get(input.id);
    this.reports.set(
      input.id,
      structuredClone({
        ...input,
        createdAt: existing?.createdAt ?? MemoryPlatformStore.now(),
      }),
    );
  }

  async getReport(id: string): Promise<StoredReport | null> {
    const report = this.reports.get(id);
    return report ? structuredClone(report) : null;
  }

  async getReportByToken(token: string): Promise<StoredReport | null> {
    const report = [...this.reports.values()].find(
      (candidate) => candidate.shareToken === token && candidate.revokedAt === undefined,
    );
    return report ? structuredClone(report) : null;
  }

  async revokeShareToken(id: string): Promise<void> {
    const report = this.reports.get(id);
    if (!report) return;
    const { shareToken: _dropped, ...rest } = report;
    this.reports.set(id, { ...rest, revokedAt: MemoryPlatformStore.now() });
  }

  async listReports(requestIds: string[]): Promise<StoredReport[]> {
    const wanted = new Set(requestIds);
    return [...this.reports.values()]
      .filter((report) => wanted.has(report.requestId))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((report) => structuredClone(report));
  }

  // ------------------------------------------------- document inspections --

  async saveDocumentInspection(record: StoredDocumentInspection): Promise<void> {
    // A record is immutable evidence: a second save under the same id is a
    // retry, not a revision, so the first record stands. Postgres spells the
    // same rule `on conflict (id) do nothing`.
    if (this.documentInspections.has(record.id)) return;

    // Built field by field rather than cloned whole, so an explicitly-passed
    // `foundOn: undefined` stores as *absent* — the shape Postgres hands back
    // for a null column — rather than as a present key holding undefined.
    const next: StoredDocumentInspection = {
      id: record.id,
      clientId: record.clientId,
      url: record.url,
      ...(record.foundOn === undefined ? {} : { foundOn: record.foundOn }),
      source: record.source,
      summary: record.summary,
      inspectedAt: record.inspectedAt,
    };

    this.documentInspections.set(record.id, {
      seq: this.nextInspectionSeq++,
      record: structuredClone(next),
    });
  }

  async listDocumentInspections(clientId: string): Promise<StoredDocumentInspection[]> {
    return [...this.documentInspections.values()]
      .filter((held) => held.record.clientId === clientId)
      // Newest first, ties broken by arrival order — see `StoredInspection`.
      .sort((a, b) => {
        if (a.record.inspectedAt !== b.record.inspectedAt) {
          return a.record.inspectedAt < b.record.inspectedAt ? 1 : -1;
        }
        return b.seq - a.seq;
      })
      .slice(0, DOCUMENT_INSPECTION_LIST_MAX)
      .map((held) => structuredClone(held.record));
  }

  // ------------------------------------------------------------ activity --

  async recordEvent(event: ActivityEvent): Promise<void> {
    this.events.push(
      structuredClone({
        ...event,
        id: this.nextEventId++,
        metadata: event.metadata ?? {},
        createdAt: event.createdAt ?? MemoryPlatformStore.now(),
      }),
    );
  }

  async listEvents(options: ListEventsOptions = {}): Promise<ActivityEvent[]> {
    const limit = clampEventListLimit(options.limit);
    // Parsed rather than string-compared. Postgres casts `since` to
    // `timestamptz` and compares instants, and the caller that matters — the
    // failed-runs workflow — sends `2026-08-25T11:51:28Z` with no
    // milliseconds, which sorts *before* the same instant written
    // `…:28.000Z` as text. A lexical compare here would drop an event the
    // Postgres store returns.
    const since = options.since === undefined ? undefined : Date.parse(options.since);

    return [...this.events]
      .filter((event) => options.clientId === undefined || event.clientId === options.clientId)
      .filter((event) => options.action === undefined || event.action === options.action)
      .filter((event) => since === undefined || Date.parse(event.createdAt ?? '') >= since)
      // Newest first, ties broken by id — the same total order the Postgres
      // index gives, so a test cannot pass against one store and fail the other.
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) return (a.createdAt ?? '') < (b.createdAt ?? '') ? 1 : -1;
        return (b.id ?? 0) - (a.id ?? 0);
      })
      .slice(0, limit)
      .map((event) => structuredClone(event));
  }
}
