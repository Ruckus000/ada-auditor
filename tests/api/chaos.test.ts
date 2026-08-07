import { describe, expect, it } from 'vitest';
import {
  CHAOS_SCENARIOS,
  expectedCiStatusForScenario,
  resolveChaosRunParams,
} from '../../src/app/api/_lib/chaos';

/**
 * The HTML-string scenarios that used to sit alongside these were removed with
 * the HTML audit path. Their "clean" case was a bare `<main>` fragment, which
 * a real rule engine correctly fails for having no page language and no title
 * — an assertion that could only hold against a single-regex engine.
 */
describe('chaos scenarios', () => {
  it('covers omit / critical / clean browser fixtures', () => {
    expect(CHAOS_SCENARIOS).toEqual([
      'browser_omit_ax_tree',
      'browser_complete_critical',
      'browser_complete_clean',
    ]);
  });

  it('browser_omit_ax_tree expects inconclusive and omits the ax tree', () => {
    const params = resolveChaosRunParams('browser_omit_ax_tree');

    expect(params.omitAxTree).toBe(true);
    expect(expectedCiStatusForScenario('browser_omit_ax_tree')).toBe('inconclusive');
  });

  it('browser_complete_critical stays on the dashboard with the missing alt', () => {
    const params = resolveChaosRunParams('browser_complete_critical');

    expect(params.omitAxTree).toBeFalsy();
    expect(
      params.steps?.some((step) => step.type === 'goto' && step.path === 'dashboard-clean.html'),
    ).toBe(false);
    expect(expectedCiStatusForScenario('browser_complete_critical')).toBe('fail');
  });

  it('browser_complete_clean navigates to the clean dashboard fixture', () => {
    const params = resolveChaosRunParams('browser_complete_clean');

    expect(
      params.steps?.some((step) => step.type === 'goto' && step.path === 'dashboard-clean.html'),
    ).toBe(true);
    expect(expectedCiStatusForScenario('browser_complete_clean')).toBe('pass');
  });

  it('every scenario resolves runnable browser params', () => {
    for (const scenario of CHAOS_SCENARIOS) {
      const params = resolveChaosRunParams(scenario);

      expect(params.stepId).toBeTruthy();
      expect(params.fixtureDir).toContain('fixtures/journey-app');
      expect(params.steps?.length).toBeGreaterThan(0);
    }
  });
});
