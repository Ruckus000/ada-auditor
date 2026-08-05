import { describe, expect, it } from 'vitest';
import {
  BROWSER_CHAOS_SCENARIOS,
  expectedCiStatusForBrowserScenario,
  expectedCiStatusForScenario,
  resolveBrowserChaosRunParams,
  resolveChaosRunParams,
} from '../../src/app/api/_lib/chaos';

describe('chaos scenarios', () => {
  it('omit_ax_tree resolves to inconclusive inputs', async () => {
    const params = resolveChaosRunParams('omit_ax_tree');
    expect(params.omitAxTree).toBe(true);
    expect(expectedCiStatusForScenario('omit_ax_tree')).toBe('inconclusive');
  });

  it('complete_critical expects fail', () => {
    expect(expectedCiStatusForScenario('complete_critical')).toBe('fail');
  });

  it('complete_clean expects pass', () => {
    expect(expectedCiStatusForScenario('complete_clean')).toBe('pass');
  });
});

describe('browser chaos scenarios', () => {
  it('covers omit / critical / clean browser fixtures', () => {
    expect(BROWSER_CHAOS_SCENARIOS).toEqual([
      'browser_omit_ax_tree',
      'browser_complete_critical',
      'browser_complete_clean',
    ]);
  });

  it('browser_omit_ax_tree expects inconclusive and omits ax tree', () => {
    const params = resolveBrowserChaosRunParams('browser_omit_ax_tree');
    expect(params.omitAxTree).toBe(true);
    expect(params.browserMode).toBe(true);
    expect(expectedCiStatusForBrowserScenario('browser_omit_ax_tree')).toBe('inconclusive');
  });

  it('browser_complete_critical expects fail on default dashboard', () => {
    const params = resolveBrowserChaosRunParams('browser_complete_critical');
    expect(params.omitAxTree).toBeFalsy();
    expect(params.steps?.some((step) => step.type === 'goto' && step.path === 'dashboard-clean.html')).toBe(
      false,
    );
    expect(expectedCiStatusForBrowserScenario('browser_complete_critical')).toBe('fail');
  });

  it('browser_complete_clean navigates to the clean dashboard fixture', () => {
    const params = resolveBrowserChaosRunParams('browser_complete_clean');
    expect(params.steps?.some((step) => step.type === 'goto' && step.path === 'dashboard-clean.html')).toBe(
      true,
    );
    expect(expectedCiStatusForBrowserScenario('browser_complete_clean')).toBe('pass');
  });
});
