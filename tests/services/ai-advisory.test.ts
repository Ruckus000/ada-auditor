import { describe, expect, it } from 'vitest';
import { createAiAdvisoryFinding } from '../../src/services/ai-advisory';

describe('createAiAdvisoryFinding', () => {
  it('never produces a gateable finding', () => {
    const finding = createAiAdvisoryFinding({
      message: 'Form instructions are ambiguous for screen reader users.',
      confidence: 0.84,
    });

    expect(finding.source).toBe('ai-advisory');
    expect(finding.gateable).toBe(false);
  });
});
