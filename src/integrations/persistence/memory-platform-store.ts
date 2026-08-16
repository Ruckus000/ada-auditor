import { journeyRunRefusal, UNASSIGNED_CLIENT_ID } from '../../domain/platform';
import type {
  ActivityEvent,
  PlatformStore,
  StoredClient,
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
export class MemoryPlatformStore implements PlatformStore {
  private readonly operators = new Map<string, StoredOperatorWithSecret>();
  private readonly clients = new Map<string, StoredClient>();
  private readonly configs = new Map<string, Record<string, unknown>>();
  private readonly journeys = new Map<string, StoredJourney>();
  private readonly triage = new Map<string, TriageEntry>();
  private readonly reports = new Map<string, StoredReport>();
  private readonly events: ActivityEvent[] = [];
  private nextEventId = 1;

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

  async listJourneys(clientId?: string): Promise<StoredJourney[]> {
    return [...this.journeys.values()]
      .filter((journey) => journey.archivedAt === undefined)
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
      .filter((entry) => entry.clientId === clientId)
      .map((entry) => structuredClone(entry));
  }

  async setTriage(entry: TriageEntry): Promise<void> {
    const key = this.triageKey(entry.clientId, entry.findingKey);
    const existing = this.triage.get(key);
    this.triage.set(
      key,
      structuredClone({
        ...entry,
        createdAt: existing?.createdAt ?? MemoryPlatformStore.now(),
        updatedAt: MemoryPlatformStore.now(),
      }),
    );
  }

  async clearTriage(clientId: string, findingKey: string): Promise<void> {
    this.triage.delete(this.triageKey(clientId, findingKey));
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

  async listEvents(
    options: { clientId?: string; limit?: number } = {},
  ): Promise<ActivityEvent[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);

    return [...this.events]
      .filter((event) => options.clientId === undefined || event.clientId === options.clientId)
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
