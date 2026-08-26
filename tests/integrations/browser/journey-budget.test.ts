import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { runJourney } from '../../../src/integrations/browser/journey-runner';

const FIXTURE_DIR = join(process.cwd(), 'fixtures/journey-app');

async function inTempDir<T>(run: (artifactsDir: string) => Promise<T>): Promise<T> {
  const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-budget-'));
  try {
    return await run(artifactsDir);
  } finally {
    await rm(artifactsDir, { recursive: true, force: true });
  }
}

/**
 * The wall clock on the walk.
 *
 * Every test here passes `budgetMs: 0`, and that is what makes them exact on
 * any machine at any speed. The product rule is that a walk **always audits at
 * least one page**: a budget already spent at entry — a cold
 * `@sparticuz/chromium` launch eats real seconds — must not produce a zero-page
 * run, because an evidence-free outcome is the thing the budget exists to
 * remove. So the budget refuses the *second* page onward, and a spent budget is
 * a deterministic input rather than a race against a fixture delay.
 *
 * Nothing here reads live DOM, so nothing here polls: these assertions are over
 * the value `runJourney` returned, which is not going to change while we look
 * at it.
 */
describe('the walk budget', () => {
  it('audits the page it landed on when the budget is already spent', async () => {
    // The settle-guard regression, and the reason it is first.
    //
    // The end-of-walk settle calls `capturePage` again, and `capturePage` counts
    // a capture it refuses into `truncatedPages`. Guarding that call on a bound
    // that has been reached — rather than on the page cap alone — is what stops
    // a single-page walk reporting that it skipped two pages it was never going
    // to visit. The two `< maxPages` guards exist for exactly that; this holds
    // the property for the second bound.
    const result = await inTempDir((artifactsDir) =>
      runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'budget-one',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        budgetMs: 0,
        steps: [{ action: 'navigate', type: 'goto', path: 'violations.html' }],
      }),
    );

    expect(result.pages).toHaveLength(1);
    expect(result.truncatedPages).toBe(0);
    expect(result.truncationReason).toBeUndefined();

    // And it is a real audit, not a page opened and skipped. A budget that
    // produced a page with nothing on it would be the evidence-free run under a
    // different name.
    expect(result.pages[0].axe.violations.length).toBeGreaterThan(0);
  }, 60_000);

  it('stops at the budget, says the budget did it, and counts what it skipped', async () => {
    const result = await inTempDir((artifactsDir) =>
      runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'budget-stop',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        budgetMs: 0,
        steps: [
          { action: 'navigate', type: 'goto', path: 'violations.html' },
          { action: 'navigate', type: 'goto', path: 'login.html' },
          { action: 'navigate', type: 'goto', path: 'dashboard-clean.html' },
        ],
      }),
    );

    expect(result.pages.map((audited) => audited.page.route)).toEqual(['/violations.html']);
    // The two navigations the walk declined to start. Counted in one go at the
    // top of the loop rather than one per refused capture, because navigating
    // costs exactly the clock we just ran out of.
    expect(result.truncatedPages).toBe(2);
    expect(result.truncationReason).toBe('budget');
  }, 60_000);

  it('names the page cap when both bounds are spent', async () => {
    // First cause wins, and the cap is asked first. An operator reading
    // `budget` reaches for a container worker; reading `page-cap` they raise a
    // number. A walk stopped by its cap must not send them to the wrong one.
    const result = await inTempDir((artifactsDir) =>
      runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'budget-both',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        budgetMs: 0,
        maxPages: 1,
        steps: [
          { action: 'navigate', type: 'goto', path: 'violations.html' },
          { action: 'navigate', type: 'goto', path: 'login.html' },
          { action: 'navigate', type: 'goto', path: 'dashboard-clean.html' },
        ],
      }),
    );

    expect(result.pages).toHaveLength(1);
    expect(result.truncatedPages).toBe(2);
    expect(result.truncationReason).toBe('page-cap');
  }, 60_000);

  it('is not truncated by a budget it fits inside', async () => {
    // The other half, and the one a bug here would make silently expensive: a
    // budget that truncated a walk it had room for would quietly shrink every
    // real audit.
    const result = await inTempDir((artifactsDir) =>
      runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'budget-fits',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        budgetMs: 120_000,
        steps: [
          { action: 'navigate', type: 'goto', path: 'login.html' },
          { action: 'navigate', type: 'goto', path: 'violations.html' },
        ],
      }),
    );

    expect(result.pages.map((audited) => audited.page.route)).toEqual([
      '/login.html',
      '/violations.html',
    ]);
    expect(result.truncatedPages).toBe(0);
    expect(result.truncationReason).toBeUndefined();
  }, 60_000);
});
