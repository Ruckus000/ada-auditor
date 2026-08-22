import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { afterEach, describe, expect, it } from 'vitest';
import type { SqlClient } from '../../../src/integrations/persistence/postgres-run-store';
import {
  abandonedCutoff,
  clearPlatformContractRows,
  clearRunContractRows,
  sweepPlatformContractRows,
  sweepRunContractRows,
} from '../../support/contract-cleanup';

/**
 * The property that lets the `database` job run in parallel again.
 *
 * Every CI run points at one `DATABASE_URL`, and both store contracts used to
 * clear `contract-%` and `pc-%` — every run's rows — in a `beforeEach`. Two
 * runs overlapping meant one deleting the other's fixtures between a write and
 * the read that checked it. Runs #158, #159 and #160 started within nine
 * seconds of each other and all three failed, on foreign-key violations
 * against rows that should have existed; #159 was a push whose commit was a
 * documentation change, which no diff could have turned into
 * `Key (client_id)=(pc-client-a) is not present in table "clients"`.
 *
 * `ci.yml` answered that by letting one run near the database at a time. This
 * suite is what replaces that: per-run prefixes, and two claims about them
 * that have to hold or the serialisation has to come back.
 *
 * ## Why this exists rather than trusting the prefix
 *
 * A prefix is obviously safe when you read it and not obviously safe when
 * someone edits the cleanup — the ordering is load-bearing (foreign keys), the
 * age bound is load-bearing (it is the only thing stopping the sweep from
 * being the old bug), and neither is visible from a green contract suite.
 * Both deletes here are the ones the real suites call, imported rather than
 * copied, so a drift between them and this cannot go unnoticed.
 *
 * The rows are written with raw SQL rather than through the stores: this is
 * about what the *cleanup* touches, and going through a store would make the
 * test depend on the thing it is trying to hold still.
 */

const sql = neon(process.env.DATABASE_URL!) as SqlClient;

/** A second run, as far as the database is concerned. */
const OTHER_RUN = `contract-${randomUUID().slice(0, 8)}`;
const OTHER_PLATFORM_RUN = `pc-${randomUUID().slice(0, 8)}`;

/** This test's own, distinct from the neighbour it must not disturb. */
const THIS_RUN = `contract-${randomUUID().slice(0, 8)}`;
const THIS_PLATFORM_RUN = `pc-${randomUUID().slice(0, 8)}`;

async function seedRunStoreRows(prefix: string): Promise<void> {
  await sql`
    insert into journeys (id, client_id, name)
    values (${`${prefix}-journey`}, 'client-unassigned', ${`${prefix}-journey`})
    on conflict (id) do nothing
  `;
  await sql`
    insert into runs (
      request_id, journey_id, environment, platform,
      evidence_status, ci_status, status
    ) values (
      ${`${prefix}-run`}, ${`${prefix}-journey`}, 'staging', 'generic',
      'complete', 'pass', 'complete'
    )
    on conflict (request_id) do nothing
  `;
}

async function seedPlatformRows(prefix: string): Promise<void> {
  await sql`
    insert into clients (id, name)
    values (${`${prefix}-client`}, 'Isolation Client')
    on conflict (id) do nothing
  `;
  await sql`
    insert into operators (id, email, name, password_hash)
    values (
      ${`${prefix}-op`},
      ${`${prefix}-op@example.com`},
      'Isolation Operator',
      'scrypt$16384$8$1$c2FsdA==$aGFzaA=='
    )
    on conflict (id) do nothing
  `;
}

async function runRowsFor(prefix: string): Promise<number> {
  const rows = await sql<{ n: string }>`
    select count(*)::text as n from runs where request_id like ${`${prefix}-%`}
  `;
  return Number(rows[0]!.n);
}

async function clientRowsFor(prefix: string): Promise<number> {
  const rows = await sql<{ n: string }>`
    select count(*)::text as n from clients where id like ${`${prefix}-%`}
  `;
  return Number(rows[0]!.n);
}

describe('contract cleanup is confined to one run', () => {
  afterEach(async () => {
    for (const prefix of [THIS_RUN, OTHER_RUN]) {
      await clearRunContractRows(sql, prefix);
    }
    for (const prefix of [THIS_PLATFORM_RUN, OTHER_PLATFORM_RUN]) {
      await clearPlatformContractRows(sql, prefix);
    }
  });

  it('leaves another run’s rows alone when clearing its own', async () => {
    await seedRunStoreRows(THIS_RUN);
    await seedRunStoreRows(OTHER_RUN);
    await seedPlatformRows(THIS_PLATFORM_RUN);
    await seedPlatformRows(OTHER_PLATFORM_RUN);

    await clearRunContractRows(sql, THIS_RUN);
    await clearPlatformContractRows(sql, THIS_PLATFORM_RUN);

    expect(await runRowsFor(THIS_RUN), 'own run rows cleared').toBe(0);
    expect(await clientRowsFor(THIS_PLATFORM_RUN), 'own client rows cleared').toBe(0);

    // The assertion the serialisation used to stand in for. Before the
    // prefixes this was 0, and that was the bug.
    expect(await runRowsFor(OTHER_RUN), 'a concurrent run’s runs survived').toBe(1);
    expect(await clientRowsFor(OTHER_PLATFORM_RUN), 'a concurrent run’s clients survived').toBe(
      1,
    );
  });

  it('sweeps abandoned rows without touching a run that is still going', async () => {
    // The sweep is the one place the old blast radius could come back: it
    // matches the shared `contract-%`/`pc-%` prefix on purpose, because litter
    // from a crashed run carries a prefix nobody remembers. The age bound is
    // the whole safety argument, so this drives it at both ends.
    await seedRunStoreRows(OTHER_RUN);
    await seedPlatformRows(OTHER_PLATFORM_RUN);

    // Rows written a moment ago are a live run's. The real cutoff is two hours.
    await sweepRunContractRows(sql, abandonedCutoff());
    await sweepPlatformContractRows(sql, abandonedCutoff());

    expect(await runRowsFor(OTHER_RUN), 'a live run’s runs survived the sweep').toBe(1);
    expect(
      await clientRowsFor(OTHER_PLATFORM_RUN),
      'a live run’s clients survived the sweep',
    ).toBe(1);

    // And it does reach them once they are old enough — a sweep that never
    // deletes is not a sweep, and this is what stops the suite passing because
    // the cutoff silently stopped matching anything.
    //
    // Scoped to these rows, not to `contract-%`. A future cutoff against the
    // shared pattern would delete every concurrent run's fixtures, which is
    // precisely the failure this file exists to prevent — a test that proves
    // isolation by breaking it would be worse than no test. The pattern is a
    // parameter so this half can be narrowed while the half above, which
    // deletes nothing, still runs against the real one.
    const future = new Date(Date.now() + 60_000).toISOString();
    await sweepRunContractRows(sql, future, `${OTHER_RUN}-%`);
    await sweepPlatformContractRows(sql, future, `${OTHER_PLATFORM_RUN}-%`);

    expect(await runRowsFor(OTHER_RUN), 'abandoned runs are swept').toBe(0);
    expect(await clientRowsFor(OTHER_PLATFORM_RUN), 'abandoned clients are swept').toBe(0);
  });
});
