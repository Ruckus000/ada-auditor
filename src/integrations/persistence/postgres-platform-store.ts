import { UNASSIGNED_CLIENT_ID } from '../../domain/platform';
import type {
  ActivityEvent,
  PlatformStore,
  ReportAudience,
  StoredClient,
  StoredJourney,
  StoredOperator,
  StoredOperatorWithSecret,
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

/**
 * Row shapes, named so the queries can be typed.
 *
 * These were `sql<never>`, which types every row as `never` — assignable to
 * any mapper parameter, so a renamed column would have compiled cleanly and
 * produced `undefined` at runtime.
 */
type OperatorRow = {
  id: string;
  email: string;
  name: string;
  session_epoch: number;
  disabled_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type JourneyRow = {
  id: string;
  client_id: string;
  name: string;
  target_url: string | null;
  environment: string | null;
  schedule: string | null;
  schedule_hour: number | null;
  last_scheduled_at: Date | string | null;
  steps: unknown[];
  archived_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type TriageRow = {
  client_id: string;
  finding_key: string;
  source: string;
  code: string;
  page_url: string | null;
  selector: string | null;
  state: string;
  note: string | null;
  assignee: string | null;
  assignee_operator_id: string | null;
  actor: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type ReportRow = {
  id: string;
  request_id: string;
  audience: string | null;
  title: string | null;
  issued_by: string | null;
  share_token: string | null;
  revoked_at: Date | string | null;
  created_at: Date | string;
};

export class PostgresPlatformStore implements PlatformStore {
  constructor(private readonly sql: SqlClient) {}

  // ----------------------------------------------------------- operators --

  /** Without the hash, by construction — there is no shape here that carries it. */
  private mapOperator(row: OperatorRow): StoredOperator {
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      sessionEpoch: Number(row.session_epoch),
      ...optional('disabledAt', row.disabled_at ? toIso(row.disabled_at) : null),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    } as StoredOperator;
  }

  async listOperators(): Promise<StoredOperator[]> {
    // Columns named rather than `select *`: this result feeds an API response,
    // and `select *` would carry `password_hash` into a shape one careless
    // spread away from being serialised.
    const rows = await this.sql<OperatorRow>`
      select id, email, name, session_epoch, disabled_at, created_at, updated_at
      from operators order by name asc
    `;
    return rows.map((row) => this.mapOperator(row));
  }

  async getOperator(id: string): Promise<StoredOperator | null> {
    const rows = await this.sql<OperatorRow>`
      select id, email, name, session_epoch, disabled_at, created_at, updated_at
      from operators where id = ${id}
    `;
    return rows[0] ? this.mapOperator(rows[0]) : null;
  }

  async getOperatorByEmail(email: string): Promise<StoredOperatorWithSecret | null> {
    const rows = await this.sql<OperatorRow & { password_hash: string }>`
      select id, email, name, session_epoch, disabled_at, created_at, updated_at, password_hash
      from operators where lower(email) = lower(${email})
    `;
    return rows[0]
      ? { ...this.mapOperator(rows[0]), passwordHash: rows[0].password_hash }
      : null;
  }

  async upsertOperator(input: {
    id: string;
    email: string;
    name: string;
    passwordHash: string;
    disabledAt?: string;
  }): Promise<void> {
    // Conflict on email, not id: email is the unique human identifier and a
    // disabled operator keeps their row, so inserting by id would fail for
    // anyone ever disabled. The existing id wins so activity attribution
    // survives a re-add.
    //
    // The conflict target is `lower(email)`, matching the index rather than
    // the column's own unique constraint. Targeting the column would update on
    // an exact-case match but raise a unique violation on a differently-cased
    // one — so re-adding "Sam@example.com" over "sam@example.com" would throw
    // here while the in-memory double, which compares case-insensitively,
    // quietly succeeded.
    await this.sql`
      insert into operators (id, email, name, password_hash, disabled_at)
      values (${input.id}, ${input.email}, ${input.name}, ${input.passwordHash},
              ${input.disabledAt ?? null})
      on conflict (lower(email)) do update set
        name = excluded.name,
        password_hash = excluded.password_hash,
        disabled_at = excluded.disabled_at,
        updated_at = now()
    `;
  }

  async bumpSessionEpoch(id: string): Promise<void> {
    await this.sql`
      update operators set session_epoch = session_epoch + 1, updated_at = now()
      where id = ${id}
    `;
  }

  async setOperatorDisabled(id: string, disabled: boolean): Promise<void> {
    // Disabling also bumps the epoch. Without that, a disabled operator keeps
    // a valid cookie until it expires, and "disabled" would mean "cannot sign
    // in again" rather than "is out now".
    await this.sql`
      update operators
      set disabled_at = ${disabled ? new Date().toISOString() : null},
          session_epoch = session_epoch + 1,
          updated_at = now()
      where id = ${id}
    `;
  }

  // ------------------------------------------------------------- clients --

  async listClients(): Promise<StoredClient[]> {
    const rows = await this.sql<{
      id: string;
      name: string;
      owner: string | null;
      created_at: Date | string;
    }>`
      select id, name, owner, created_at from clients
      where id <> ${UNASSIGNED_CLIENT_ID}
      order by name asc
    `;

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

  /**
   * `owner` is left alone when the caller does not supply one.
   *
   * It is optional on the input type, so a rename — `upsertClient({ id, name })`
   * — used to set it to null and silently drop the value the portfolio column
   * and its `?owner=` filter both read. Preserving it means an owner cannot be
   * *cleared* through this method; clearing needs its own call rather than
   * falling out of an omitted field.
   */
  async upsertClient(client: Omit<StoredClient, 'createdAt'>): Promise<void> {
    await this.sql`
      insert into clients (id, name, owner)
      values (${client.id}, ${client.name}, ${client.owner ?? null})
      on conflict (id) do update set
        name = excluded.name,
        owner = coalesce(excluded.owner, clients.owner)
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

  private mapJourney(row: JourneyRow): StoredJourney {
    return {
      id: row.id,
      clientId: row.client_id,
      name: row.name,
      ...optional('targetUrl', row.target_url),
      ...optional('environment', row.environment),
      ...optional('schedule', row.schedule),
      ...optional('scheduleHour', row.schedule_hour),
      ...optional('lastScheduledAt', row.last_scheduled_at ? toIso(row.last_scheduled_at) : null),
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
      ? await this.sql<JourneyRow>`
          select * from journeys
          where client_id = ${clientId} and archived_at is null
          order by name asc
        `
      : await this.sql<JourneyRow>`
          select * from journeys where archived_at is null order by name asc
        `;

    return rows.map((row) => this.mapJourney(row));
  }

  async releaseJourneyClaim(journeyId: string): Promise<void> {
    await this.sql`
      update journeys set last_scheduled_at = null where id = ${journeyId}
    `;
  }

  async getJourney(id: string): Promise<StoredJourney | null> {
    const rows = await this.sql<JourneyRow>`select * from journeys where id = ${id}`;
    return rows.length === 0 ? null : this.mapJourney(rows[0]);
  }

  async upsertJourney(
    journey: Omit<StoredJourney, 'createdAt' | 'updatedAt' | 'archivedAt'>,
  ): Promise<void> {
    await this.sql`
      insert into journeys (
        id, client_id, name, target_url, environment, schedule, schedule_hour,
        steps, updated_at
      )
      values (
        ${journey.id}, ${journey.clientId}, ${journey.name},
        ${journey.targetUrl ?? null}, ${journey.environment ?? 'production'},
        ${journey.schedule ?? 'off'}, ${journey.scheduleHour ?? null},
        ${JSON.stringify(journey.steps ?? [])}::jsonb, now()
      )
      on conflict (id) do update set
        client_id = excluded.client_id,
        name = excluded.name,
        target_url = excluded.target_url,
        environment = excluded.environment,
        schedule = excluded.schedule,
        schedule_hour = excluded.schedule_hour,
        steps = excluded.steps,
        updated_at = now()
    `;
  }

  /**
   * One statement: select the due rows and stamp them in the same breath.
   *
   * A select followed by an update would let two overlapping ticks both claim
   * the same journey and start it twice. A transaction would not settle it
   * either: under Postgres's default read-committed isolation both ticks can
   * read the row as due before either writes.
   *
   * `for update skip locked` is what actually makes that true, and it is not
   * decoration. Without it, two concurrent updates can both evaluate the
   * selection before either commits; the second then blocks on the row lock and
   * re-checks the outer qual against the new row version — behaviour subtle
   * enough that no scheduler should depend on it implicitly. `skip locked`
   * makes the second tick pass over a claimed row instead of queueing behind
   * it, which is also what keeps a slow claim from serialising the whole tick.
   *
   * Overlap is unlikely on an hourly cron but entirely reachable: the route
   * accepts a manual tick with the run token, so an operator proving a new
   * schedule as the hour rolls over is the collision. A double claim means one
   * journey audited twice and a client billed for it.
   *
   * ## Why a CTE and not `where id in (select … limit n for update skip locked)`
   *
   * Because that form silently breaks the limit, and real Postgres is the only
   * thing that says so. The planner turns the sublink into a semi-join whose
   * inner side — `Limit` over `LockRows` — is re-executed **per outer row**.
   * Each re-execution skips the rows this same statement has already locked, so
   * a different row qualifies each time: `limit 2` against three due journeys
   * updates all three. A CTE carrying a locking clause cannot be inlined, so it
   * is evaluated exactly once and the limit means what it says.
   *
   * The limit is not cosmetic. It is `CRON_MAX_STARTS_PER_TICK`, and every
   * claimed journey becomes its own function invocation with its own Chromium —
   * so an over-claim is a tick launching more browsers than the bound that
   * exists to stop exactly that.
   *
   * The slack in the intervals — 23 hours for daily, 6 days for weekly — is
   * what stops hour-boundary jitter from skipping a day entirely. Without it,
   * a tick that runs a few seconds late means `last_scheduled_at` is not quite
   * 24 hours old and the journey waits another full day.
   */
  async claimDueJourneys(limit: number, now: Date = new Date()): Promise<StoredJourney[]> {
    const hour = now.getUTCHours();
    const rows = await this.sql<JourneyRow>`
      with due as (
        select id from journeys
        where schedule is not null
          and schedule <> 'off'
          and archived_at is null
          and target_url is not null
          and coalesce(schedule_hour, 3) = ${hour}
          and (
            last_scheduled_at is null
            or last_scheduled_at < now() - (
              case schedule when 'weekly' then interval '6 days'
                            else interval '23 hours' end
            )
          )
        order by last_scheduled_at asc nulls first
        limit ${Math.max(1, Math.floor(limit))}
        for update skip locked
      )
      update journeys set last_scheduled_at = now()
      from due
      where journeys.id = due.id
      returning journeys.*
    `;
    return rows.map((row) => this.mapJourney(row));
  }

  async archiveJourney(id: string): Promise<void> {
    await this.sql`update journeys set archived_at = now() where id = ${id}`;
  }

  // -------------------------------------------------------------- triage --

  private mapTriage(row: TriageRow): TriageEntry {
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
      ...optional('assigneeOperatorId', row.assignee_operator_id),
      actor: row.actor,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    } as TriageEntry;
  }

  async listTriage(clientId: string): Promise<TriageEntry[]> {
    const rows = await this.sql<TriageRow>`
      select * from finding_triage where client_id = ${clientId}
      order by updated_at desc
    `;
    return rows.map((row) => this.mapTriage(row));
  }

  async setTriage(entry: TriageEntry): Promise<void> {
    await this.sql`
      insert into finding_triage (
        client_id, finding_key, source, code, page_url, selector,
        state, note, assignee, assignee_operator_id, actor, updated_at
      ) values (
        ${entry.clientId}, ${entry.findingKey}, ${entry.source}, ${entry.code},
        ${entry.pageUrl ?? null}, ${entry.selector ?? null}, ${entry.state},
        ${entry.note ?? null}, ${entry.assignee ?? null},
        ${entry.assigneeOperatorId ?? null}, ${entry.actor}, now()
      )
      on conflict (client_id, finding_key) do update set
        state = excluded.state,
        note = excluded.note,
        assignee = excluded.assignee,
        assignee_operator_id = excluded.assignee_operator_id,
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

  private mapReport(row: ReportRow): StoredReport {
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
    const rows = await this.sql<ReportRow>`select * from reports where id = ${id}`;
    return rows.length === 0 ? null : this.mapReport(rows[0]);
  }

  async getReportByToken(token: string): Promise<StoredReport | null> {
    // A revoked report is not findable by its old token. Revocation nulls the
    // token, so this cannot match one — but the explicit guard keeps that true
    // even if revocation ever starts keeping the token for audit purposes.
    const rows = await this.sql<ReportRow>`
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
    const rows = await this.sql<ReportRow>`
      select * from reports where request_id = any(${requestIds})
      order by created_at desc
    `;
    return rows.map((row) => this.mapReport(row));
  }

  // ------------------------------------------------------------ activity --

  async recordEvent(event: ActivityEvent): Promise<void> {
    await this.sql`
      insert into activity_events
        (client_id, actor, actor_operator_id, action, subject, metadata)
      values (
        ${event.clientId ?? null}, ${event.actor}, ${event.actorOperatorId ?? null},
        ${event.action}, ${event.subject ?? null},
        ${JSON.stringify(event.metadata ?? {})}::jsonb
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
      actor_operator_id: string | null;
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
      ...optional('actorOperatorId', row.actor_operator_id),
      action: row.action,
      ...optional('subject', row.subject),
      metadata: row.metadata ?? {},
      createdAt: toIso(row.created_at),
    })) as ActivityEvent[];
  }
}
