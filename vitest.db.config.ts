import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { loadEnvLocal } from './scripts/load-env';
import { requireTestDatabaseUrl } from './scripts/require-test-database';

/**
 * Database-backed tests.
 *
 * Separate from the unit suite for the same reason the browser suite is: these
 * need credentials and a network round trip, and a fast suite that sometimes
 * needs the internet stops being run.
 *
 * **It reads `.env.test.local`, not `.env.local`, and that is the whole
 * safety property.** Three cases in the store contract call methods that take
 * no scope — `clearArtifactsBefore`, `reconcileStaleRuns`, `claimDueJourneys`
 * — so they mutate rows the suite never wrote. `clearArtifactsBefore` has
 * already blanked production evidence pointers once. Never loading
 * production's `DATABASE_URL` into this process is a stronger guarantee than
 * loading it and then checking it, and `.env.test.local` is not a file
 * `vercel env pull` rewrites, so the setting survives a routine pull.
 *
 * `DATABASE_URL_TEST` is resolved by `scripts/require-test-database.ts` and
 * handed to the suites as `DATABASE_URL` through `test.env` below, so the
 * three `postgres-*.test.ts` files read one variable and know nothing about
 * any of this.
 *
 * Runs serially: the suite shares one database, and parallel files would
 * delete each other's rows between a write and the read that checks it.
 *
 * **The timeout is set here, and the default was the actual bug.** Vitest's
 * 5000ms is written for tests that touch nothing; every test in this suite is
 * several round trips to a hosted Postgres, and the suite's own average is
 * over three seconds a test. One of them — three `saveRun` calls, each writing
 * a run plus its pages and its findings — sat at 4.7s locally and about 20s in
 * CI, so it failed here, passed there, and got treated as a flaky test for
 * weeks. It was not flaky. It was a network suite being held to a unit suite's
 * clock, and the only thing that made it the *first* to fail was being the
 * heaviest.
 *
 * Twenty seconds: generous enough that ordinary latency cannot fail a correct
 * test, short enough that a query which will never come back does not hold the
 * suite for minutes.
 */
loadEnvLocal(process.cwd(), '.env.test.local');

const database = requireTestDatabaseUrl(process.env);
if (!database.ok) {
  // `console.error` + `exit`, not `throw`: this is a configuration fault, and
  // a stack trace wrapped around it buries the instructions. Matches
  // `scripts/migrate.ts`.
  console.error(database.message);
  process.exit(1);
}

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/integrations/persistence/postgres-*.test.ts'],
    environment: 'node',
    // The suites read `DATABASE_URL`; only this line ever sets it for them.
    env: { DATABASE_URL: database.url },
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
