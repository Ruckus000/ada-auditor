import { describe, expect, it } from 'vitest';
import { PRACTICE_SCENARIOS } from '../../src/app/components/practice-scenarios';
import {
  CHAOS_SCENARIOS,
  expectedCiStatusForScenario,
} from '../../src/app/api/_lib/chaos';

/**
 * Practice mode existed for months sending scenario names the API never
 * accepted (`complete_clean` against a schema that only allows
 * `browser_complete_clean`), so every button returned
 * `400 invalid_request_body`. A control that looks live and does nothing is
 * worse than no control, and nothing caught it because the two lists lived in
 * different files and were only ever compared by a human reading both.
 */
describe('practice mode scenarios', () => {
  it('offers only scenario names the run API accepts', () => {
    for (const item of PRACTICE_SCENARIOS) {
      expect(CHAOS_SCENARIOS).toContain(item.scenario);
    }
  });

  it('labels each scenario with the outcome it actually produces', () => {
    // A button promising "a pass" that produces a fail teaches the operator
    // the wrong thing about the verdicts.
    for (const item of PRACTICE_SCENARIOS) {
      expect(item.outcome).toBe(expectedCiStatusForScenario(item.scenario));
    }
  });

  it('demonstrates every outcome an operator can be shown', () => {
    const outcomes = new Set(PRACTICE_SCENARIOS.map((item) => item.outcome));

    expect(outcomes).toEqual(new Set(['pass', 'fail', 'inconclusive']));
  });
});
