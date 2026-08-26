import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // The fast suite launches no browser and opens no socket. Both exclusions
    // are load-bearing: a suite that sometimes needs Chromium or a database
    // stops being run, and the boundary is what keeps pure logic testable
    // without either.
    exclude: [
      'tests/integrations/browser/**',
      'tests/integrations/persistence/postgres-*.test.ts',
      // Same reason as the Postgres contract above: these start a real JVM.
      // The fast suite launches no browser and opens no socket, and a machine
      // without a JDK must not be permanently red. Everything about the
      // document boundary that can be tested without Java — schema parsing,
      // output handling, failure mapping — lives in the fast suite with an
      // injected executor. Run these with `npm run test:documents`.
      'tests/integrations/documents/java-*.test.ts',
    ],
    environment: 'node',
  },
});
