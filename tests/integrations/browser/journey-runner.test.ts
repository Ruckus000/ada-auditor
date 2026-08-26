import { access } from 'node:fs/promises';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createEvidenceBundle } from '../../../src/domain/evidence';
import type { PartialJourneyError } from '../../../src/integrations/browser/partial-run';
import {
  buildDefaultDemoJourneySteps,
  NAVIGATION_SETTLE_MS,
  resolveStepTimeoutMs,
  runJourney,
} from '../../../src/integrations/browser/journey-runner';

const FIXTURE_DIR = join(process.cwd(), 'fixtures/journey-app');

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('runJourney', () => {
  it('produces complete evidence artifact files for every page of the demo journey', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const result = await runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'dashboard',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        steps: buildDefaultDemoJourneySteps(),
      });

      // login.html, then dashboard.html after the login click.
      expect(result.pages.map((p) => p.page.route)).toEqual([
        '/login.html',
        '/dashboard.html',
      ]);
      expect(result.pages[1].html).toContain('<img src="hero.png"');
      expect(result.truncatedPages).toBe(0);
      // Absent, not `'page-cap'` with a count of zero: a walk that covered its
      // journey has no cause to name.
      expect(result.truncationReason).toBeUndefined();

      for (const audited of result.pages) {
        expect(audited.artifacts.screenshotPath).toBeTruthy();
        expect(audited.artifacts.domSnapshotPath).toBeTruthy();
        expect(audited.artifacts.axTreePath).toBeTruthy();

        await expect(fileExists(audited.artifacts.screenshotPath!)).resolves.toBe(true);
        await expect(fileExists(audited.artifacts.domSnapshotPath!)).resolves.toBe(true);
        await expect(fileExists(audited.artifacts.axTreePath!)).resolves.toBe(true);

        const evidence = createEvidenceBundle({
          page: audited.page,
          run: {
            journeyId: 'demo-login',
            stepId: 'dashboard',
            environment: 'test',
          },
          artifacts: audited.artifacts,
        });

        expect(evidence.status).toBe('complete');
      }

      // Each page owns its artifact set, so one page's evidence cannot
      // overwrite another's.
      const keys = result.pages.map((p) => p.pageKey);
      expect(new Set(keys).size).toBe(keys.length);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('audits the page a click reaches, even when the navigation starts after the click', async () => {
    /**
     * The defect run #129 reported, made deterministic.
     *
     * `page.waitForLoadState` answers about the document that is current when
     * it is called. A click that navigates from script has only *scheduled*
     * one at that point, so the wait returned against the page being left,
     * `capturePage` read that page's URL, matched it against a page already
     * audited, and returned — dropping the page the click actually reached.
     * The run then reported success with the page simply gone: a revisit is
     * not counted into `truncatedPages`, and until #72 it was not logged
     * either. It is logged now, but as `audit_revisited_page`, which is the
     * wrong story — nothing looped here.
     *
     * On CI this surfaced as `['/login.html']` against the demo journey's two
     * pages, once, and looked like a flake. It is not a flake; it is a race
     * whose losing side needs the navigation to be slower than the click, and
     * `deferred-nav.html` makes it slower on purpose.
     *
     * Fails without the `framenavigated` wait in `journey-runner`: the
     * assertion below sees one page.
     */
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const result = await runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'deferred',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        steps: [
          { action: 'navigate', type: 'goto', path: 'deferred-nav.html' },
          { action: 'navigate', type: 'click', selector: '#go' },
        ],
      });

      expect(result.pages.map((p) => p.page.route)).toEqual([
        '/deferred-nav.html',
        '/dashboard-clean.html',
      ]);

      // Not merely present in the list — actually captured. A page counted but
      // unscanned measures nothing, which is the failure mode one layer down.
      for (const audited of result.pages) {
        await expect(fileExists(audited.artifacts.screenshotPath!)).resolves.toBe(true);
        await expect(fileExists(audited.artifacts.domSnapshotPath!)).resolves.toBe(true);
      }

      // And nothing claimed the walk was cut short, because it was not.
      expect(result.truncatedPages).toBe(0);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('keeps the page when the navigation outlasts the settle grace', async () => {
    /**
     * The case the grace above could not cover, and the one that came back.
     *
     * Master #185 failed the demo-journey assertion at the top of this file
     * with `['/login.html']` — the exact pre-fix symptom, after the fix. The
     * grace expired before the commit on a loaded runner (the browser suite
     * logged 116s of test time inside 63.8s of wall clock), the walk moved on,
     * and `capturePage` deduped against the page it had not left yet.
     *
     * `deferred-nav.html` above cannot catch this: its 300ms delay is inside
     * the grace, so it passes whether or not the runner distinguishes "did not
     * navigate" from "has not navigated yet". `slow-nav.html` is the same
     * fixture with a delay outside the grace — a loaded runner reproduced on
     * purpose instead of waited for.
     *
     * Fails against a runner that only waits out `NAVIGATION_SETTLE_MS`: one
     * page where there are two.
     */
    const fixture = await readFile(join(FIXTURE_DIR, 'slow-nav.html'), 'utf8');
    const delayMs = Number(/data-delay="(\d+)"/.exec(fixture)?.[1]);

    // Without this the test can pass for the wrong reason: raise
    // `NAVIGATION_SETTLE_MS` past the fixture's delay and the grace covers it,
    // the request-evidence branch never runs, and a green result would say
    // nothing at all.
    expect(delayMs).toBeGreaterThan(NAVIGATION_SETTLE_MS);

    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const result = await runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'slow',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        steps: [
          { action: 'navigate', type: 'goto', path: 'slow-nav.html' },
          { action: 'navigate', type: 'click', selector: '#go' },
        ],
      });

      expect(result.pages.map((p) => p.page.route)).toEqual([
        '/slow-nav.html',
        '/dashboard-clean.html',
      ]);

      // Counted is not captured, and a page listed but unscanned measures
      // nothing — the same check the deferred case makes, for the same reason.
      for (const audited of result.pages) {
        await expect(fileExists(audited.artifacts.screenshotPath!)).resolves.toBe(true);
        await expect(fileExists(audited.artifacts.domSnapshotPath!)).resolves.toBe(true);
      }

      expect(result.truncatedPages).toBe(0);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('does not stall on a click that never navigates', async () => {
    /**
     * The other side of the grace above.
     *
     * `NAVIGATION_SETTLE_MS` is waited out in full by any click that does not
     * navigate, and this runner supports those — `capturePage` is written
     * around the case. So the cost has to stay bounded and be measured rather
     * than assumed: `#delete-account` on the login fixture is a `type="button"`
     * with no handler, which is exactly that shape.
     *
     * The ceiling is deliberately loose. It is not asserting the grace is
     * 2000ms; it is asserting the walk still ends promptly, so a future
     * increase does not quietly turn every non-navigating click into a
     * multi-second wait against a run budget measured in hundreds of seconds.
     */
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const startedAt = Date.now();
      const result = await runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'no-nav',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        steps: [
          { action: 'navigate', type: 'goto', path: 'login.html' },
          { action: 'inspect', type: 'click', selector: '#delete-account' },
        ],
      });
      const elapsed = Date.now() - startedAt;

      // The click moved nothing, so there is one page, not two — the dedup
      // this guard must not have broken.
      expect(result.pages.map((p) => p.page.route)).toEqual(['/login.html']);
      expect(elapsed).toBeLessThan(30_000);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('scans a page the journey only passes through', async () => {
    // The whole point. A journey stepping past a page with real violations and
    // ending somewhere clean used to report nothing at all, because only the
    // final page was ever scanned.
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const result = await runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'passthrough',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        steps: [
          { action: 'navigate', type: 'goto', path: 'login.html' },
          { action: 'navigate', type: 'goto', path: 'violations.html' },
          { action: 'navigate', type: 'goto', path: 'dashboard-clean.html' },
        ],
      });

      const violations = result.pages.find((p) => p.page.route === '/violations.html');

      expect(violations).toBeDefined();
      expect(violations!.axe.violations.length).toBeGreaterThanOrEqual(5);
      // The clean final page must not suppress what came before it.
      expect(result.pages[result.pages.length - 1].page.route).toBe('/dashboard-clean.html');
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);

  /**
   * A rule the engine ships switched off is a criterion nobody checks.
   *
   * Nine of axe's 105 rules carry `enabled: false`. Eight are deprecated,
   * obsolete or AAA. The ninth is `target-size` — **WCAG 2.5.8, level AA** —
   * and it was never evaluated: absent from violations, passes, incomplete and
   * inapplicable alike, because a disabled rule does not run at all.
   *
   * Meanwhile `conformanceLevelFromTags` maps `wcag22aa` and `wcag-reference`
   * lists 2.5.8 as AA, so a client's report could never contain a 2.5.8
   * finding and never said it had not looked. This product's signature failure
   * living inside the scanner.
   *
   * Driven through `runJourney` rather than asserted against `scanPageWithAxe`
   * directly, because "the option was set" and "the rule ran on a real page"
   * are different claims and only the second one matters.
   */
  it('evaluates target-size, which axe ships switched off', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const result = await runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'target-size',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        steps: [{ action: 'navigate', type: 'goto', path: 'violations.html' }],
      });

      const page = result.pages.find((one) => one.page.route === '/violations.html');
      const rule = page!.axe.violations.find((one) => one.id === 'target-size');

      // The 16x16 buttons in the fixture, under the 24x24 minimum and touching
      // so the spacing exception cannot spare them.
      expect(rule, 'target-size did not run').toBeDefined();
      expect(rule!.nodes.length).toBeGreaterThan(0);
      // The tag is what carries the criterion through to the report; without
      // it the finding lands with no conformance level at all.
      expect(rule!.tags).toContain('wcag22aa');
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('stops at the page cap and says how much it skipped', async () => {
    // A silent cap reads as "we audited everything" when we did not.
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const result = await runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'capped',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        maxPages: 2,
        steps: [
          { action: 'navigate', type: 'goto', path: 'login.html' },
          { action: 'navigate', type: 'goto', path: 'violations.html' },
          { action: 'navigate', type: 'goto', path: 'dashboard-clean.html' },
        ],
      });

      expect(result.pages).toHaveLength(2);
      expect(result.truncatedPages).toBe(1);
      // Which bound did it, not just that one did. `findings-list.tsx` tells an
      // operator "this run stopped at its page limit", and once a second bound
      // exists that sentence is true-sounding and wrong half the time — so the
      // reader raises a number that was not the problem.
      expect(result.truncationReason).toBe('page-cap');
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('audits a page once however many times the walk lands on it', async () => {
    // A walk that loops back is not a longer audit. The same page scanned
    // twice contributed its findings twice to `totalFindings`, and its check
    // counts twice to the score — which sums passed and failed across pages,
    // so a revisited page was weighted double in the conformance rate a
    // client reads.
    //
    // The revisit here is deliberately *not* adjacent. The guard this covers
    // used to compare only against the previously audited page, so a loop
    // through any other page walked straight past it.
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const result = await runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'revisit',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        steps: [
          { action: 'navigate', type: 'goto', path: 'login.html' },
          { action: 'navigate', type: 'goto', path: 'violations.html' },
          { action: 'navigate', type: 'goto', path: 'login.html' },
        ],
      });

      expect(result.pages.map((audited) => audited.page.route)).toEqual([
        '/login.html',
        '/violations.html',
      ]);
      // Not truncation: the cap did not cut this walk short, and reporting a
      // skipped revisit as a page we could not reach would say something
      // true in a way that means something false.
      expect(result.truncatedPages).toBe(0);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('returns degraded artifacts when ax tree capture is omitted', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const result = await runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'dashboard',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        steps: buildDefaultDemoJourneySteps(),
        omitAxTree: true,
      });

      for (const audited of result.pages) {
        expect(audited.artifacts.axTreePath).toBeUndefined();

        const evidence = createEvidenceBundle({
          page: audited.page,
          run: {
            journeyId: 'demo-login',
            stepId: 'dashboard',
            environment: 'test',
          },
          artifacts: audited.artifacts,
        });

        expect(evidence.status).toBe('degraded');
      }
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('skipScan walks the journey without invoking axe', async () => {
    // The preview endpoint's whole point: an authoring check should cost
    // navigation, not an audit. `violations.html` carries real, known
    // violations (see the passthrough test above), so an empty result here is
    // a real discrimination against skipScan working, not a vacuous pass.
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const result = await runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'skip-scan',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        skipScan: true,
        steps: [
          { action: 'navigate', type: 'goto', path: 'login.html' },
          { action: 'navigate', type: 'goto', path: 'violations.html' },
        ],
      });

      // The exact two-page walk, not merely "some pages" — a truncated or
      // over-eager walk should fail this test, not slide past it.
      expect(result.pages.map((p) => p.page.route)).toEqual(['/login.html', '/violations.html']);
      for (const page of result.pages) {
        expect(page.axe.violations).toEqual([]);
        expect(page.axe.incomplete).toEqual([]);
        expect(page.axe.passCount).toBeUndefined();
        // Absent, not zero: skipScan means "not measured", not "measured and
        // found instant".
        expect(page.timing.scanMs).toBeUndefined();

        // The scan was skipped, but the walk and capture were not — every
        // page still got a real screenshot and DOM snapshot on disk.
        expect(page.artifacts.screenshotPath).toBeTruthy();
        expect(page.artifacts.domSnapshotPath).toBeTruthy();
        await expect(fileExists(page.artifacts.screenshotPath!)).resolves.toBe(true);
        await expect(fileExists(page.artifacts.domSnapshotPath!)).resolves.toBe(true);
      }
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('never executes denied production actions', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      await expect(
        runJourney({
          environment: 'production',
          journeyId: 'demo-login',
          stepId: 'dashboard',
          fixtureDir: FIXTURE_DIR,
          artifactsDir,
          steps: [
            { action: 'navigate', type: 'goto', path: 'login.html' },
            { action: 'delete', type: 'click', selector: '#delete-account' },
          ],
        }),
      ).rejects.toThrow('Action "delete" is not allowed in production.');

      // The journey dies at the denied step, so nothing past it was ever
      // navigated to, scanned, or captured.
      await expect(
        fileExists(join(artifactsDir, 'dashboard', '02-dashboard.png')),
      ).resolves.toBe(false);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });
});

