import { describe, expect, it } from 'vitest';
import { summarizeRun } from '../../src/services/reporting';
import type { DeterministicFinding } from '../../src/services/deterministic-audit';

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
          remediation: { anyOf: ['Element does not have an alt attribute'], allOf: [] },
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

  /**
   * What decides "does not conform" is the success criterion, not axe's impact.
   *
   * axe impact is Deque's operational triage; WCAG conformance is binary per
   * criterion. Gating on impact crossed the two, and measurably: of axe-core
   * 4.12.1's 105 rules, 30 are best-practice and map to no criterion at all,
   * while a real Level AA failure rated `moderate` never gated. The first real
   * client audit returned 86 findings, none `critical`, and read `pass`.
   */
  describe('the conformance gate', () => {
    function deterministic(
      overrides: Partial<DeterministicFinding> = {},
    ): DeterministicFinding {
      return {
        code: 'color-contrast',
        severity: 'major',
        source: 'deterministic',
        title: 'Elements must meet minimum colour contrast ratio thresholds',
        message: 'Element has insufficient colour contrast',
        remediation: { anyOf: [], allOf: [] },
        wcagCriteria: ['1.4.3'],
        conformanceLevel: 'AA',
        pageUrl: 'https://client.example.com/',
        selector: '#cta',
        htmlSnippet: '<a class="cta">Donate</a>',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/color-contrast',
        ...overrides,
      };
    }

    it('fails on an unmet AA criterion even when nothing is rated critical', () => {
      // dsrfund.org's run, reduced: real failures against real criteria, none
      // of which axe happens to call `critical`.
      const report = summarizeRun({
        findings: [deterministic()],
        evidenceStatus: 'complete',
      });

      expect(report.ciStatus).toBe('fail');
      expect(report.executiveSummary.blockingFindings).toBe(1);
    });

    it('does not fail on a best-practice rule, however axe rates it', () => {
      // 30 of 105 rules map to no success criterion. A `critical` one gated
      // before this change, which asserted non-conformance on the strength of
      // a recommendation.
      const report = summarizeRun({
        findings: [deterministic({ severity: 'critical', conformanceLevel: null, wcagCriteria: [] })],
        evidenceStatus: 'complete',
      });

      expect(report.ciStatus).toBe('pass');
      expect(report.executiveSummary.blockingFindings).toBe(0);
    });

    it('does not fail on a check axe could not decide', () => {
      // The sharp edge. `runDeterministicAudit` maps axe's `incomplete` results
      // to `needs-review` through the same mapper, so they carry a conformance
      // level like any other finding — and turning the human review queue into
      // conformance failures would invert the rule that produced them.
      const report = summarizeRun({
        findings: [deterministic({ severity: 'needs-review' })],
        evidenceStatus: 'complete',
      });

      expect(report.ciStatus).toBe('pass');
      expect(report.executiveSummary.blockingFindings).toBe(0);
    });

    it('does not fail a run whose only findings are HTMLCS second opinions', () => {
      // `runHtmlcsAudit` emits everything — errors included — at
      // `needs-review`, which is the no-gating decision made structural. This
      // pins it from the gate's side: an `htmlcs:` finding with an A-level
      // criterion still cannot reach `fail`.
      const report = summarizeRun({
        findings: [
          deterministic({
            code: 'htmlcs:1_1_1.H37',
            severity: 'needs-review',
            conformanceLevel: 'A',
            wcagCriteria: ['1.1.1'],
          }),
        ],
        evidenceStatus: 'complete',
      });

      expect(report.ciStatus).toBe('pass');
      expect(report.executiveSummary.blockingFindings).toBe(0);
    });

    it('does not fail on AAA, which is not the ADA bar', () => {
      const report = summarizeRun({
        findings: [deterministic({ conformanceLevel: 'AAA', wcagCriteria: ['1.4.6'] })],
        evidenceStatus: 'complete',
      });

      expect(report.ciStatus).toBe('pass');
    });

    it('does not fail on an advisory finding', () => {
      // Unchanged rule, kept under the new axis: a model's judgement is not a
      // proof, and `gateable: false` is the steady-state contract.
      //
      // The stronger case — an advisory finding *citing* a criterion — is not
      // written here because the type forbids it: `AiAdvisoryFinding` has no
      // `conformanceLevel`, so an advisory can never reach the level check at
      // all. The `source` test in `failsConformance` is the runtime half of a
      // guarantee the compiler already makes.
      const report = summarizeRun({
        findings: [
          {
            code: 'ai-advisory',
            severity: 'advisory',
            source: 'ai-advisory',
            gateable: false,
            message: 'Form instructions are ambiguous.',
            confidence: 0.9,
          },
        ],
        evidenceStatus: 'complete',
      });

      expect(report.ciStatus).toBe('pass');
    });

    it('is still inconclusive rather than fail when evidence is incomplete', () => {
      // Steady-state rule, and the new axis must not reach past it: an unmet
      // criterion observed through evidence we cannot stand behind is not a
      // conformance judgement.
      const report = summarizeRun({
        findings: [deterministic()],
        evidenceStatus: 'degraded',
      });

      expect(report.ciStatus).toBe('inconclusive');
      expect(report.executiveSummary.blockingFindings).toBe(0);
    });
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
          remediation: { anyOf: ['Element does not have an alt attribute'], allOf: [] },
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
