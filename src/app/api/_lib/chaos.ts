import { join } from 'node:path';
import type { Environment } from '../../../domain/contracts';
import { buildDefaultDemoJourneySteps } from '../../../integrations/browser/demo-journey';
import type { JourneyStep } from '../../../integrations/browser/types';

/**
 * Steady-state scenarios.
 *
 * These used to have an HTML-string variant alongside the browser one. It was
 * removed with the HTML audit path: its "clean" fixture was a bare `<main>`
 * fragment, which a real rule engine correctly fails for having no page
 * language and no title. A scenario that can only pass against a toy engine is
 * not a steady-state assertion, so the browser scenarios are now the only ones.
 */
export type ChaosScenario =
  | 'browser_omit_ax_tree'
  | 'browser_complete_critical'
  | 'browser_complete_clean'
  | 'browser_passthrough_violations'
  | 'browser_page_cap_truncates'
  | 'browser_time_budget_truncates'
  | 'browser_hint_beats_markup';

export const CHAOS_SCENARIOS: ChaosScenario[] = [
  'browser_omit_ax_tree',
  'browser_complete_critical',
  'browser_complete_clean',
  'browser_passthrough_violations',
  'browser_page_cap_truncates',
  'browser_time_budget_truncates',
  'browser_hint_beats_markup',
];

export function isChaosEnabled(): boolean {
  return process.env.CHAOS_ENABLED === 'true';
}

export type ChaosRunParams = {
  journeyId: string;
  environment: Environment;
  stepId: string;
  fixtureDir: string;
  omitAxTree?: boolean;
  steps?: JourneyStep[];
  /** Below the journey's page count, for the scenario that forces truncation. */
  maxPages?: number;
  /**
   * A walk budget, for the scenario that forces the *other* truncation. Zero is
   * the value that matters and is why this is `?: number` rather than a
   * truthiness check anywhere downstream: a budget already spent still audits
   * the page the walk is on, so `0` is exact rather than flaky.
   */
  budgetMs?: number;
  /** Set against conflicting markup, never with it. */
  platformHint?: string;
};

export const DEFAULT_CHAOS_FIXTURE_DIR = join(process.cwd(), 'fixtures/journey-app');

export function resolveChaosRunParams(
  scenario: ChaosScenario,
  journeyId = 'demo-login',
  environment: Environment = 'staging',
): ChaosRunParams {
  const base: ChaosRunParams = {
    journeyId,
    environment,
    stepId: 'dashboard',
    fixtureDir: DEFAULT_CHAOS_FIXTURE_DIR,
  };

  switch (scenario) {
    case 'browser_omit_ax_tree':
      return {
        ...base,
        omitAxTree: true,
        steps: buildDefaultDemoJourneySteps(),
      };
    case 'browser_complete_critical':
      return {
        ...base,
        steps: buildDefaultDemoJourneySteps(),
      };
    case 'browser_complete_clean':
      return {
        ...base,
        // Every page in this journey must itself be clean, because the run now
        // audits every page it walks through. This scenario used to run the
        // demo login journey — which lands on `dashboard.html`, an image with
        // no alt — and then navigate to a clean page. It passed only because
        // the intermediate page was discarded, which is precisely the bug
        // multi-page scanning fixes. A "clean" assertion that depends on a
        // page being ignored asserts nothing.
        steps: [
          { action: 'navigate', type: 'goto', path: 'login.html' },
          { action: 'navigate', type: 'goto', path: 'dashboard-clean.html' },
        ],
      };
    case 'browser_passthrough_violations':
      // The steady-state claim multi-page scanning adds: a page the journey
      // walks *through* is audited. This journey steps past five real WCAG
      // violations and ends somewhere clean; before multi-page scanning it
      // reported `pass` with zero findings.
      return {
        ...base,
        stepId: 'passthrough',
        steps: [
          { action: 'navigate', type: 'goto', path: 'login.html' },
          { action: 'navigate', type: 'goto', path: 'violations.html' },
          { action: 'navigate', type: 'goto', path: 'dashboard-clean.html' },
        ],
      };
    case 'browser_page_cap_truncates':
      // The cap is the one number here with no measurement behind it, and its
      // value is not what this asserts. The claim is that a run the cap cut
      // short *says so* — `truncatedPages` non-zero and a warn on the way past
      // — so it can never be read as a complete audit of the site. Three pages
      // against a cap of two is the smallest thing that can be true or false.
      //
      // The violations sit inside the cap deliberately: truncation must not be
      // able to hide a finding on a page that was audited.
      return {
        ...base,
        stepId: 'capped',
        maxPages: 2,
        steps: [
          { action: 'navigate', type: 'goto', path: 'login.html' },
          { action: 'navigate', type: 'goto', path: 'violations.html' },
          { action: 'navigate', type: 'goto', path: 'dashboard-clean.html' },
        ],
      };
    case 'browser_time_budget_truncates':
      // A count cap cannot bound a duration, which is the whole reason the walk
      // has a clock: a slow real site inside the page cap was killed
      // mid-invocation by the platform and reconciled to `run_timed_out` six
      // minutes later, with no evidence and no findings. The claim here is that
      // a run the *clock* cut short says so, and says it was the clock — an
      // operator reading `page-cap` raises a number, and raising the page cap
      // is precisely the wrong move on a run that ran out of time.
      //
      // `budgetMs: 0` with the always-audit-at-least-one-page rule, so this is
      // exact on any machine at any speed. A wall-clock threshold here would be
      // a flaky assertion that teaches people to re-run red — the same reason
      // this file asserts timing for presence and consistency and never against
      // a number.
      //
      // `violations.html` **first**, unlike the page-cap scenario where the
      // violations sit inside the cap: here only one page is audited, so the
      // findings have to be on it. Truncation must never be a way for a
      // violation to go unreported, and the expected verdict stays `fail`.
      return {
        ...base,
        stepId: 'timed-out',
        budgetMs: 0,
        steps: [
          { action: 'navigate', type: 'goto', path: 'violations.html' },
          { action: 'navigate', type: 'goto', path: 'login.html' },
          { action: 'navigate', type: 'goto', path: 'dashboard-clean.html' },
        ],
      };
    case 'browser_hint_beats_markup':
      // `platformHint` wins over rendered-DOM heuristics — a steady-state rule
      // that was unit-tested and never exercised through a real run, so
      // nothing proved the hint was still wired from this input to
      // `resolvePlatformMetadata`. "The check was right, nothing called it" is
      // a fault this repo has shipped three times by its own account.
      //
      // The fixture declares itself React; the hint says WordPress. A hint
      // agreeing with the markup would pass whether or not it was ever read.
      return {
        ...base,
        stepId: 'hinted',
        platformHint: 'wordpress',
        steps: [{ action: 'navigate', type: 'goto', path: 'react-clean.html' }],
      };
  }
}

export function expectedCiStatusForScenario(
  scenario: ChaosScenario,
): 'inconclusive' | 'fail' | 'pass' {
  switch (scenario) {
    case 'browser_omit_ax_tree':
      return 'inconclusive';
    case 'browser_complete_critical':
      return 'fail';
    case 'browser_complete_clean':
      return 'pass';
    case 'browser_passthrough_violations':
      return 'fail';
    case 'browser_page_cap_truncates':
      return 'fail';
    case 'browser_time_budget_truncates':
      // Truncation is not a verdict modifier. The page that was audited carries
      // real violations, so the run fails — a bound that softened a verdict
      // would let a slow site buy itself a pass.
      return 'fail';
    case 'browser_hint_beats_markup':
      return 'pass';
  }
}
