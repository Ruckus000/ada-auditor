import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_PAGES_PER_RUN,
  DEFAULT_WALK_BUDGET_MS,
  MAX_RUN_DURATION_MS,
  RUN_RESERVE_MS,
  positiveIntFrom,
  resolveMaxPages,
  resolveWalkBudgetMs,
} from '../../src/domain/run-limits';

/**
 * The bounds a run is held to, in the one module every layer can import.
 *
 * This suite is in the fast tier deliberately. The two resolvers used to live
 * in `journey-runner.ts`, which imports Playwright and axe — so the env branch
 * of `resolveMaxPages` could only have been tested by dragging a browser into
 * the unit suite, and it was therefore never tested at all.
 */
describe('run limits', () => {
  const originalMaxPages = process.env.AUDITOR_MAX_PAGES_PER_RUN;
  const originalBudget = process.env.AUDITOR_WALK_BUDGET_MS;

  afterEach(() => {
    if (originalMaxPages === undefined) delete process.env.AUDITOR_MAX_PAGES_PER_RUN;
    else process.env.AUDITOR_MAX_PAGES_PER_RUN = originalMaxPages;
    if (originalBudget === undefined) delete process.env.AUDITOR_WALK_BUDGET_MS;
    else process.env.AUDITOR_WALK_BUDGET_MS = originalBudget;
  });

  it('derives the walk budget from the reserve, not the other way round', () => {
    // The reserve is a property of what happens *after* the walk — upload,
    // advisory, persistence, and the page still in flight — so it is the named
    // number and the budget is what is left. When the deployment moves to Pro's
    // 800s ceiling, `MAX_RUN_DURATION_MS` changes and this relationship holds
    // without anybody editing a second constant to match.
    expect(DEFAULT_WALK_BUDGET_MS).toBe(MAX_RUN_DURATION_MS - RUN_RESERVE_MS);
    expect(DEFAULT_WALK_BUDGET_MS).toBeGreaterThan(0);
  });

  it('leaves room for the page still in flight when the budget expires', () => {
    // The budget bounds when new work *starts*, never when in-flight work
    // finishes, so a walk that stops at the deadline can still be inside one
    // expectation. A reserve smaller than that expectation would be a reserve
    // that cannot cover the thing it exists to cover.
    expect(RUN_RESERVE_MS).toBeGreaterThan(30_000);
  });

  it('parses a positive integer and falls back on anything else', () => {
    // One parser, because three disagreed: `journey-runner` floored,
    // `deployment-config` demanded an integer outright, and `blob-store`
    // accepted 1.5 days of retention.
    expect(positiveIntFrom('7', 20)).toBe(7);
    expect(positiveIntFrom(7.9, 20)).toBe(7);
    expect(positiveIntFrom(undefined, 20)).toBe(20);
    expect(positiveIntFrom('', 20)).toBe(20);
    expect(positiveIntFrom('abc', 20)).toBe(20);
    expect(positiveIntFrom('0', 20)).toBe(20);
    expect(positiveIntFrom('-3', 20)).toBe(20);
  });

  it('prefers an explicit page cap over the environment', () => {
    process.env.AUDITOR_MAX_PAGES_PER_RUN = '9';
    expect(resolveMaxPages(3)).toBe(3);
  });

  it('reads the page cap from the environment when the caller names none', () => {
    // The branch every cap test skipped. `maxPages` is passed explicitly by
    // chaos, by the runner suite and by nothing else, so `AUDITOR_MAX_PAGES_
    // PER_RUN` shipped documented, deployed and unexercised.
    process.env.AUDITOR_MAX_PAGES_PER_RUN = '9';
    expect(resolveMaxPages()).toBe(9);

    process.env.AUDITOR_MAX_PAGES_PER_RUN = 'lots';
    expect(resolveMaxPages()).toBe(DEFAULT_MAX_PAGES_PER_RUN);
  });

  it('honours an explicit budget of zero', () => {
    // Zero means something for a budget in a way it does not for a page cap: a
    // cap of zero would audit nothing, whereas a budget already spent still
    // audits the page the walk is on. That rule is what makes every budget test
    // exact without a `sleep`, so the resolver must not treat 0 as absent.
    expect(resolveWalkBudgetMs(0)).toBe(0);
  });

  it('reads the walk budget from the environment, then from the derived default', () => {
    process.env.AUDITOR_WALK_BUDGET_MS = '45000';
    expect(resolveWalkBudgetMs()).toBe(45_000);

    delete process.env.AUDITOR_WALK_BUDGET_MS;
    expect(resolveWalkBudgetMs()).toBe(DEFAULT_WALK_BUDGET_MS);
  });
});
