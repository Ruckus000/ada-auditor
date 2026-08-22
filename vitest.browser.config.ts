import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['tests/integrations/browser/**/*.test.ts'],
    // The hydration suite needs a build and its own server, so it runs from
    // `npm run test:hydration` rather than here.
    exclude: ['tests/integrations/browser/platform-hydration.test.ts'],
    environment: 'node',
    /**
     * Two files at a time, because every one of them launches real Chromium.
     *
     * Vitest's default is one worker per core, and `ubuntu-latest` has four —
     * so fifteen files went out four Chromiums at a time on a machine that
     * also has `next`, the fixture servers and Vitest itself on it. Run #129's
     * own log is the measurement: 122.88s of test time inside 53.53s of wall
     * clock, 2.3x oversubscribed, with `discover-links.test.ts` alone at 52s.
     *
     * That run is also where `journey-runner` reported one page instead of
     * two. Timing races in a browser suite do not need a fast machine to pass
     * or a slow one to fail; they need a machine whose speed does not move
     * under them, and oversubscription is what moves it. The first CI failure
     * in this repository's history is 2026-08-19T22:47, hours after commit
     * 2baec51 added five more browser files to this suite.
     *
     * `vitest.db.config.ts` and `vitest.hydration.config.ts` both reached for
     * `fileParallelism: false` already. This suite is the heaviest of the
     * three and had no limit at all. Two rather than one because the browser
     * job is not the long pole — the unit job runs lint, typecheck, the unit
     * suite, chaos, a build and the hydration walk — so there is room to keep
     * some parallelism without becoming the thing everything waits on.
     */
    maxWorkers: 2,
  },
});