describe('runJourney, against a page with a hostile title', () => {
  /**
   * The bound has to be wired, not merely written.
   *
   * `boundTitle` has its own unit tests, and they all passed with the call in
   * `journey-runner` deleted — 767 unit and 30 browser green against a page
   * title that was no longer bounded at all. That is the same defect this
   * branch already shipped twice: a change that looks like it does something.
   * So this drives a real Chromium against a real page whose `<title>` is 699
   * code units, and asserts on what came back.
   *
   * The fixture's title puts a surrogate pair on the cut deliberately. A naive
   * `slice` leaves half of one behind, which is not valid UTF-8 and reaches a
   * client's report as `�`.
   */
  it('records a bounded title, and does not leave half a character behind', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const result = await runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'long-title',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        steps: [{ action: 'navigate', type: 'goto', path: 'long-title.html' }],
      });

      const title = result.pages[0].page.title;

      // Bounded, and marked as bounded.
      expect(title.length).toBeLessThan(400);
      expect(title.endsWith('…')).toBe(true);

      // The property that survives the wire: no lone surrogate. `isWellFormed`
      // is false for exactly the string a naive slice produces here.
      expect(title.isWellFormed()).toBe(true);
      expect(Buffer.from(title, 'utf8').toString('utf8')).toBe(title);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('runJourney, when a step cannot be performed', () => {
  /**
   * A stale selector is the likeliest way a real journey dies.
   *
   * It used to surface as a bare Playwright timeout, which
   * `classifyRunFailure` had no branch for — so the run reported
   * `audit_run_failed`, "a reason it could not categorise", about the one
   * failure that is entirely the operator's to fix and entirely knowable.
   *
   * The timeout is cut to a second here so the test does not spend Playwright's
   * default thirty waiting for an element that was never going to exist.
   */
  it('names the step, the action and the selector', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const run = runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'stale-selector',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        stepTimeoutMs: 1000,
        steps: [
          { action: 'navigate', type: 'goto', path: 'login.html' },
          { action: 'login', type: 'fill', selector: '#not-on-this-page', value: 'x' },
        ],
      });

      // Which step, which action, which selector — all three, because all
      // three are what an operator needs to go and fix it.
      await expect(run).rejects.toThrow(
        /Step 2 \("login"\) could not fill "#not-on-this-page"/,
      );
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('runJourney, when a fill lands on something it cannot fill', () => {
  /**
   * The value must not travel with the failure.
   *
   * A selector that used to match a login `<input>` and now matches a `<div>`
   * is an ordinary stale-selector case — a redesign is enough. Playwright
   * resolves it, refuses to fill it, and writes the value it was asked to type
   * into `error.message`, `error.stack` and its call log. When that value is a
   * resolved credential, anything that logs the error logs the password.
   *
   * `attemptStep` attaches the original as `cause` rather than interpolating
   * it, so the message it throws is built only from the step's own metadata.
   * Nothing enforced that but the wording of a comment, and a comment does not
   * fail a build — which is the whole reason this test exists.
   */
  it('keeps the typed value out of the error it throws', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));
    const secret = 'hunter2-CORRECT-HORSE';

    try {
      const run = runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'unfillable',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        stepTimeoutMs: 1000,
        steps: [
          { action: 'navigate', type: 'goto', path: 'restyled-login.html' },
          { action: 'login', type: 'fill', selector: '#password', value: secret },
        ],
      });

      const error = await run.then(
        () => {
          throw new Error('expected the fill to fail');
        },
        (thrown: unknown) => thrown as Error,
      );

      // It still names the step, so the operator can fix it.
      expect(error.message).toMatch(/Step 2 \("login"\) could not fill "#password"/);

      // And it says what actually went wrong. This case is not a timeout —
      // Playwright rejects a non-fillable element immediately — so naming the
      // error's class produced "it raised Error", which told the operator
      // nothing the step's own type had not. The first line of Playwright's
      // message is the useful part; the call log below it is the part that
      // carries the value.
      expect(error.message).toMatch(/not an <input>/);

      // And it says nothing about what was being typed. `stack` too, because
      // that is what an uncaught handler prints.
      expect(error.message).not.toContain(secret);
      expect(error.stack ?? '').not.toContain(secret);

      // The original is kept for debugging and does contain the value — which
      // is exactly why it stays off `message` and out of the log line.
      //
      // Walked rather than indexed: `runJourney` wraps a failure again on the
      // way out to carry the pages it captured, so the Playwright error is two
      // links down, and a test that assumed one link would have started
      // passing for the wrong reason the moment that wrapper appeared.
      const causes: string[] = [];
      for (let link: unknown = error.cause; link instanceof Error; link = link.cause) {
        causes.push(link.message);
      }

      expect(causes.join('\n')).toContain(secret);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('resolveStepTimeoutMs', () => {
  // Exported and used by `runJourney`, and previously asserted nowhere: the
  // default, the env override and the fallbacks were all unguarded.
  //
  // Here rather than beside `classifyRunFailure`, where it was first written:
  // that suite is the fast one, and importing this module into it pulls
  // `playwright-core` along — 495ms of import for four numeric assertions.
  // `resolveMaxPages` is tested from this suite for the same reason.
  const original = process.env.AUDITOR_STEP_TIMEOUT_MS;

  afterEach(() => {
    if (original === undefined) delete process.env.AUDITOR_STEP_TIMEOUT_MS;
    else process.env.AUDITOR_STEP_TIMEOUT_MS = original;
  });

  it('defaults to ten seconds, not to Playwright’s thirty', () => {
    delete process.env.AUDITOR_STEP_TIMEOUT_MS;
    expect(resolveStepTimeoutMs()).toBe(10_000);
  });

  it('prefers an explicit value over the environment', () => {
    process.env.AUDITOR_STEP_TIMEOUT_MS = '5000';
    expect(resolveStepTimeoutMs(1000)).toBe(1000);
  });

  it('reads the environment when no value is passed', () => {
    process.env.AUDITOR_STEP_TIMEOUT_MS = '25000';
    expect(resolveStepTimeoutMs()).toBe(25_000);
  });

  it('falls back rather than trusting a nonsense value', () => {
    // A typo in a deploy's environment must not mean "no timeout" or a
    // negative one, either of which hangs a run against the 300s ceiling.
    for (const bad of ['0', '-1', 'soon', '']) {
      process.env.AUDITOR_STEP_TIMEOUT_MS = bad;
      expect(resolveStepTimeoutMs()).toBe(10_000);
    }
    delete process.env.AUDITOR_STEP_TIMEOUT_MS;
    expect(resolveStepTimeoutMs(-5)).toBe(10_000);
  });
});

describe('runJourney, when it dies partway through', () => {
  /**
   * A journey that failed at step five of eight had still audited four pages.
   *
   * They used to go with the stack. `pages` was a local inside the `try`, so
   * nothing could reach it from the catch; `runBrowserAudit` never saw it; and
   * `executeRun` stored `findings: []` and no pages. A run that found real
   * violations and then hit a stale selector reported nothing at all —
   * indistinguishable from a run that found nothing, which is the difference
   * that matters most in an auditor.
   */
  it('carries the pages it captured out with the error', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const error = await runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'partial',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        stepTimeoutMs: 1000,
        steps: [
          { action: 'navigate', type: 'goto', path: 'login.html' },
          { action: 'navigate', type: 'goto', path: 'violations.html' },
          { action: 'login', type: 'fill', selector: '#gone', value: 'x' },
          { action: 'navigate', type: 'goto', path: 'dashboard-clean.html' },
        ],
      }).then(
        () => {
          throw new Error('expected the journey to fail');
        },
        (thrown: unknown) => thrown as PartialJourneyError,
      );

      // The two pages walked before the bad step, and not the one after it.
      expect(error.captured.pages.map((p) => p.page.route)).toEqual([
        '/login.html',
        '/violations.html',
      ]);

      // Real findings, on a page really visited. This is what was being
      // thrown away.
      const violations = error.captured.pages.find((p) => p.page.route === '/violations.html');
      expect(violations!.axe.violations.length).toBeGreaterThanOrEqual(5);

      // And the failure is unchanged in every respect the classifier reads,
      // so a partial run still reports why it stopped.
      expect(error.message).toMatch(/Step 3 \("login"\) could not fill "#gone"/);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);
});
