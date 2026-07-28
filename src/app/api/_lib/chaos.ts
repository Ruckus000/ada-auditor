import type { Environment } from '../../../domain/contracts';

export type ChaosScenario = 'omit_ax_tree' | 'complete_critical' | 'complete_clean';

export const CHAOS_SCENARIOS: ChaosScenario[] = [
  'omit_ax_tree',
  'complete_critical',
  'complete_clean',
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
