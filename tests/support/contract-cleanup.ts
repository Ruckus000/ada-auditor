import type { SqlClient } from '../../src/integrations/persistence/postgres-run-store';

/**
 * What the Postgres contract suites delete, and when.
 *
 * Extracted from the two suites so the isolation test can drive the same code
 * they do. A copy of this SQL living next to the test that proves it safe
 * would prove only that the copy is safe.
 *
 * ## Two deletes, two different jobs
 *
 * `clear*ContractRows` removes one process's own fixtures, by prefix. It runs
 * between tests, because tests within a run reuse ids.
 *
 * `sweep*ContractRows` removes what a *crashed* run left behind, by age. It is
 * the thing per-run prefixes cost: the old blanket `delete ... like 'pc-%'`
 * tidied up after abandoned runs as a side effect of clearing everything, and
 * nothing else does that now.
 *
 * The age bound is what keeps the sweep from being the old bug with extra
 * steps. It takes an absolute cutoff rather than an interval so a test can
 * hand it one — proving the young rows of a concurrent run survive is the
 * whole safety argument, and it is not something an `interval '2 hours'`
 * baked into the SQL would let anyone check.
 */

/** Runs older than this cannot belong to a live process: CI takes minutes. */
export const ABANDONED_AFTER_MS = 2 * 60 * 60 * 1000;

export function abandonedCutoff(now = Date.now()): string {
  return new Date(now - ABANDONED_AFTER_MS).toISOString();
}

/**
 * Deletes exactly one run's run-store rows.
 *
 * `runs` before `journeys`: `saveRun` materialises a journey for every run, and
 * the run references it. Left behind, those journeys show up on the Portfolio
 * under "Unassigned" — test litter appearing in the product.
 */
export async function clearRunContractRows(sql: SqlClient, prefix: string): Promise<void> {
  const own = `${prefix}-%`;
  await sql`delete from runs where request_id like ${own}`;
  await sql`delete from journeys where id like ${own}`;
}

/**
 * `pattern` is a parameter, and that is a safety property rather than a
 * convenience.
 *
 * The sweep matches the *shared* prefix on purpose — litter from a crashed run
 * carries a nonce nobody kept — so it is the one delete here whose reach is
 * not confined by construction. Only the cutoff confines it, which makes
 * "young rows survive" the assertion that matters, and that assertion is safe
 * to make against the real pattern because it deletes nothing.
 *
 * The opposite assertion is not. Proving the sweep *does* delete needs a
 * cutoff in the future, and a future cutoff against `contract-%` would take
 * every concurrent run's rows with it — the exact failure this whole change
 * exists to end. So that half narrows the pattern to the caller's own rows.
 */
export async function sweepRunContractRows(
  sql: SqlClient,
  cutoffIso: string,
  pattern = 'contract-%',
): Promise<void> {
  await sql`delete from runs where request_id like ${pattern} and created_at < ${cutoffIso}`;
  await sql`delete from journeys where id like ${pattern} and created_at < ${cutoffIso}`;
}

/**
 * Deletes exactly one run's catalog rows, ordered by dependency.
 *
 * `finding_triage`, `client_config` and `journeys` all cascade from `clients`,
 * so dropping the parent first would work — naming each table keeps the
 * cleanup honest about what the contract touches. `operators` goes last:
 * `activity_events.actor_operator_id` and `finding_triage.assignee_operator_id`
 * both reference it, so the rows pointing at it have to go first — as does
 * `operator_passkeys`, which cascades from it but is named anyway, for the
 * same reason the cascading client tables are.
 */
export async function clearPlatformContractRows(sql: SqlClient, prefix: string): Promise<void> {
  const own = `${prefix}-%`;
  await sql`delete from finding_triage where client_id like ${own}`;
  await sql`delete from client_credentials where client_id like ${own}`;
  await sql`delete from activity_events where client_id like ${own}`;
  await sql`delete from document_inspections where client_id like ${own}`;
  // Answers and conversions before the documents they reference; all before
  // `clients`, and answers before `operators` too.
  await sql`delete from document_answers where client_id like ${own}`;
  await sql`delete from document_conversions where client_id like ${own}`;
  await sql`delete from client_documents where client_id like ${own}`;
  await sql`delete from reports where id like ${own}`;
  await sql`delete from runs where request_id like ${own}`;
  await sql`delete from journeys where id like ${own}`;
  await sql`delete from client_config where client_id like ${own}`;
  await sql`delete from clients where id like ${own}`;
  await sql`delete from operator_passkeys where operator_id like ${own}`;
  await sql`delete from operators where id like ${own}`;
}

/**
 * `client_config` carries no `created_at`, so it is bounded by the age of the
 * client it hangs from rather than its own — the same answer, since the
 * contract never writes one without the other.
 */
export async function sweepPlatformContractRows(
  sql: SqlClient,
  cutoffIso: string,
  pattern = 'pc-%',
): Promise<void> {
  await sql`delete from finding_triage where client_id like ${pattern} and created_at < ${cutoffIso}`;
  await sql`delete from client_credentials where client_id like ${pattern} and created_at < ${cutoffIso}`;
  await sql`delete from activity_events where client_id like ${pattern} and created_at < ${cutoffIso}`;
  // Bounded by its own timestamp: `inspected_at` is the row's only one.
  await sql`delete from document_inspections where client_id like ${pattern} and inspected_at < ${cutoffIso}`;
  await sql`delete from document_answers where client_id like ${pattern} and declared_at < ${cutoffIso}`;
  await sql`delete from document_conversions where client_id like ${pattern} and converted_at < ${cutoffIso}`;
  // Bounded by when the document was last seen, which a live run keeps fresh.
  await sql`delete from client_documents where client_id like ${pattern} and last_seen_at < ${cutoffIso}`;
  await sql`delete from reports where id like ${pattern} and created_at < ${cutoffIso}`;
  await sql`delete from runs where request_id like ${pattern} and created_at < ${cutoffIso}`;
  await sql`delete from journeys where id like ${pattern} and created_at < ${cutoffIso}`;
  await sql`
    delete from client_config
    where client_id in (
      select id from clients where id like ${pattern} and created_at < ${cutoffIso}
    )
  `;
  await sql`delete from clients where id like ${pattern} and created_at < ${cutoffIso}`;
  await sql`delete from operator_passkeys where operator_id like ${pattern} and created_at < ${cutoffIso}`;
  await sql`delete from operators where id like ${pattern} and created_at < ${cutoffIso}`;
}
