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
    ],
    environment: 'node',
  },
});
