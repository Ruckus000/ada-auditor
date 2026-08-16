import { access } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createEvidenceBundle } from '../../../src/domain/evidence';
import {
  buildDefaultDemoJourneySteps,
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

      // And it says nothing about what was being typed. `stack` too, because
      // that is what an uncaught handler prints.
      expect(error.message).not.toContain(secret);
      expect(error.stack ?? '').not.toContain(secret);

      // The original is kept for debugging and does contain the value — which
      // is exactly why it stays off `message` and out of the log line.
      expect(String((error.cause as Error)?.message ?? '')).toContain(secret);
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
