import { describe, expect, it } from 'vitest';
import { summarizeRun } from '../../src/services/reporting';

describe('summarizeRun', () => {
  it('fails CI when deterministic critical findings are present with complete evidence', () => {
    const report = summarizeRun({
      findings: [
        {
          code: 'image-alt',
          severity: 'critical',
          source: 'deterministic',
          title: 'Images must have alternate text',
          message: 'Element does not have an alt attribute',
          wcagCriteria: ['1.1.1'],
          conformanceLevel: 'A',
          pageUrl: 'https://app.example.com/dashboard',
          selector: '#hero',
          htmlSnippet: '<img src="hero.png">',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
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

  it('reports how many pages the run covered', () => {
    // A page with nothing wrong on it still counts as audited, so this cannot
    // be inferred from the findings.
    const report = summarizeRun({
      findings: [],
      evidenceStatus: 'complete',
      pagesScanned: 4,
    });

    expect(report.executiveSummary.pagesScanned).toBe(4);
    expect(report.executiveSummary.pagesTruncated).toBe(0);
  });

  it('says when the page cap cut the journey short', () => {
    // A silent cap reads as "we audited everything" when we did not.
    const report = summarizeRun({
      findings: [],
      evidenceStatus: 'complete',
      pagesScanned: 20,
      pagesTruncated: 3,
    });

    expect(report.executiveSummary.pagesScanned).toBe(20);
    expect(report.executiveSummary.pagesTruncated).toBe(3);
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
          code: 'image-alt',
          severity: 'critical',
          source: 'deterministic',
          title: 'Images must have alternate text',
          message: 'Element does not have an alt attribute',
          wcagCriteria: ['1.1.1'],
          conformanceLevel: 'A',
          pageUrl: 'https://app.example.com/dashboard',
          selector: '#hero',
          htmlSnippet: '<img src="hero.png">',
          helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
        },
      ],
      evidenceStatus: 'degraded',
    });

    expect(report.ciStatus).toBe('inconclusive');
    expect(report.executiveSummary.blockingFindings).toBe(0);
  });
});
