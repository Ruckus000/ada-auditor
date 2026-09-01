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
    /**
     * Sixty seconds, because Vitest's 5000ms default was the actual bug.
     *
     * Every test here that launches Chromium already ends `}, 60_000)` — the
     * convention across six files. Five tests across three files never got
     * one and have been running against the default instead: `[V]` of four
     * browser failures in 207 recorded `localci` suite runs, two are exactly
     * that, at 5005ms (`never executes denied production actions`,
     * 2026-08-25) and 5001ms (`records a linked PDF as a document…`,
     * 2026-09-01). Both passed alone on re-run, which is what a
     * suite-load-sensitive limit looks like.
     *
     * A crawl cannot fit in five seconds and was never meant to.
     * `DISCOVERY_DELAY_MS` is 250ms of MANDATED politeness between hops, so a
     * ~11-URL fixture crawl spends ~2.5s asleep before a browser launch or a
     * single navigation is paid for. `[V]` Measured on an idle machine: 3131ms
     * for that PDF test, and 5396ms for the slowest test in the suite — over
     * the default with nothing else running.
     *
     * This is the shape `vitest.db.config.ts` names above its own timeout:
     * a heavy suite held to a unit suite's clock, failing first wherever it is
     * heaviest, and read as flakiness for weeks. The other three heavy configs
     * — db, hydration, documents — all set their own. This one did not, and
     * the per-test convention grew up to compensate for that.
     *
     * 60_000 rather than a rounder guess: it is what every crawling sibling
     * already grants, and it equals `DISCOVERY_BUDGET_MS`, so it cannot mask a
     * hang — a stuck crawl still self-terminates on its own budget and returns
     * `truncated`. `[V]` No test exercises that budget
     * (`discover-links-truncation` asserts `url-cap` and says in its header
     * that it avoids tripping the budget first), so there is no boundary here
     * for a test to sit on.
     *
     * The per-test values still win: Vitest resolves
     * `options.timeout ?? config.testTimeout`, so the axe and render tests
     * keep their `120_000`. That also leaves ~60 tests restating 60_000 for no
     * effect. They stay — deleting them is a large diff for no behaviour
     * change, and it would flatten the `120_000` ones that still say
     * something.
     *
     * `[V]` Both halves of that were checked by running this suite at
     * `testTimeout: 1`: exactly seven tests failed and 108 passed, so a
     * per-test value does override the config, and the seven are precisely the
     * ones that never got one. Reading the files had found four of them. The
     * other three are the useful part — `page-facts` evaluates against a real
     * page opened in `beforeAll`, so its two tests were on the 5s default too,
     * and this was never a two-file problem. Five of the seven touch a
     * browser; the two that do not (`artifact-path` and `run-browser-audit`
     * both assert a refusal that happens before any launch) are covered
     * harmlessly.
     *
     * `hookTimeout` is deliberately NOT set. Only `page-facts.test.ts` launches
     * a browser inside a hook, against a 10s default it clears by an order of
     * magnitude, and no hook has timed out in those 207 runs. A first draft of
     * this comment claimed two such files; the second was a grep matching
     * `chromium.launch` inside a comment.
     */
    testTimeout: 60_000,
  },
});
