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
  },
});
