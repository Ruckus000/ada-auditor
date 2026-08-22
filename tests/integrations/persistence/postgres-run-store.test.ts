import { neon } from '@neondatabase/serverless';
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';
import {
  PostgresRunStore,
  type SqlClient,
} from '../../../src/integrations/persistence/postgres-run-store';
import {
  abandonedCutoff,
  clearRunContractRows,
  sweepRunContractRows,
} from '../../support/contract-cleanup';
import { CONTRACT_PREFIX, runStoreContract } from '../../support/run-store-contract';

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
 * Cleanup lives in `tests/support/contract-cleanup.ts` so the isolation suite
 * drives the same code this one does. See there for why there are two deletes
 * and why the sweep takes a cutoff rather than an interval.
 */
const clearOwnRows = () => clearRunContractRows(sql, CONTRACT_PREFIX);
const sweepAbandonedRows = () => sweepRunContractRows(sql, abandonedCutoff());

describe('PostgresRunStore', () => {
  beforeAll(sweepAbandonedRows);
  beforeEach(clearOwnRows);
  afterAll(clearOwnRows);

  runStoreContract(() => new PostgresRunStore(sql));
});
