import path from 'node:path';
import { defineConfig } from 'vitest/config';

import { resolveJavaRuntime } from './src/integrations/documents/java-runtime';

/**
 * Says *why* when this suite is about to skip everything.
 *
 * The check itself has to live in the test file — that is what decides — but a
 * `console.warn` there is swallowed: vitest captures output from a file whose
 * tests all skip, so the run reported "4 skipped" and no reason at all. A skip
 * nobody can explain reads exactly like a pass, which is the failure mode this
 * repository has been bitten by before.
 *
 * A config file is loaded by the runner itself, outside that capture, so the
 * reason actually reaches the terminal.
 */
const runtime = resolveJavaRuntime();
if (!runtime.available) {
  console.warn(`\n  document stages will be SKIPPED — ${runtime.reason}\n`);
}

/**
 * The document stages against a real JVM.
 *
 * Split out for the same reason `vitest.db.config.ts` is: these need something
 * the fast suite must never require. A JDK, a fetched PDFBox jar and a
 * `npm run build:documents` are all preconditions, and folding them into
 * `npm test` would make a clean checkout fail for a contributor who is nowhere
 * near this code.
 *
 * The tests here skip themselves — with a message naming the missing piece —
 * rather than failing when no toolchain is present.
 *
 * `fileParallelism: false` because each test spawns a JVM and they would
 * otherwise contend; the timeout is generous because JVM start plus a document
 * walk is seconds, not milliseconds.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/integrations/documents/toolchain/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
