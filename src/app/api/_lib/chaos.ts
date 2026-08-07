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
  | 'browser_complete_clean';

export const CHAOS_SCENARIOS: ChaosScenario[] = [
  'browser_omit_ax_tree',
  'browser_complete_critical',
  'browser_complete_clean',
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
        steps: [
          ...buildDefaultDemoJourneySteps(),
          { action: 'navigate', type: 'goto', path: 'dashboard-clean.html' },
        ],
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
  }
}
