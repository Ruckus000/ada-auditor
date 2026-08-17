import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { loadEnvLocal } from './scripts/load-env';

/**
 * Database-backed tests.
 *
 * Separate from the unit suite for the same reason the browser suite is: these
 * need credentials and a network round trip, and a fast suite that sometimes
 * needs the internet stops being run. `vitest` does not read `.env.local`, so
 * the config loads it — otherwise `DATABASE_URL` is undefined and every test
 * fails somewhere far from the cause.
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
loadEnvLocal();

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/integrations/persistence/postgres-*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
