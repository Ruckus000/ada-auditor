import { describe, expect, it } from 'vitest';
import {
  conformanceLevelFromTags,
  runDeterministicAudit,
  selectorFromTarget,
  wcagCriteriaFromTags,
  type AxeScanResult,
} from '../../src/services/deterministic-audit';

/**
 * Tag fixtures below are copied from real axe-core 4.12 rule metadata
 * (`axe.getRules()`), not invented — the parsing edge cases they cover
 * (`wcag2a-obsolete`, two-digit criteria like `wcag1412`) only exist because
 * axe actually emits them.
 */

const PAGE_URL = 'https://app.example.com/dashboard';

function rule(overrides: Partial<AxeScanResult['violations'][number]> = {}) {
  return {
    id: 'image-alt',
    impact: 'critical' as const,
    tags: ['cat.text-alternatives', 'wcag2a', 'wcag111', 'section508'],
    help: 'Images must have alternate text',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
    nodes: [{ html: '<img src="hero.png">', target: ['#hero'] }],
    ...overrides,
  };
}

describe('wcagCriteriaFromTags', () => {
  it('extracts single-digit criteria', () => {
    expect(wcagCriteriaFromTags(['cat.color', 'wcag2aa', 'wcag143'])).toEqual(['1.4.3']);
  });

  it('extracts two-digit criteria', () => {
    expect(wcagCriteriaFromTags(['wcag2aa', 'wcag1412'])).toEqual(['1.4.12']);
  });

  it('extracts several criteria and sorts them', () => {
    // link-name maps to both 2.4.4 and 4.1.2 in real axe metadata.
    expect(wcagCriteriaFromTags(['wcag2a', 'wcag412', 'wcag244'])).toEqual(['2.4.4', '4.1.2']);
  });

  it('returns nothing for best-practice rules', () => {
    // heading-order and region carry no wcag tags at all.
    expect(wcagCriteriaFromTags(['cat.semantics', 'best-practice'])).toEqual([]);
  });

  it('does not mistake a level tag for a criterion', () => {
    expect(wcagCriteriaFromTags(['wcag2a', 'wcag2aa', 'wcag21aa'])).toEqual([]);
  });
});

describe('conformanceLevelFromTags', () => {
  it('reads the level', () => {
    expect(conformanceLevelFromTags(['wcag2a', 'wcag111'])).toBe('A');
    expect(conformanceLevelFromTags(['wcag2aa', 'wcag143'])).toBe('AA');
    expect(conformanceLevelFromTags(['wcag22aa', 'wcag258'])).toBe('AA');
  });

  it('reports the strictest level when a rule maps to several', () => {
    expect(conformanceLevelFromTags(['wcag2aa', 'wcag2a'])).toBe('A');
  });

  it('ignores the obsolete-marker tag', () => {
    // `wcag2a-obsolete` is a real tag; the hyphen must not parse as level A.
    expect(conformanceLevelFromTags(['cat.parsing', 'wcag2a-obsolete'])).toBeNull();
  });

  it('does not mistake a criterion tag for a level', () => {
    expect(conformanceLevelFromTags(['wcag111', 'wcag1412'])).toBeNull();
  });

  it('returns null for best-practice rules', () => {
    expect(conformanceLevelFromTags(['cat.semantics', 'best-practice'])).toBeNull();
  });
});

describe('selectorFromTarget', () => {
  it('passes a simple selector through', () => {
    expect(selectorFromTarget(['#hero'])).toBe('#hero');
  });

  it('joins frame-nested selectors readably', () => {
    expect(selectorFromTarget([['#frame', '#inner'], 'img'])).toBe('#frame #inner >>> img');
  });
});

