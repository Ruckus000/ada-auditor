import { neon } from '@neondatabase/serverless';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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

/**
 * A fixed, obviously-fake key for the credential cases. Not a secret — it is
 * committed — and set HERE rather than in any suite config on purpose: the
 * shared contract must pass against the memory double with no key at all, so
 * the key is a property of this harness, exactly like `DATABASE_URL` is.
 */
const TEST_CREDENTIAL_KEY = 'ab'.repeat(32);
const originalKey = process.env.AUDITOR_CREDENTIAL_KEY;

describe('PostgresPlatformStore', () => {
  beforeAll(() => {
    process.env.AUDITOR_CREDENTIAL_KEY = TEST_CREDENTIAL_KEY;
    return sweepAbandonedRows();
  });
  beforeEach(clearOwnRows);
  afterAll(async () => {
    if (originalKey === undefined) delete process.env.AUDITOR_CREDENTIAL_KEY;
    else process.env.AUDITOR_CREDENTIAL_KEY = originalKey;
    await clearOwnRows();
  });

  platformStoreContract(() => new PostgresPlatformStore(sql), { seedRuns });

  /**
   * Outside the shared contract because only this store makes the claim: what
   * lands in the column is ciphertext. The contract sees plaintext-in/
   * plaintext-out by design (the cipher lives inside this store), so without
   * this case an implementation that wrote plaintext into `user_ciphertext`
   * would pass everything.
   */
  it('holds only ciphertext at rest', async () => {
    const store = new PostgresPlatformStore(sql);
    await store.upsertClient({ id: `${PLATFORM_PREFIX}-client-a`, name: 'Contract Client' });
    await store.setClientCredential(`${PLATFORM_PREFIX}-client-a`, 'portal', {
      user: 'at-rest-user-sentinel@example.com',
      pass: 'at-rest-pass-sentinel-hunter2',
    });

    const rows = await sql<{ user_ciphertext: string; pass_ciphertext: string }>`
      select user_ciphertext, pass_ciphertext from client_credentials
      where client_id = ${`${PLATFORM_PREFIX}-client-a`} and ref = 'portal'
    `;

    expect(rows).toHaveLength(1);
    const raw = JSON.stringify(rows[0]);
    expect(raw).not.toContain('at-rest-user-sentinel');
    expect(raw).not.toContain('at-rest-pass-sentinel');
    expect(rows[0]!.user_ciphertext).toMatch(/^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(rows[0]!.pass_ciphertext).toMatch(/^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
  });
});
