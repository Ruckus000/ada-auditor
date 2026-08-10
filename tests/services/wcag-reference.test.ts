import { describe, expect, it } from 'vitest';
import {
  describeCriterion,
  lookupCriterion,
  normaliseCriterion,
  summariseCriteria,
} from '../../src/services/wcag-reference';

describe('normaliseCriterion', () => {
  it.each([
    ['1.1.1', '1.1.1'],
    ['wcag111', '1.1.1'],
    ['WCAG 1.4.3', '1.4.3'],
    ['wcag1410', '1.4.10'],
    ['wcag2411', '2.4.11'],
  ])('reads %j as %j', (raw, expected) => {
    // axe tags criteria as `wcag111`; a stored finding may carry either form.
    // A lookup that understood only one would render every criterion as a
    // bare number and nobody would notice which.
    expect(normaliseCriterion(raw)).toBe(expected);
  });

  it.each(['', 'best-practice', 'section508', 'wcag2a', '1.1'])('rejects %j', (raw) => {
    expect(normaliseCriterion(raw)).toBeNull();
  });
});

describe('lookupCriterion', () => {
  it('names a criterion and its level', () => {
    expect(lookupCriterion('1.4.3')).toEqual({
      number: '1.4.3',
      name: 'Contrast (Minimum)',
      level: 'AA',
    });
  });

  it('knows the 2.2 additions', () => {
    // 2.2 is the standard this product audits to, so its new criteria have to
    // be here — otherwise a finding against one renders as a bare number on
    // the page a client's legal team reads.
    expect(lookupCriterion('2.4.11')?.name).toBe('Focus Not Obscured (Minimum)');
    expect(lookupCriterion('2.5.8')?.name).toBe('Target Size (Minimum)');
    expect(lookupCriterion('3.3.8')?.name).toBe('Accessible Authentication (Minimum)');
  });

  it('does not claim a AAA criterion', () => {
    // This product audits to AA. Naming a AAA criterion would imply a claim it
    // does not make.
    expect(lookupCriterion('1.4.6')).toBeNull();
    expect(lookupCriterion('2.4.9')).toBeNull();
  });

  it('is null for anything it does not know', () => {
    expect(lookupCriterion('9.9.9')).toBeNull();
    expect(lookupCriterion('best-practice')).toBeNull();
  });
});

describe('describeCriterion', () => {
  it('reads as prose', () => {
    expect(describeCriterion('wcag111')).toBe('1.1.1 Non-text Content (A)');
  });

  it('falls back to the raw value rather than inventing a name', () => {
    // A wrong criterion name in an audit report is worse than an unfamiliar
    // number, because the number is checkable.
    expect(describeCriterion('best-practice')).toBe('best-practice');
    expect(describeCriterion('9.9.9')).toBe('9.9.9');
  });
});

describe('summariseCriteria', () => {
  it('deduplicates and sorts numerically', () => {
    // 1.4.10 comes after 1.4.5. A lexical sort puts it before, which reads as
    // a typo in a document somebody may have to defend.
    const summary = summariseCriteria(['1.4.10', 'wcag143', '1.4.3', '1.1.1', '1.4.5']);

    expect(summary.map((c) => c.number)).toEqual(['1.1.1', '1.4.3', '1.4.5', '1.4.10']);
  });

  it('drops what it cannot name', () => {
    expect(summariseCriteria(['best-practice', 'wcag2a']).length).toBe(0);
  });
});
