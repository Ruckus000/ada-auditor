import type { Environment } from '../../domain/contracts';
import type {
  RunStore,
  StoredFinding,
  StoredRunPage,
  StoredRunRecord,
} from '../../domain/persistence';

/**
 * The durable run store.
 *
 * Replaces `FileRunStore` and `KvRunStore` rather than joining them. Their
 * weaknesses die with them: the file store read the whole directory and
 * JSON-parsed every record to answer `getLatestRun`, and the KV store kept a
 * two-deep `latest` → `previous` pointer chain that had to be rewritten on
 * every save and could not answer "list runs" at all. Both are replaced by an
 * index and an `order by`.
 *
 * ## Why raw SQL and not an ORM
 *
 * Three tables, six queries, and a shape (`StoredRunRecord`) that already
 * exists as the contract. An ORM here would add a schema definition to keep in
 * sync with `schema.sql` and a migration tool to run it, for queries that fit
 * on a screen.
 */

/** The subset of `@neondatabase/serverless`'s tagged-template client we use. */
export type SqlClient = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

type RunRow = {
  request_id: string;
  journey_id: string;
  environment: string;
  platform: string;
  evidence_status: string;
  ci_status: string;
  status: string;
  failure_reason: string | null;
  duration_ms: number;
  browser_mode: boolean;
  truncated_pages: number;
  score: number | null;
  score_version: number | null;
  created_at: Date | string;
  started_at: Date | string | null;
  phase_ms: Record<string, number> | null;
};

type PageRow = {
  request_id: string;
  url: string;
  route: string;
  title: string;
  evidence_status: string;
  artifacts: Record<string, string> | null;
  checks_passed: number | null;
  checks_failed: number | null;
  checks_incomplete: number | null;
  duration_ms: number | null;
  scan_ms: number | null;
};

