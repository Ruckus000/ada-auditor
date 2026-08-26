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
      // Same reason as the Postgres contract above: everything under
      // `toolchain/` drives a real external binary — a JVM today, LibreOffice
      // as well now. The fast suite launches no browser and opens no socket,
      // and a machine without a JDK or LibreOffice must not be permanently red.
      // Everything testable without them — schema parsing, output handling,
      // failure mapping — stays in the fast suite with an injected executor.
      // A directory rule rather than a filename glob, so the next tool does not
      // need a third pattern. Run these with `npm run test:documents`.
      'tests/integrations/documents/toolchain/**',
    ],
    environment: 'node',
  },
});
