import { describe, expect, it } from 'vitest';

import {
  conformanceLine,
  scopeLine,
  SCOPE_EXPLAINER,
} from '../../src/services/presentation/document-verdict';
import { CHECKED_CRITERIA, NOT_CHECKED_CRITERIA } from '../../src/domain/document-remediation';

const scoped = { scope: { criteria: [...CHECKED_CRITERIA] } };

describe('conformanceLine', () => {
  it('says compliant when the checker did', () => {
    expect(conformanceLine({ conformance: { checker: 'verapdf-ua1', compliant: true } }))
      .toBe('PDF/UA: compliant (veraPDF)');
  });

  it('counts the failing checks', () => {
    expect(
      conformanceLine({
        conformance: { checker: 'verapdf-ua1', compliant: false, failingClauses: ['5-1', '7.3-1'] },
      }),
    ).toBe('PDF/UA: 2 checks failing (veraPDF)');
  });

  it('reads a missing verdict exactly as an unavailable one — never as clean', () => {
    // The rule three modules assert: a reading without a verdict must not look
    // like a passing one. Absence and `checker: 'none'` are the same sentence.
    const absent = conformanceLine({});
    const unavailable = conformanceLine({ conformance: { checker: 'none', reason: 'unavailable' } });

    expect(absent).toBe(unavailable);
    expect(absent).toContain('not checked');
    expect(absent).not.toContain('compliant');
  });
});

describe('scopeLine', () => {
  it('names what was checked and what was not', () => {
    const line = scopeLine(scoped);

    for (const criterion of CHECKED_CRITERIA) expect(line).toContain(criterion);
    for (const criterion of NOT_CHECKED_CRITERIA) {
      expect(line).toContain(criterion.number);
      expect(line).toContain(criterion.name);
    }
  });

  it('states the human-judgement ceiling beside the machine result', () => {
    // A document that passes every machine check has passed the
    // machine-checkable share only, and "compliant" without this reads as more
    // than veraPDF can support.
    expect(scopeLine(scoped)).toContain(SCOPE_EXPLAINER);
    expect(SCOPE_EXPLAINER).toContain('47');
    expect(SCOPE_EXPLAINER).toContain('136');
  });

  it('says the scope was NOT RECORDED when a reading predates the field', () => {
    // Never silence, and never full coverage. Readings stored before the field
    // existed cannot say what they looked for.
    const line = scopeLine({});

    expect(line).toContain('not recorded');
    // Still names what nothing here ever checks, so an old entry is not read as
    // broader than a new one.
    for (const criterion of NOT_CHECKED_CRITERIA) expect(line).toContain(criterion.number);
  });

  it('never claims a criterion it does not check', () => {
    const line = scopeLine(scoped);
    const checkedPart = line.slice(0, line.indexOf('Not checked'));

    for (const criterion of NOT_CHECKED_CRITERIA) {
      expect(checkedPart, `${criterion.number} appears as checked`).not.toContain(criterion.number);
    }
  });
});