type FindingRow = {
  request_id: string;
  page_url: string | null;
  code: string;
  severity: string;
  source: string;
  title: string | null;
  message: string | null;
  remediation_any: string[] | null;
  remediation_all: string[] | null;
  wcag_criteria: string[] | null;
  conformance_level: string | null;
  selector: string | null;
  html_snippet: string | null;
  help_url: string | null;
  gateable: boolean | null;
  confidence: number | null;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Rebuilds the record the rest of the app knows.
 *
 * Optional fields are omitted rather than set to `undefined`, so a record read
 * back is `toEqual`-identical to the one written — `{a: undefined}` and `{}`
 * are the same object to a person and different to a test.
 */
function toFinding(row: FindingRow): StoredFinding {
  const finding: StoredFinding = {
    code: row.code,
    severity: row.severity,
    source: row.source,
  };

  if (row.title !== null) finding.title = row.title;
  if (row.message !== null) finding.message = row.message;
  if (row.remediation_any !== null) finding.remediationAnyOf = row.remediation_any;
  if (row.remediation_all !== null) finding.remediationAllOf = row.remediation_all;
  if (row.wcag_criteria !== null) finding.wcagCriteria = row.wcag_criteria;
  if (row.conformance_level !== null) finding.conformanceLevel = row.conformance_level;
  if (row.page_url !== null) finding.pageUrl = row.page_url;
  if (row.selector !== null) finding.selector = row.selector;
  if (row.html_snippet !== null) finding.htmlSnippet = row.html_snippet;
  if (row.help_url !== null) finding.helpUrl = row.help_url;
  if (row.gateable !== null) finding.gateable = row.gateable;
  if (row.confidence !== null) finding.confidence = row.confidence;

  return finding;
}

function toPage(row: PageRow): StoredRunPage {
  const page: StoredRunPage = {
    url: row.url,
    route: row.route,
    title: row.title,
    evidenceStatus: row.evidence_status,
  };

  if (row.artifacts && Object.keys(row.artifacts).length > 0) {
    page.artifacts = row.artifacts;
  }
  if (row.checks_passed !== null) page.checksPassed = row.checks_passed;
  if (row.checks_failed !== null) page.checksFailed = row.checks_failed;
  if (row.checks_incomplete !== null) page.checksIncomplete = row.checks_incomplete;
  if (row.duration_ms !== null) page.durationMs = row.duration_ms;
  if (row.scan_ms !== null) page.scanMs = row.scan_ms;

  return page;
}

function toRecord(
  run: RunRow,
  pages: StoredRunPage[],
  findings: StoredFinding[],
): StoredRunRecord {
  const record: StoredRunRecord = {
    requestId: run.request_id,
    journeyId: run.journey_id,
    environment: run.environment as Environment,
    platform: run.platform,
    evidenceStatus: run.evidence_status,
    ciStatus: run.ci_status,
    findings,
    durationMs: run.duration_ms,
    createdAt: toIso(run.created_at),
  };

  if (run.browser_mode) record.browserMode = true;
  if (pages.length > 0) record.pages = pages;
  if (run.truncated_pages > 0) record.truncatedPages = run.truncated_pages;
  if (run.score !== null) {
    record.score = run.score;
    record.scoreVersion = run.score_version ?? 1;
  }
  if (run.status) record.status = run.status as StoredRunRecord['status'];
  if (run.failure_reason !== null) record.failureReason = run.failure_reason;
  if (run.started_at !== null) record.startedAt = toIso(run.started_at);
  if (run.phase_ms !== null) record.phaseMs = run.phase_ms;

  return record;
}

export class PostgresRunStore implements RunStore {
  constructor(private readonly sql: SqlClient) {}

  /**
   * Writes a run and its children.
   *
   * An upsert, not an insert: a run is written as `running` before the audit
   * starts and rewritten when it finishes, so the second write must replace
   * the first rather than collide with it. Children are deleted and reinserted
   * for the same reason — the placeholder has none, the finished record has
   * all of them, and a partial overwrite would leave a run holding pages from
   * an earlier attempt.
   */
  async saveRun(record: StoredRunRecord): Promise<void> {
    const sql = this.sql;

    // A run implies a journey.
    //
    // `runs.journey_id` is a foreign key now, so this row has to exist before
    // the run does. Doing it here rather than only in the API handler keeps
    // `saveRun` total: `journeyId` arrives as free text from a request body,
    // and every other caller — chaos, the store contract, a future script —
    // would otherwise hit a foreign-key violation for a precondition nothing
    // told them about.
    //
    // The name defaults to the id and the client to `client-unassigned`. The
    // catalog screens overwrite both; `on conflict do nothing` is what stops
    // this from clobbering them on the next run.
    await sql`
      insert into journeys (id, client_id, name)
      values (${record.journeyId}, 'client-unassigned', ${record.journeyId})
      on conflict (id) do nothing
    `;

    await sql`
      insert into runs (
        request_id, journey_id, environment, platform, evidence_status,
        ci_status, status, failure_reason, duration_ms, browser_mode,
        truncated_pages, score, score_version, created_at, started_at, phase_ms
      ) values (
        ${record.requestId}, ${record.journeyId}, ${record.environment},
        ${record.platform}, ${record.evidenceStatus}, ${record.ciStatus},
        ${record.status ?? 'complete'}, ${record.failureReason ?? null},
        ${record.durationMs}, ${record.browserMode ?? false},
        ${record.truncatedPages ?? 0}, ${record.score ?? null},
        ${record.scoreVersion ?? 1}, ${record.createdAt},
        ${record.startedAt ?? record.createdAt},
        ${record.phaseMs ? JSON.stringify(record.phaseMs) : null}
      )
      on conflict (request_id) do update set
        journey_id = excluded.journey_id,
        environment = excluded.environment,
        platform = excluded.platform,
        evidence_status = excluded.evidence_status,
        ci_status = excluded.ci_status,
        status = excluded.status,
        failure_reason = excluded.failure_reason,
        duration_ms = excluded.duration_ms,
        browser_mode = excluded.browser_mode,
        truncated_pages = excluded.truncated_pages,
        score = excluded.score,
        score_version = excluded.score_version,
        -- The earliest write wins. toStoredRunRecord mints a fresh createdAt
        -- on every call, so taking excluded here moved the timestamp to
        -- completion time on the write that finishes a run -- making the
        -- column mean "finished" for a complete run and "started" for one
        -- that died, while getLatestRun ordered baselines by it.
        created_at = least(runs.created_at, excluded.created_at),
        started_at = least(coalesce(runs.started_at, excluded.started_at), excluded.started_at),
        phase_ms = coalesce(excluded.phase_ms, runs.phase_ms)
    `;

    await sql`delete from run_pages where request_id = ${record.requestId}`;
    await sql`delete from findings where request_id = ${record.requestId}`;

    const pages = record.pages ?? [];
    for (const [position, page] of pages.entries()) {
      await sql`
        insert into run_pages (
          request_id, position, url, route, title, evidence_status, artifacts,
          checks_passed, checks_failed, checks_incomplete, duration_ms, scan_ms
        ) values (
          ${record.requestId}, ${position}, ${page.url}, ${page.route},
          ${page.title}, ${page.evidenceStatus},
          ${JSON.stringify(page.artifacts ?? {})}::jsonb,
          ${page.checksPassed ?? null}, ${page.checksFailed ?? null},
          ${page.checksIncomplete ?? null},
          ${page.durationMs ?? null}, ${page.scanMs ?? null}
        )
      `;
    }

    for (const [position, finding] of record.findings.entries()) {
      await sql`
        insert into findings (
          request_id, position, page_url, code, severity, source, title,
          message, remediation_any, remediation_all, wcag_criteria,
          conformance_level, selector, html_snippet, help_url, gateable,
          confidence
        ) values (
          ${record.requestId}, ${position}, ${finding.pageUrl ?? null},
          ${finding.code}, ${finding.severity}, ${finding.source},
          ${finding.title ?? null},
          ${finding.message ?? null},
          ${finding.remediationAnyOf ?? null}, ${finding.remediationAllOf ?? null},
          ${finding.wcagCriteria ?? null},
          ${finding.conformanceLevel ?? null}, ${finding.selector ?? null},
          ${finding.htmlSnippet ?? null}, ${finding.helpUrl ?? null},
          ${finding.gateable ?? null}, ${finding.confidence ?? null}
        )
      `;
    }
  }

  async getRun(requestId: string): Promise<StoredRunRecord | null> {
    const runs = await this.sql<RunRow>`
      select * from runs where request_id = ${requestId}
    `;
    if (runs.length === 0) {
      return null;
    }

    return this.hydrateOne(runs[0]);
  }

  async getLatestRun(
    journeyId: string,
    environment: Environment,
    excludeRequestId?: string,
  ): Promise<StoredRunRecord | null> {
    // `created_at desc, request_id desc` rather than `created_at desc` alone:
    // two runs recorded in the same millisecond would otherwise come back in
    // an order the database is free to change between calls, which is exactly
    // the sort of instability a regression diff cannot tolerate.
    const runs = excludeRequestId
      ? await this.sql<RunRow>`
          select * from runs
          where journey_id = ${journeyId}
            and environment = ${environment}
            and request_id <> ${excludeRequestId}
          order by created_at desc, request_id desc
          limit 1
        `
      : await this.sql<RunRow>`
          select * from runs
          where journey_id = ${journeyId} and environment = ${environment}
          order by created_at desc, request_id desc
          limit 1
        `;

    if (runs.length === 0) {
      return null;
    }

    return this.hydrateOne(runs[0]);
  }

  /**
   * Run history, newest first.
   *
   * Called out in the Phase 1 plan and never delivered — the interface was
   * `saveRun` / `getRun` / `getLatestRun`, so there was no way to enumerate
   * history at all. It lands with the store that can actually answer it from
   * an index instead of by reading every record.
   */
  async list(options: {
    journeyId?: string;
    environment?: Environment;
    limit?: number;
  } = {}): Promise<StoredRunRecord[]> {
    // A caller that forgets to page must not be able to pull the whole table
    // into one function invocation.
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const journeyId = options.journeyId ?? null;
    const environment = options.environment ?? null;

    const runs = await this.sql<RunRow>`
      select * from runs
      where (${journeyId}::text is null or journey_id = ${journeyId})
        and (${environment}::text is null or environment = ${environment})
      order by created_at desc, request_id desc
      limit ${limit}
    `;

    return this.hydrate(runs);
  }

  private async hydrateOne(run: RunRow): Promise<StoredRunRecord> {
    return (await this.hydrate([run]))[0];
  }

  /**
   * Loads every run's pages and findings in two queries rather than two per
   * run — the N+1 that made `getLatestRun` expensive in the store this one
   * replaces.
   */
  private async hydrate(runs: RunRow[]): Promise<StoredRunRecord[]> {
    if (runs.length === 0) {
      return [];
    }

    const ids = runs.map((run) => run.request_id);

    const pageRows = await this.sql<PageRow>`
      select * from run_pages where request_id = any(${ids}) order by position asc
    `;
    const findingRows = await this.sql<FindingRow>`
      select * from findings where request_id = any(${ids}) order by position asc
    `;

    const pagesByRun = new Map<string, StoredRunPage[]>();
    for (const row of pageRows) {
      const bucket = pagesByRun.get(row.request_id);
      if (bucket) bucket.push(toPage(row));
      else pagesByRun.set(row.request_id, [toPage(row)]);
    }

    const findingsByRun = new Map<string, StoredFinding[]>();
    for (const row of findingRows) {
      const bucket = findingsByRun.get(row.request_id);
      if (bucket) bucket.push(toFinding(row));
      else findingsByRun.set(row.request_id, [toFinding(row)]);
    }

    return runs.map((run) =>
      toRecord(
        run,
        pagesByRun.get(run.request_id) ?? [],
        findingsByRun.get(run.request_id) ?? [],
      ),
    );
  }
}
