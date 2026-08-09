import { neon } from '@neondatabase/serverless';
import { afterAll, beforeEach, describe } from 'vitest';
import { PostgresPlatformStore } from '../../../src/integrations/persistence/postgres-platform-store';
import type { SqlClient } from '../../../src/integrations/persistence/postgres-run-store';
import {
  CONTRACT_RUN_IDS,
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

/**
 * Deletes exactly what the contract created. Ordered by dependency, because
 * `finding_triage`, `client_config` and `journeys` all cascade from `clients`
 * — dropping the parent first would work, but naming each table keeps the
 * cleanup honest about what the contract touches.
 */
async function clearContractRows(): Promise<void> {
  await sql`delete from finding_triage where client_id like 'contract-%'`;
  await sql`delete from activity_events where client_id like 'contract-%'`;
  await sql`delete from reports where id like 'contract-%'`;
  await sql`delete from runs where request_id like 'contract-%'`;
  await sql`delete from journeys where id like 'contract-%'`;
  await sql`delete from client_config where client_id like 'contract-%'`;
  await sql`delete from clients where id like 'contract-%'`;
}

/**
 * `reports.request_id` is a foreign key, so a report needs a run to point at.
 * Inserted directly rather than through `PostgresRunStore` to keep this suite
 * about the catalog store — but it has to be real, and the FK is the reason
 * the shared contract needs this hook at all.
 */
async function seedRuns(): Promise<void> {
  await sql`
    insert into journeys (id, client_id, name)
    values ('contract-journey-seed', 'client-unassigned', 'contract-journey-seed')
    on conflict (id) do nothing
  `;

  for (const requestId of CONTRACT_RUN_IDS) {
    await sql`
      insert into runs (
        request_id, journey_id, environment, platform,
        evidence_status, ci_status, status
      ) values (
        ${requestId}, 'contract-journey-seed', 'staging', 'generic',
        'complete', 'pass', 'complete'
      )
      on conflict (request_id) do nothing
    `;
  }
}

describe('PostgresPlatformStore', () => {
  beforeEach(clearContractRows);
  afterAll(clearContractRows);

  platformStoreContract(() => new PostgresPlatformStore(sql), { seedRuns });
});
