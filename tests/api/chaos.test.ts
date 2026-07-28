import { describe, expect, it } from 'vitest';
import {
  expectedCiStatusForScenario,
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
