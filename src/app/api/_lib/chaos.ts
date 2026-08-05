import { join } from 'node:path';
import type { Environment } from '../../../domain/contracts';
import { buildDefaultDemoJourneySteps } from '../../../integrations/browser/demo-journey';
import type { JourneyStep } from '../../../integrations/browser/types';

export type ChaosScenario = 'omit_ax_tree' | 'complete_critical' | 'complete_clean';

export type BrowserChaosScenario =
  | 'browser_omit_ax_tree'
  | 'browser_complete_critical'
  | 'browser_complete_clean';

export const CHAOS_SCENARIOS: ChaosScenario[] = [
  'omit_ax_tree',
  'complete_critical',
  'complete_clean',
];

export const BROWSER_CHAOS_SCENARIOS: BrowserChaosScenario[] = [
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
  html: string;
  omitAxTree?: boolean;
  platformHint?: string;
};

export type BrowserChaosRunParams = {
  browserMode: true;
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
  journeyId = 'chaos-demo',
  environment: Environment = 'staging',
): ChaosRunParams {
  switch (scenario) {
    case 'omit_ax_tree':
      return {
        journeyId,
        environment,
        html: '<main><img src="hero.png"></main>',
        omitAxTree: true,
      };
    case 'complete_critical':
      return {
        journeyId,
        environment,
        html: '<main><img src="hero.png"></main>',
      };
    case 'complete_clean':
      return {
        journeyId,
        environment,
        html: '<main><img src="hero.png" alt="Hero"></main>',
      };
  }
}

export function resolveBrowserChaosRunParams(
  scenario: BrowserChaosScenario,
  journeyId = 'demo-login',
  environment: Environment = 'staging',
): BrowserChaosRunParams {
  const base: BrowserChaosRunParams = {
    browserMode: true,
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

export function expectedCiStatusForScenario(scenario: ChaosScenario): 'inconclusive' | 'fail' | 'pass' {
  switch (scenario) {
    case 'omit_ax_tree':
      return 'inconclusive';
    case 'complete_critical':
      return 'fail';
    case 'complete_clean':
      return 'pass';
  }
}

export function expectedCiStatusForBrowserScenario(
  scenario: BrowserChaosScenario,
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
