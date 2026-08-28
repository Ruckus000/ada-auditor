import { describe, expect, it } from 'vitest';
import {
  runHtmlcsAudit,
  type HtmlcsMessage,
  type HtmlcsScanResult,
} from '../../src/services/htmlcs-audit';

const PAGE = 'https://town.example/services';

function message(over: Partial<HtmlcsMessage> = {}): HtmlcsMessage {
  return {
    level: 'error',
    code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.H37',
    message:
      'Img element missing an alt attribute. Use the alt attribute to specify a short text alternative.',
    selector: 'body > img:nth-of-type(2)',
    htmlSnippet: '<img src="logo.png">',
    axeCriteria: [],
    ...over,
  };
}

function ok(messages: HtmlcsMessage[]): HtmlcsScanResult {
  return { status: 'ok', messages };
}

describe('runHtmlcsAudit', () => {
  it('maps an error to a needs-review finding with parsed criterion and level', () => {
    const findings = runHtmlcsAudit(ok([message()]), PAGE);

    expect(findings).toHaveLength(1);
    const found = findings[0];
    expect(found.code).toBe('htmlcs:1_1_1.H37');
    expect(found.severity).toBe('needs-review');
    expect(found.source).toBe('deterministic');
    expect(found.wcagCriteria).toEqual(['1.1.1']);
    expect(found.conformanceLevel).toBe('A');
    expect(found.pageUrl).toBe(PAGE);
    expect(found.selector).toBe('body > img:nth-of-type(2)');
    expect(found.title).toBe('Img element missing an alt attribute.');
    expect(found.helpUrl).toBe('https://www.w3.org/WAI/WCAG21/Techniques/html/H37');
  });

  it('emits needs-review for every level — the no-gating invariant', () => {
    const findings = runHtmlcsAudit(
      ok([
        message({ level: 'error' }),
        message({ level: 'warning', selector: '#other' }),
        message({ level: 'notice', selector: '#third' }),
      ]),
      PAGE,
    );

    expect(findings.length).toBeGreaterThan(0);
    for (const found of findings) {
      expect(found.severity).toBe('needs-review');
    }
  });

  it('parses an AA criterion to conformance level AA', () => {
    const findings = runHtmlcsAudit(
      ok([
        message({
          code: 'WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail',
          selector: '#low-contrast',
        }),
      ]),
      PAGE,
    );

    expect(findings[0].code).toBe('htmlcs:1_4_3.G18.Fail');
    expect(findings[0].wcagCriteria).toEqual(['1.4.3']);
    expect(findings[0].conformanceLevel).toBe('AA');
    expect(findings[0].helpUrl).toBe('https://www.w3.org/WAI/WCAG21/Techniques/general/G18');
  });

  it('parses a criterion segment carrying a level suffix', () => {
    // Some sniffs write the level into the criterion segment: `1_3_1_A.G141`.
    const findings = runHtmlcsAudit(
      ok([message({ code: 'WCAG2AA.Principle1.Guideline1_3.1_3_1_A.G141', selector: '#h4' })]),
      PAGE,
    );

    expect(findings[0].code).toBe('htmlcs:1_3_1_A.G141');
    expect(findings[0].wcagCriteria).toEqual(['1.3.1']);
    expect(findings[0].conformanceLevel).toBe('A');
    expect(findings[0].helpUrl).toBe('https://www.w3.org/WAI/WCAG21/Techniques/general/G141');
  });

  it('keeps a code it cannot parse, with no criterion claimed', () => {
    const findings = runHtmlcsAudit(
      ok([message({ code: 'Section508.L.NoCriterionHere' })]),
      PAGE,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe('htmlcs:Section508.L.NoCriterionHere');
    expect(findings[0].wcagCriteria).toEqual([]);
    expect(findings[0].conformanceLevel).toBeNull();
    expect(findings[0].helpUrl).toBe('https://www.w3.org/WAI/WCAG21/Techniques/');
  });

  describe('overlap suppression', () => {
    it('drops an error axe already reported on the same element and criterion', () => {
      // `axeCriteria` is established in the page by element identity — the
      // scan resolved axe's selectors back to nodes. Here it just has to be
      // believed.
      const findings = runHtmlcsAudit(ok([message({ axeCriteria: ['1.1.1'] })]), PAGE);
      expect(findings).toEqual([]);
    });

    it('keeps the error when axe covered the element for a different criterion', () => {
      const findings = runHtmlcsAudit(ok([message({ axeCriteria: ['1.4.3'] })]), PAGE);
      expect(findings).toHaveLength(1);
    });

    it('keeps the error when axe did not cover the element at all', () => {
      const findings = runHtmlcsAudit(ok([message({ axeCriteria: [] })]), PAGE);
      expect(findings).toHaveLength(1);
    });

    it('keeps a message with no parseable criterion even when axe covered the element', () => {
      // No criterion means no basis for calling it the same defect.
      const findings = runHtmlcsAudit(
        ok([message({ code: 'Section508.L.NoCriterionHere', axeCriteria: ['1.1.1'] })]),
        PAGE,
      );
      expect(findings).toHaveLength(1);
    });
  });

  describe('notice collapse', () => {
    it('collapses many notices for one technique into a single counted finding', () => {
      const notices = Array.from({ length: 200 }, (unused, index) =>
        message({
          level: 'notice' as const,
          code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.G94.Image',
          message: 'Ensure that the img element’s alt text serves the same purpose.',
          selector: `body > img:nth-of-type(${index + 1})`,
        }),
      );

      const findings = runHtmlcsAudit(ok(notices), PAGE);

      expect(findings).toHaveLength(1);
      expect(findings[0].code).toBe('htmlcs:notice:1_1_1.G94.Image');
      expect(findings[0].message).toContain('200 elements to review');
      expect(findings[0].selector).toBe('');
      expect(findings[0].htmlSnippet).toBe('');
    });

    it('keeps distinct techniques as distinct collapsed findings', () => {
      const findings = runHtmlcsAudit(
        ok([
          message({ level: 'notice', code: 'WCAG2AA.Principle1.Guideline1_1.1_1_1.G94.Image' }),
          message({ level: 'notice', code: 'WCAG2AA.Principle2.Guideline2_4.2_4_4.H77' }),
        ]),
        PAGE,
      );

      expect(findings.map((found) => found.code).sort()).toEqual([
        'htmlcs:notice:1_1_1.G94.Image',
        'htmlcs:notice:2_4_4.H77',
      ]);
      expect(findings.every((found) => found.message.includes('1 element to review'))).toBe(true);
    });

    it('does not suppress notices on axe-covered elements — they are counts, not echoes', () => {
      const findings = runHtmlcsAudit(
        ok([message({ level: 'notice', axeCriteria: ['1.1.1'] })]),
        PAGE,
      );
      expect(findings).toHaveLength(1);
    });
  });

  it('produces nothing when the scan was unavailable', () => {
    expect(runHtmlcsAudit({ status: 'unavailable' }, PAGE)).toEqual([]);
  });

  it('bounds the stored snippet', () => {
    const findings = runHtmlcsAudit(
      ok([message({ htmlSnippet: `<div>${'x'.repeat(2000)}</div>` })]),
      PAGE,
    );
    expect(findings[0].htmlSnippet.length).toBeLessThanOrEqual(512);
  });
});
