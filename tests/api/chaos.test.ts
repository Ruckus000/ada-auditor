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
  it('covers omit / critical / clean / pass-through / cap / hint fixtures', () => {
    expect(CHAOS_SCENARIOS).toEqual([
      'browser_omit_ax_tree',
      'browser_complete_critical',
      'browser_complete_clean',
      'browser_passthrough_violations',
      'browser_page_cap_truncates',
      'browser_hint_beats_markup',
    ]);
  });

  it('browser_page_cap_truncates asks for more pages than it allows', () => {
    // The cap is the one number in this system with no measurement behind it,
    // and the claim that matters is not its value: it is that a run the cap
    // cut short says so. A scenario whose journey fits under its own cap would
    // assert nothing.
    const params = resolveChaosRunParams('browser_page_cap_truncates');
    const paths = params.steps?.flatMap((step) => (step.type === 'goto' ? [step.path] : [])) ?? [];

    expect(params.maxPages).toBe(2);
    expect(paths.length).toBeGreaterThan(2);
    // Truncation must not be able to hide a finding on a page that *was*
    // audited, so the pages inside the cap are the ones carrying violations.
    expect(paths.slice(0, 2)).toEqual(['login.html', 'violations.html']);
    expect(expectedCiStatusForScenario('browser_page_cap_truncates')).toBe('fail');
  });

  it('browser_hint_beats_markup hints against what the markup says', () => {
    // A hint that agrees with the DOM proves nothing. The fixture declares
    // itself React (`data-reactroot`, which `reactAdapter.detect` matches) and
    // the hint says WordPress, so only the hint winning produces WordPress.
    const params = resolveChaosRunParams('browser_hint_beats_markup');
    const paths = params.steps?.flatMap((step) => (step.type === 'goto' ? [step.path] : [])) ?? [];

    expect(params.platformHint).toBe('wordpress');
    expect(paths).toEqual(['react-clean.html']);
    expect(expectedCiStatusForScenario('browser_hint_beats_markup')).toBe('pass');
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

  it('browser_complete_clean visits only pages that are themselves clean', () => {
    // The run audits every page it walks through, so a "clean" scenario whose
    // journey steps over `dashboard.html` (an image with no alt) would assert
    // nothing — it used to pass only because that page was discarded.
    const params = resolveChaosRunParams('browser_complete_clean');
    const paths = params.steps?.flatMap((step) => (step.type === 'goto' ? [step.path] : [])) ?? [];

    expect(paths).toEqual(['login.html', 'dashboard-clean.html']);
    expect(expectedCiStatusForScenario('browser_complete_clean')).toBe('pass');
  });

  it('browser_passthrough_violations walks past violations and ends clean', () => {
    // The steady-state claim multi-page scanning adds. Ending on a clean page
    // must not launder what the journey stepped over.
    const params = resolveChaosRunParams('browser_passthrough_violations');
    const paths = params.steps?.flatMap((step) => (step.type === 'goto' ? [step.path] : [])) ?? [];

    expect(paths).toEqual(['login.html', 'violations.html', 'dashboard-clean.html']);
    expect(paths[paths.length - 1]).toBe('dashboard-clean.html');
    expect(expectedCiStatusForScenario('browser_passthrough_violations')).toBe('fail');
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
