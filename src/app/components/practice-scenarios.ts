import type { ChaosScenario } from '../api/_lib/chaos';

/**
 * The rigged runs Practice mode offers, so an operator can see each verdict
 * before it matters.
 *
 * `scenario` must be a name `POST /api/audit/run` actually accepts. This list
 * used to carry short names (`complete_clean`) while the route's schema only
 * ever accepted the `browser_`-prefixed ones, so every practice button
 * returned `400 invalid_request_body` — a dead control that looked live. The
 * type binds the two together, and `practice-scenarios.test.ts` checks the
 * values against `CHAOS_SCENARIOS` so a renamed scenario cannot quietly break
 * the buttons again.
 */
export type PracticeScenario = {
  scenario: ChaosScenario;
  label: string;
  outcome: 'pass' | 'fail' | 'inconclusive';
};

export const PRACTICE_SCENARIOS: PracticeScenario[] = [
  { scenario: 'browser_complete_clean', label: 'a pass', outcome: 'pass' },
  { scenario: 'browser_complete_critical', label: 'a fail', outcome: 'fail' },
  {
    scenario: 'browser_passthrough_violations',
    label: 'a fail on a page the journey only passes through',
    outcome: 'fail',
  },
  { scenario: 'browser_omit_ax_tree', label: 'an inconclusive', outcome: 'inconclusive' },
];