describe('runDeterministicAudit', () => {
  it('stamps every finding with the page it was found on', () => {
    // A run audits every page its journey walks through, so a finding that
    // cannot say where it lives is not actionable — and the regression diff
    // would collapse the same rule and selector on two pages into one entry.
    const findings = runDeterministicAudit(
      { violations: [rule()], incomplete: [rule({ id: 'color-contrast' })] },
      'https://app.example.com/checkout',
    );

    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.pageUrl === 'https://app.example.com/checkout')).toBe(true);
  });

  it('keeps two pages apart when they break the same rule on the same selector', () => {
    const scan = { violations: [rule()], incomplete: [] };

    const [first] = runDeterministicAudit(scan, 'https://app.example.com/a');
    const [second] = runDeterministicAudit(scan, 'https://app.example.com/b');

    expect(first.selector).toBe(second.selector);
    expect(first.pageUrl).not.toBe(second.pageUrl);
  });

  it('emits one finding per node, not one per rule', () => {
    const findings = runDeterministicAudit({
      violations: [
        rule({
          nodes: [
            { html: '<img src="a.png">', target: ['#a'] },
            { html: '<img src="b.png">', target: ['#b'] },
            { html: '<img src="c.png">', target: ['#c'] },
          ],
        }),
      ],
      incomplete: [],
    }, PAGE_URL);

    // The old regex engine returned exactly one finding here regardless of
    // how many images were broken, which made it unactionable.
    expect(findings).toHaveLength(3);
    expect(findings.map((f) => f.selector)).toEqual(['#a', '#b', '#c']);
  });

  it('carries the fields needed to locate and cite a failure', () => {
    const [finding] = runDeterministicAudit({ violations: [rule()], incomplete: [] }, PAGE_URL);

    expect(finding).toMatchObject({
      code: 'image-alt',
      severity: 'critical',
      source: 'deterministic',
      wcagCriteria: ['1.1.1'],
      conformanceLevel: 'A',
      selector: '#hero',
      htmlSnippet: '<img src="hero.png">',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
    });
  });

  it('maps axe impact onto the existing severity scale', () => {
    const impacts = ['critical', 'serious', 'moderate', 'minor'] as const;
    const severities = impacts.map(
      (impact) =>
        runDeterministicAudit({ violations: [rule({ impact })], incomplete: [] }, PAGE_URL)[0].severity,
    );

    expect(severities).toEqual(['critical', 'major', 'minor', 'minor']);
  });

  it('keeps serious findings out of the CI-blocking set', () => {
    // color-contrast is `serious` and extremely common. Mapping it to `major`
    // preserves the steady-state rule that only `critical` fails a run.
    const [finding] = runDeterministicAudit({
      violations: [
        rule({ id: 'color-contrast', impact: 'serious', tags: ['cat.color', 'wcag2aa', 'wcag143'] }),
      ],
      incomplete: [],
    }, PAGE_URL);

    expect(finding.severity).not.toBe('critical');
  });

  it('reports incomplete results as needs-review rather than failures', () => {
    const findings = runDeterministicAudit({
      violations: [],
      incomplete: [rule({ id: 'color-contrast', impact: 'serious' })],
    }, PAGE_URL);

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('needs-review');
  });

  it('prefers the node failure summary over the generic rule help', () => {
    const [finding] = runDeterministicAudit({
      violations: [
        rule({
          nodes: [
            {
              html: '<img>',
              target: ['#a'],
              failureSummary: 'Fix any of the following:\n  Element has no alt attribute',
            },
          ],
        }),
      ],
      incomplete: [],
    }, PAGE_URL);

    expect(finding.message).toContain('no alt attribute');
  });

  it("keeps the rule's own sentence as the title, beside the node's failure", () => {
    // These are two different things and the finding needs both: the title
    // says what the rule checks, the message says what went wrong with this
    // node. `help` used to be reachable only as a fallback inside `message`,
    // so the readable half disappeared exactly when the technical half was
    // longest.
    const [finding] = runDeterministicAudit({
      violations: [
        rule({
          nodes: [
            {
              html: '<img>',
              target: ['#a'],
              failureSummary: 'Fix any of the following:\n  Element has no alt attribute',
            },
          ],
        }),
      ],
      incomplete: [],
    }, PAGE_URL);

    expect(finding.title).toBe('Images must have alternate text');
    expect(finding.message).toContain('no alt attribute');
  });

  it('falls back to rule help when the summary is blank', () => {
    const [finding] = runDeterministicAudit({
      violations: [rule({ nodes: [{ html: '<img>', target: ['#a'], failureSummary: '   ' }] })],
      incomplete: [],
    }, PAGE_URL);

    expect(finding.message).toBe('Images must have alternate text');
  });

  it('truncates oversized snippets so one node cannot bloat a run record', () => {
    const [finding] = runDeterministicAudit({
      violations: [rule({ nodes: [{ html: `<div>${'x'.repeat(5000)}</div>`, target: ['#a'] }] })],
      incomplete: [],
    }, PAGE_URL);

    expect(finding.htmlSnippet.length).toBeLessThanOrEqual(513);
    expect(finding.htmlSnippet.endsWith('…')).toBe(true);
  });

  it('handles best-practice rules that map to no criterion', () => {
    const [finding] = runDeterministicAudit({
      violations: [
        rule({ id: 'region', impact: 'moderate', tags: ['cat.keyboard', 'best-practice'] }),
      ],
      incomplete: [],
    }, PAGE_URL);

    expect(finding.wcagCriteria).toEqual([]);
    expect(finding.conformanceLevel).toBeNull();
  });

  it('returns nothing for a clean scan', () => {
    expect(runDeterministicAudit({ violations: [], incomplete: [] }, PAGE_URL)).toEqual([]);
  });

  it('treats a missing impact as minor rather than throwing', () => {
    const [finding] = runDeterministicAudit({
      violations: [rule({ impact: null })],
      incomplete: [],
    }, PAGE_URL);

    expect(finding.severity).toBe('minor');
  });
});
