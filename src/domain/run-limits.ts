/**
 * The bounds a run is held to, in one place every layer can read.
 *
 * These numbers were spelled out four times — the runner's `DEFAULT_MAX_PAGES`,
 * the settings screen's literal `20`, the discovery panel's `SOFT_PAGE_ADVICE`,
 * and the handler's own copy of the function ceiling — and a discovery test
 * carried a comment saying no shared constant existed to import. Four copies of
 * a number nobody has finished deciding is how a cap gets raised in one place
 * and quietly disagreed with in three.
 *
 * No framework and no node imports, so a client component, a service, the
 * runner and `scripts/` can all import this without dragging anything behind
 * them. That is load-bearing rather than tidy: the two resolvers below used to
 * live in `journey-runner.ts`, which pulls in Playwright and axe, so the fast
 * suite could not reach them and the environment branch of `resolveMaxPages`
 * shipped unexercised.
 */

/**
 * How many pages one run will audit.
 *
 * One measurement behind it: a four-page run of the W3C BAD demo through a
 * production function (`d62f13f4-4a33-4f14-b592-4b243c4f3e62`, 2026-08-15) took
 * 23.0s, slowest page 4.0s of which 2.9s was the axe scan. Twenty such pages is
 * about 80s.
 *
 * Read that as a floor, not a budget. Four small static documents with no
 * framework, no login and nothing deferred are the easy case, and no run
 * against a real client app has happened. This is now the *second* of two
 * bounds — `DEFAULT_WALK_BUDGET_MS` is what makes it safe to wait for a real
 * measurement instead of guessing a better number now.
 */
export const DEFAULT_MAX_PAGES_PER_RUN = 20;

/**
 * The ceiling a run has to fit inside, mirroring `maxDuration` on the browser
 * routes. Hobby allows 300s; Pro allows 800s.
 *
 * A run is not stopped at this number — the platform stops it, and rather more
 * abruptly, which is the outcome the walk budget exists to reach first.
 */
export const MAX_RUN_DURATION_MS = 300_000;

/**
 * Everything that happens after the walk, plus the page still in flight.
 *
 * Derived from the only production measurement there is: 25s of upload (0.4s
 * per page over twenty, tripled for heavier real screenshots), 60s of advisory
 * (the 1.0s observed was a pass with nothing to say, so the allowance is honest
 * rather than measured), 5s of persistence, and 30s for the page in flight —
 * `AUDITOR_EXPECT_TIMEOUT_MS`, because the budget bounds when new work starts
 * and never when in-flight work finishes.
 *
 * One-third measurement and two-thirds judgement, the advisory line especially.
 * It is falsifiable: `phaseMs.advisory` is recorded on every run, complete or
 * failed. Revisit it with the page cap, from the same artifact.
 *
 * **This is the named constant and the budget is derived from it**, because the
 * reserve is a property of what happens after the walk and does not change when
 * the function ceiling does.
 */
export const RUN_RESERVE_MS = 120_000;

/** What is left of the function for the walk itself. */
export const DEFAULT_WALK_BUDGET_MS = MAX_RUN_DURATION_MS - RUN_RESERVE_MS;

/**
 * Why a walk stopped short of its journey.
 *
 * Two bounds stop different things, and an operator's next move differs by
 * which one bit: a page cap says raise the cap, a budget says get a container
 * worker. A run that reported only "truncated" would send them to change the
 * number that was not the problem.
 */
export type JourneyTruncationReason = 'page-cap' | 'budget';

/**
 * Reads a positive integer, falling back rather than throwing.
 *
 * One parser because three disagreed. `journey-runner` floored a finite
 * positive; `deployment-config` demanded `Number.isInteger`, so `AUDITOR_MAX_
 * PAGES_PER_RUN=20.0` read as unset on the screen whose job is to say what the
 * deployment is doing; `blob-store` accepted 1.5 and retained evidence for a
 * day and a half.
 */
export function positiveIntFrom(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Most pages this run will audit: the caller's number, the environment's, then the default. */
export function resolveMaxPages(explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  return positiveIntFrom(process.env.AUDITOR_MAX_PAGES_PER_RUN, DEFAULT_MAX_PAGES_PER_RUN);
}

/**
 * How long the walk may spend starting new work.
 *
 * Zero is accepted where the page cap refuses it, and the asymmetry is the
 * product rule: a cap of zero would audit nothing, while a budget already spent
 * still audits the page the walk is on. A cold `@sparticuz/chromium` launch eats
 * real seconds, and a zero-page run is precisely the evidence-free outcome the
 * budget exists to remove — so the budget refuses the *second* page onward.
 *
 * It also makes every budget test exact on any machine at any speed, with no
 * `sleep` and no fixture delay to race.
 */
export function resolveWalkBudgetMs(explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit >= 0) {
    return Math.floor(explicit);
  }
  return positiveIntFrom(process.env.AUDITOR_WALK_BUDGET_MS, DEFAULT_WALK_BUDGET_MS);
}
