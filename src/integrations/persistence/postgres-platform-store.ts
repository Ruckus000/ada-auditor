import type {
  ActivityEvent,
  PlatformStore,
  ReportAudience,
  StoredClient,
  StoredJourney,
  StoredReport,
  TriageEntry,
  TriageState,
} from '../../domain/platform';
import type { SqlClient } from './postgres-run-store';

/**
 * The catalog, in Postgres.
 *
 * One class over five interfaces rather than five classes over one connection:
 * they share a client, a row-mapping style and a lifetime, and splitting them
 * would buy five constructors and no isolation.
 *
 * Raw SQL for the same reason `PostgresRunStore` uses it — the shapes already
 * exist as domain types, and an ORM here would add a second schema definition
 * to keep in sync with `schema.sql`.
 */

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Optional columns are omitted rather than set to `undefined`, so a record
 * read back is `toEqual`-identical to the one written. */
function optional<T extends object, K extends string, V>(
  key: K,
  value: V | null | undefined,
): T | Record<K, V> {
  return (value === null || value === undefined ? {} : { [key]: value }) as Record<K, V>;
}

export class PostgresPlatformStore implements PlatformStore {
  constructor(private readonly sql: SqlClient) {}

  // ------------------------------------------------------------- clients --

  async listClients(): Promise<StoredClient[]> {
    const rows = await this.sql<{
      id: string;
      name: string;
      owner: string | null;
      created_at: Date | string;
    }>`select id, name, owner, created_at from clients order by name asc`;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      ...optional('owner', row.owner),
      createdAt: toIso(row.created_at),
    })) as StoredClient[];
  }

  async getClient(id: string): Promise<StoredClient | null> {
    const rows = await this.sql<{
      id: string;
      name: string;
      owner: string | null;
      created_at: Date | string;
    }>`select id, name, owner, created_at from clients where id = ${id}`;

    if (rows.length === 0) return null;
    const row = rows[0];

    return {
      id: row.id,
      name: row.name,
      ...optional('owner', row.owner),
      createdAt: toIso(row.created_at),
    } as StoredClient;
  }

  async upsertClient(client: Omit<StoredClient, 'createdAt'>): Promise<void> {
    await this.sql`
      insert into clients (id, name, owner)
      values (${client.id}, ${client.name}, ${client.owner ?? null})
      on conflict (id) do update set name = excluded.name, owner = excluded.owner
    `;
  }

  async getClientConfig(clientId: string): Promise<Record<string, unknown> | null> {
    const rows = await this.sql<{ data: Record<string, unknown> }>`
      select data from client_config where client_id = ${clientId}
    `;
    return rows.length === 0 ? null : rows[0].data;
  }

  async setClientConfig(clientId: string, data: Record<string, unknown>): Promise<void> {
    await this.sql`
      insert into client_config (client_id, data, updated_at)
      values (${clientId}, ${JSON.stringify(data)}::jsonb, now())
      on conflict (client_id) do update set data = excluded.data, updated_at = now()
    `;
  }

  // ------------------------------------------------------------ journeys --

  private mapJourney(row: {
    id: string;
    client_id: string;
    name: string;
    target_url: string | null;
    steps: unknown[];
    archived_at: Date | string | null;
    created_at: Date | string;
    updated_at: Date | string;
  }): StoredJourney {
    return {
      id: row.id,
      clientId: row.client_id,
      name: row.name,
      ...optional('targetUrl', row.target_url),
      steps: row.steps ?? [],
      ...optional('archivedAt', row.archived_at ? toIso(row.archived_at) : null),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    } as StoredJourney;
  }

  async listJourneys(clientId?: string): Promise<StoredJourney[]> {
    // Archived journeys are excluded here rather than filtered by callers: a
    // screen that forgets the filter would show journeys an operator retired,
    // and the archive would read as a no-op.
    const rows = clientId
      ? await this.sql<never>`
          select * from journeys
          where client_id = ${clientId} and archived_at is null
          order by name asc
        `
      : await this.sql<never>`
          select * from journeys where archived_at is null order by name asc
        `;

    return rows.map((row) => this.mapJourney(row));
  }

  async getJourney(id: string): Promise<StoredJourney | null> {
    const rows = await this.sql<never>`select * from journeys where id = ${id}`;
    return rows.length === 0 ? null : this.mapJourney(rows[0]);
  }

  async upsertJourney(
    journey: Omit<StoredJourney, 'createdAt' | 'updatedAt' | 'archivedAt'>,
  ): Promise<void> {
    await this.sql`
      insert into journeys (id, client_id, name, target_url, steps, updated_at)
      values (
        ${journey.id}, ${journey.clientId}, ${journey.name},
        ${journey.targetUrl ?? null}, ${JSON.stringify(journey.steps ?? [])}::jsonb, now()
      )
      on conflict (id) do update set
        client_id = excluded.client_id,
        name = excluded.name,
        target_url = excluded.target_url,
        steps = excluded.steps,
        updated_at = now()
    `;
  }

  async archiveJourney(id: string): Promise<void> {
    await this.sql`update journeys set archived_at = now() where id = ${id}`;
  }

  // -------------------------------------------------------------- triage --

  private mapTriage(row: {
    client_id: string;
    finding_key: string;
    source: string;
    code: string;
    page_url: string | null;
    selector: string | null;
    state: string;
    note: string | null;
    assignee: string | null;
    actor: string;
    created_at: Date | string;
    updated_at: Date | string;
  }): TriageEntry {
    return {
      clientId: row.client_id,
      findingKey: row.finding_key,
      source: row.source,
      code: row.code,
      ...optional('pageUrl', row.page_url),
      ...optional('selector', row.selector),
      state: row.state as TriageState,
      ...optional('note', row.note),
      ...optional('assignee', row.assignee),
      actor: row.actor,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    } as TriageEntry;
  }

  async listTriage(clientId: string): Promise<TriageEntry[]> {
    const rows = await this.sql<never>`
      select * from finding_triage where client_id = ${clientId}
      order by updated_at desc
    `;
    return rows.map((row) => this.mapTriage(row));
  }

  async setTriage(entry: TriageEntry): Promise<void> {
    await this.sql`
      insert into finding_triage (
        client_id, finding_key, source, code, page_url, selector,
        state, note, assignee, actor, updated_at
      ) values (
        ${entry.clientId}, ${entry.findingKey}, ${entry.source}, ${entry.code},
        ${entry.pageUrl ?? null}, ${entry.selector ?? null}, ${entry.state},
        ${entry.note ?? null}, ${entry.assignee ?? null}, ${entry.actor}, now()
      )
      on conflict (client_id, finding_key) do update set
        state = excluded.state,
        note = excluded.note,
        assignee = excluded.assignee,
        actor = excluded.actor,
        updated_at = now()
    `;
  }

  async clearTriage(clientId: string, findingKey: string): Promise<void> {
    await this.sql`
      delete from finding_triage
      where client_id = ${clientId} and finding_key = ${findingKey}
    `;
  }

  // ------------------------------------------------------------- reports --

  private mapReport(row: {
    id: string;
    request_id: string;
    audience: string | null;
    title: string | null;
    issued_by: string | null;
    share_token: string | null;
    revoked_at: Date | string | null;
    created_at: Date | string;
  }): StoredReport {
    return {
      id: row.id,
      requestId: row.request_id,
      ...optional('audience', row.audience as ReportAudience | null),
      ...optional('title', row.title),
      ...optional('issuedBy', row.issued_by),
      ...optional('shareToken', row.share_token),
      ...optional('revokedAt', row.revoked_at ? toIso(row.revoked_at) : null),
      createdAt: toIso(row.created_at),
    } as StoredReport;
  }

  async createReport(input: Omit<StoredReport, 'createdAt'>): Promise<void> {
    await this.sql`
      insert into reports (id, request_id, audience, title, issued_by, share_token)
      values (
        ${input.id}, ${input.requestId}, ${input.audience ?? null},
        ${input.title ?? null}, ${input.issuedBy ?? null}, ${input.shareToken ?? null}
      )
      on conflict (id) do update set
        audience = excluded.audience,
        title = excluded.title,
        issued_by = excluded.issued_by,
        share_token = excluded.share_token
    `;
  }

  async getReport(id: string): Promise<StoredReport | null> {
    const rows = await this.sql<never>`select * from reports where id = ${id}`;
    return rows.length === 0 ? null : this.mapReport(rows[0]);
  }

  async getReportByToken(token: string): Promise<StoredReport | null> {
    // A revoked report is not findable by its old token. Revocation nulls the
    // token, so this cannot match one — but the explicit guard keeps that true
    // even if revocation ever starts keeping the token for audit purposes.
    const rows = await this.sql<never>`
      select * from reports where share_token = ${token} and revoked_at is null
    `;
    return rows.length === 0 ? null : this.mapReport(rows[0]);
  }

  async revokeShareToken(id: string): Promise<void> {
    await this.sql`
      update reports set share_token = null, revoked_at = now() where id = ${id}
    `;
  }

  async listReports(requestIds: string[]): Promise<StoredReport[]> {
    if (requestIds.length === 0) return [];
    const rows = await this.sql<never>`
      select * from reports where request_id = any(${requestIds})
      order by created_at desc
    `;
    return rows.map((row) => this.mapReport(row));
  }

  // ------------------------------------------------------------ activity --

  async recordEvent(event: ActivityEvent): Promise<void> {
    await this.sql`
      insert into activity_events (client_id, actor, action, subject, metadata)
      values (
        ${event.clientId ?? null}, ${event.actor}, ${event.action},
        ${event.subject ?? null}, ${JSON.stringify(event.metadata ?? {})}::jsonb
      )
    `;
  }

  async listEvents(
    options: { clientId?: string; limit?: number } = {},
  ): Promise<ActivityEvent[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const clientId = options.clientId ?? null;

    const rows = await this.sql<{
      id: number;
      client_id: string | null;
      actor: string;
      action: string;
      subject: string | null;
      metadata: Record<string, unknown>;
      created_at: Date | string;
    }>`
      select * from activity_events
      where (${clientId}::text is null or client_id = ${clientId})
      order by created_at desc, id desc
      limit ${limit}
    `;

    return rows.map((row) => ({
      id: Number(row.id),
      ...optional('clientId', row.client_id),
      actor: row.actor,
      action: row.action,
      ...optional('subject', row.subject),
      metadata: row.metadata ?? {},
      createdAt: toIso(row.created_at),
    })) as ActivityEvent[];
  }
}
