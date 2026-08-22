import { neon } from '@neondatabase/serverless';
import { afterAll, beforeAll, beforeEach, describe } from 'vitest';
import { PostgresPlatformStore } from '../../../src/integrations/persistence/postgres-platform-store';
import type { SqlClient } from '../../../src/integrations/persistence/postgres-run-store';
import {
  abandonedCutoff,
  clearPlatformContractRows,
  sweepPlatformContractRows,
} from '../../support/contract-cleanup';
import {
  CONTRACT_RUN_IDS,
  PLATFORM_PREFIX,
  platformStoreContract,
} from '../../support/platform-store-contract';

/**
 * The catalog store against a real Neon database, held to the same contract as
 * the in-memory double.
 *
 * Outside the fast suite (`npm run test:db`) for the same reason the run-store
 * suite is: it needs credentials and a network round trip, and a fast suite
 * that sometimes needs the internet stops being run.
 */

const sql = neon(process.env.DATABASE_URL!) as SqlClient;

/** The journey the seeded runs hang from, inside this run's namespace. */
const SEED_JOURNEY = `${PLATFORM_PREFIX}-journey-seed`;

/**
 * Cleanup lives in `tests/support/contract-cleanup.ts` so the isolation suite
 * drives the same code this one does — including the ordering, which the
 * foreign keys make load-bearing.
 */
const clearOwnRows = () => clearPlatformContractRows(sql, PLATFORM_PREFIX);
const sweepAbandonedRows = () => sweepPlatformContractRows(sql, abandonedCutoff());

/**
 * `reports.request_id` is a foreign key, so a report needs a run to point at.
 * Inserted directly rather than through `PostgresRunStore` to keep this suite
 * about the catalog store — but it has to be real, and the FK is the reason
 * the shared contract needs this hook at all.
 *
 * The journey is namespaced like everything else; `client-unassigned` is not,
 * because it is a real row the product defines and the upsert is idempotent.
 */
async function seedRuns(): Promise<void> {
  await sql`
    insert into journeys (id, client_id, name)
    values (${SEED_JOURNEY}, 'client-unassigned', ${SEED_JOURNEY})
    on conflict (id) do nothing
  `;

  for (const requestId of CONTRACT_RUN_IDS) {
    await sql`
      insert into runs (
        request_id, journey_id, environment, platform,
        evidence_status, ci_status, status
      ) values (
        ${requestId}, ${SEED_JOURNEY}, 'staging', 'generic',
        'complete', 'pass', 'complete'
      )
      on conflict (request_id) do nothing
    `;
  }
}

describe('PostgresPlatformStore', () => {
  beforeAll(sweepAbandonedRows);
  beforeEach(clearOwnRows);
  afterAll(clearOwnRows);

  platformStoreContract(() => new PostgresPlatformStore(sql), { seedRuns });
});
