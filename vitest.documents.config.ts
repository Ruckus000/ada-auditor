import path from 'node:path';
import { defineConfig } from 'vitest/config';

import {
  DOCUMENT_CLASSES_DIR,
  resolveJavaRuntime,
} from './src/integrations/documents/java-runtime';
import { staleDocumentStage } from './tests/support/compiled-stages';

/**
 * Says *why* when this suite is about to skip everything — and refuses to run
 * at all when what is compiled is older than the sources.
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
} else {
  /**
   * A stale `dist/` stops the run instead of skipping it.
   *
   * The three preconditions above skip, and should: no JDK, no jar and no
   * build are a contributor's environment, and a machine nowhere near this
   * code must not go red over a subsystem it cannot run. Classes older than
   * their sources are not that. The toolchain is plainly here — this is an
   * artifact that has to be rebuilt, and until it is, nothing this suite says
   * is about the code in the tree.
   *
   * It has already lied once: two `StackOverflowError` failures chased as a
   * live cycle bug, on a guard that had landed the day before. The same gap
   * passes a suite against a stage that was never compiled, which is the
   * failure `localci.yml`'s own comment names — a suite that skips silently is
   * indistinguishable from one that passed.
   */
  const stale = staleDocumentStage();
  if (stale) {
    throw new Error(
      `${stale} is newer than the compiled stages in ${DOCUMENT_CLASSES_DIR}. ` +
        'Run `npm run build:documents`.',
    );
  }
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
