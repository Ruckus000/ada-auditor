import { describe, expect, it } from 'vitest';
import { runPageChecks, type PageFacts } from '../../src/services/page-checks';

/**
 * The checks axe structurally cannot make, over fabricated facts.
 *
 * Each positive case is a barrier the blind test planted and measured as
 * missed (A10, B3/C1, B9); each negative case is the adjacent CORRECT shape,
 * because the seven `clean` fixture rows are the standing cost ceiling — a
 * check that cannot stay quiet on the right implementation does not ship.
 */

const PAGE = 'https://town.example/services';

function facts(overrides: Partial<PageFacts> = {}): PageFacts {
  return { clickTargets: [], labelledControls: [], ...overrides };
}

const control = (over: Partial<PageFacts['labelledControls'][number]> = {}) => ({
  selector: '#field',
  labelText: null,
  ariaLabel: null,
  hasAriaLabelledby: false,
  placeholder: null,
  title: null,
  html: '<input id="field">',
  ...over,
});

describe('click-handler-not-focusable', () => {
  it('fires on a div with a click handler and no tabindex', () => {
    const findings = runPageChecks(
      facts({
        clickTargets: [
          { selector: '#tile', tag: 'div', role: null, tabindex: null, html: '<div onclick="go()">' },
        ],
      }),
      PAGE,
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: 'click-handler-not-focusable',
      wcagCriteria: ['2.1.1'],
      conformanceLevel: 'A',
      severity: 'major',
      source: 'deterministic',
      pageUrl: PAGE,
      selector: '#tile',
    });
  });

  it('stays quiet when a tabindex exists — a wrong one is a different, axe-visible defect', () => {
    const findings = runPageChecks(
      facts({
        clickTargets: [
          { selector: '#tile', tag: 'div', role: 'button', tabindex: '0', html: '<div>' },
        ],
      }),
      PAGE,
    );

    expect(findings).toEqual([]);
  });
});

describe('placeholder-as-only-label', () => {
  it('fires when the placeholder is the only name', () => {
    const findings = runPageChecks(
      facts({ labelledControls: [control({ placeholder: 'Preferred date' })] }),
      PAGE,
    );

    expect(findings.map((f) => f.code)).toEqual(['placeholder-as-only-label']);
    expect(findings[0]).toMatchObject({ wcagCriteria: ['3.3.2'], conformanceLevel: 'A' });
  });

  it.each([
    ['a visible label', control({ placeholder: 'Preferred date', labelText: 'Date' })],
    ['an aria-label', control({ placeholder: 'Preferred date', ariaLabel: 'Date' })],
    ['aria-labelledby', control({ placeholder: 'Preferred date', hasAriaLabelledby: true })],
    ['a title', control({ placeholder: 'Preferred date', title: 'Date' })],
  ])('stays quiet when %s names the field beside the placeholder', (_case, fact) => {
    // C13's exact shape is the first case: a labelled field whose
    // INSTRUCTIONS live in the placeholder is a judgement call, not this
    // check, and firing on it would also fire on every correctly built field
    // that uses a placeholder as an example value.
    expect(runPageChecks(facts({ labelledControls: [fact] }), PAGE)).toEqual([]);
  });

  it('treats a whitespace placeholder as no placeholder', () => {
    expect(
      runPageChecks(facts({ labelledControls: [control({ placeholder: '   ' })] }), PAGE),
    ).toEqual([]);
  });

  it('stays quiet on a bare unlabelled field with no placeholder — axe already owns that', () => {
    expect(runPageChecks(facts({ labelledControls: [control()] }), PAGE)).toEqual([]);
  });
});

describe('visible-label-not-in-name', () => {
  it('fires when the aria-label does not contain the visible label', () => {
    const findings = runPageChecks(
      facts({
        labelledControls: [control({ labelText: 'Email address', ariaLabel: 'Contact' })],
      }),
      PAGE,
    );

    expect(findings.map((f) => f.code)).toEqual(['visible-label-not-in-name']);
    expect(findings[0]).toMatchObject({ wcagCriteria: ['2.5.3'], conformanceLevel: 'AA' });
    // The message quotes both names — that is what makes it actionable, and
    // findings (unlike logs) are allowed to carry page content.
    expect(findings[0].message).toContain('Email address');
    expect(findings[0].message).toContain('Contact');
  });

  it('stays quiet when the accessible name starts with the visible label', () => {
    const findings = runPageChecks(
      facts({
        labelledControls: [
          control({ labelText: 'Email address', ariaLabel: 'Email address for contact' }),
        ],
      }),
      PAGE,
    );

    expect(findings).toEqual([]);
  });

  it('compares case-insensitively', () => {
    const findings = runPageChecks(
      facts({
        labelledControls: [control({ labelText: 'Email Address', ariaLabel: 'email address' })],
      }),
      PAGE,
    );

    expect(findings).toEqual([]);
  });

  it('stays quiet with no aria-label — the visible label simply is the name', () => {
    expect(
      runPageChecks(facts({ labelledControls: [control({ labelText: 'Email address' })] }), PAGE),
    ).toEqual([]);
  });
});
