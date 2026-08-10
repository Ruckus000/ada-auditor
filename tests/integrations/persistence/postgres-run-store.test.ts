import { neon } from '@neondatabase/serverless';
import { afterAll, beforeEach, describe } from 'vitest';
import {
  PostgresRunStore,
  type SqlClient,
} from '../../../src/integrations/persistence/postgres-run-store';
import { runStoreContract } from '../../support/run-store-contract';

/**
 * The real store, against a real Neon database.
 *
 * Held to the same contract as the in-memory double, because that double is
 * what every handler test runs against — if the two disagree, the fast suite
 * is green about behaviour production does not have.
 *
 * This lives outside the unit suite (`npm run test:db`, its own config) for
 * the same reason browser tests do: it needs credentials and a network round
 * trip, and a fast suite that sometimes needs the internet stops being run.
 */

const sql = neon(process.env.DATABASE_URL!) as SqlClient;

/**
 * Every record the contract writes is prefixed `contract-`. Deleting exactly
 * those keeps the suite from touching a real run that happens to share the
 * database — `truncate` would be quicker and would also delete evidence
 * someone might still need.
 */
async function clearContractRows(): Promise<void> {
  await sql`delete from runs where request_id like 'contract-%'`;
}

describe('PostgresRunStore', () => {
  beforeEach(clearContractRows);
  afterAll(clearContractRows);

  runStoreContract(() => new PostgresRunStore(sql));
});
