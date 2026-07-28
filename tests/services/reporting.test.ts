import { describe, expect, it } from 'vitest';
import { summarizeRun } from '../../src/services/reporting';

describe('summarizeRun', () => {
  it('fails CI when deterministic critical findings are present with complete evidence', () => {
    const report = summarizeRun({
      findings: [
        {
          code: 'missing-image-alt',
          severity: 'critical',
          source: 'deterministic',
          message: 'Image is missing alt text.',
        },
        {
          code: 'ai-advisory',
          severity: 'advisory',
          source: 'ai-advisory',
          gateable: false,
          message: 'Form instructions are ambiguous.',
          confidence: 0.84,
        },
      ],
      evidenceStatus: 'complete',
    });

    expect(report.ciStatus).toBe('fail');
    expect(report.executiveSummary.blockingFindings).toBe(1);
  });

  it('passes CI when evidence is complete and there are no blocking findings', () => {
    const report = summarizeRun({
      findings: [],
      evidenceStatus: 'complete',
    });

    expect(report.ciStatus).toBe('pass');
    expect(report.executionStatus).toBe('complete');
  });

  it('marks degraded evidence as inconclusive rather than pass', () => {
    const report = summarizeRun({
      findings: [],
      evidenceStatus: 'degraded',
    });

    expect(report.ciStatus).toBe('inconclusive');
    expect(report.executionStatus).toBe('degraded');
    expect(report.executiveSummary.blockingFindings).toBe(0);
  });

  it('does not fail CI on critical findings when evidence is degraded', () => {
    const report = summarizeRun({
      findings: [
        {
          code: 'missing-image-alt',
          severity: 'critical',
          source: 'deterministic',
          message: 'Image is missing alt text.',
        },
      ],
      evidenceStatus: 'degraded',
    });

    expect(report.ciStatus).toBe('inconclusive');
    expect(report.executiveSummary.blockingFindings).toBe(0);
  });
});
