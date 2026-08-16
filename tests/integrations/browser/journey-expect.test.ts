import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJourney } from '../../../src/integrations/browser/journey-runner';

/**
 * The `expect` step, which is the settle primitive as well as the assertion.
 *
 * The failure this closes is the one the whole plan is named for: a login that
 * silently fails is audited as though it succeeded. Nothing waited for the
 * destination and nothing checked it had arrived, so a wrong password left the
 * run on the login page and reported a clean pass over it — a *higher* score
 * than the real app would get, because a login page is small and tidy.
 */

const FIXTURE_DIR = join(process.cwd(), 'fixtures/journey-app');

let artifactsDir: string;

beforeAll(async () => {
  artifactsDir = await mkdtemp(join(tmpdir(), 'ada-expect-'));
});

afterAll(async () => {
  await rm(artifactsDir, { recursive: true, force: true });
});

function login(user: string, pass: string) {
  return [
    { action: 'navigate', type: 'goto' as const, path: 'login.html' },
    { action: 'login', type: 'fill' as const, selector: '#username', value: user },
    { action: 'login', type: 'fill' as const, selector: '#password', value: pass },
    { action: 'login', type: 'click' as const, selector: '#login-button' },
  ];
}

describe('the expect step', () => {
  it('lets a journey that really arrived carry on', async () => {
    const result = await runJourney({
      environment: 'test',
      journeyId: 'expect-demo',
      stepId: 'arrived',
      fixtureDir: FIXTURE_DIR,
      artifactsDir,
      // Short, so a broken expectation fails this test in seconds rather than
      // sitting on the 30s default an expectation gets in production.
      stepTimeoutMs: 3_000,
      expectTimeoutMs: 3_000,
      steps: [
        ...login('auditor', 'demo-pass'),
        {
          action: 'inspect',
          type: 'expect',
          urlIncludes: 'dashboard.html',
          selector: 'h1',
        },
      ],
    });

    expect(result.pages.map((page) => page.page.route)).toContain('/dashboard.html');
  }, 60_000);

  /**
   * The bug itself, pinned as a control.
   *
   * Not a test of the new step — a test of what the same journey does without
   * it, so the claim above this file is verified rather than asserted. A wrong
   * password produces a run that completed, captured one page, and would be
   * scored and reported as a clean audit. Of the login page.
   *
   * If this ever starts failing, the false pass has been closed somewhere else
   * and the expect step's justification needs rereading.
   */
  it('without an expectation, a failed login reports a clean-looking run', async () => {
    const result = await runJourney({
      environment: 'test',
      journeyId: 'expect-demo',
      stepId: 'silent-failure',
      fixtureDir: FIXTURE_DIR,
      artifactsDir,
      stepTimeoutMs: 3_000,
      expectTimeoutMs: 3_000,
      steps: login('auditor', 'wrong-password'),
    });

    // One page, and it is the login — the journey never left it, and nothing
    // in the result says so.
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].page.route).toBe('/login.html');
    expect(result.truncatedPages).toBe(0);
  }, 60_000);

  /**
   * The headline case. Without the expectation this exact journey returns a
   * clean report of the login page.
   */
  it('fails a login that did not happen, naming what it wanted and where it was', async () => {
    const run = runJourney({
      environment: 'test',
      journeyId: 'expect-demo',
      stepId: 'never-arrived',
      fixtureDir: FIXTURE_DIR,
      artifactsDir,
      stepTimeoutMs: 3_000,
      expectTimeoutMs: 3_000,
      steps: [
        ...login('auditor', 'wrong-password'),
        { action: 'inspect', type: 'expect', urlIncludes: 'dashboard.html' },
      ],
    });

    // The step, in the format `classifyRunFailure` reads as
    // `journey_step_failed` rather than "a reason it could not categorise".
    await expect(run).rejects.toThrow(/^Step 5 \("inspect"\) could not expect/);
    // What was wanted...
    await expect(run).rejects.toThrow(/dashboard\.html/);
    // ...and where it actually was, which is usually the whole answer.
    await expect(run).rejects.toThrow(/the page was at ".*login\.html"/);
  }, 60_000);

  /**
   * Hidden markup must not satisfy an expectation.
   *
   * `state: 'visible'` rather than `attached`, because a failed login commonly
   * leaves the destination's markup in the DOM but hidden — `login.html`'s own
   * error paragraph is exactly that shape. An expectation satisfied by hidden
   * markup would be the false pass this step exists to prevent.
   */
  it('is not satisfied by an element that is present but hidden', async () => {
    const run = runJourney({
      environment: 'test',
      journeyId: 'expect-demo',
      stepId: 'hidden',
      fixtureDir: FIXTURE_DIR,
      artifactsDir,
      stepTimeoutMs: 3_000,
      expectTimeoutMs: 3_000,
      steps: [
        { action: 'navigate', type: 'goto', path: 'login.html' },
        // `#login-error` exists in the markup from the start, with `hidden`.
        { action: 'inspect', type: 'expect', selector: '#login-error' },
      ],
    });

    await expect(run).rejects.toThrow(/could not expect "#login-error" to be visible/);
  }, 60_000);

  it('captures no page of its own', async () => {
    // An expectation is not a page. Counting one would inflate `pagesAudited`
    // with something nothing ever scanned — the number this product exists to
    // make honest.
    const without = await runJourney({
      environment: 'test',
      journeyId: 'expect-demo',
      stepId: 'pages-without',
      fixtureDir: FIXTURE_DIR,
      artifactsDir,
      stepTimeoutMs: 3_000,
      expectTimeoutMs: 3_000,
      steps: [{ action: 'navigate', type: 'goto', path: 'login.html' }],
    });

    const with_ = await runJourney({
      environment: 'test',
      journeyId: 'expect-demo',
      stepId: 'pages-with',
      fixtureDir: FIXTURE_DIR,
      artifactsDir,
      stepTimeoutMs: 3_000,
      expectTimeoutMs: 3_000,
      steps: [
        { action: 'navigate', type: 'goto', path: 'login.html' },
        { action: 'inspect', type: 'expect', selector: '#login-form' },
      ],
    });

    expect(with_.pages.length).toBe(without.pages.length);
  }, 60_000);

  it('refuses an expectation with nothing to expect', async () => {
    // Reachable: `runJourney` is called by tests and scripts that never went
    // through the route schema. A step that asserts nothing while looking as
    // though it asserts something is worse than no step at all.
    const run = runJourney({
      environment: 'test',
      journeyId: 'expect-demo',
      stepId: 'empty',
      fixtureDir: FIXTURE_DIR,
      artifactsDir,
      stepTimeoutMs: 3_000,
      expectTimeoutMs: 3_000,
      steps: [
        { action: 'navigate', type: 'goto', path: 'login.html' },
        { action: 'inspect', type: 'expect' },
      ],
    });

    await expect(run).rejects.toThrow(/could not expect anything/);
  }, 60_000);
});
