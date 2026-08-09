import { describe, expect, it } from 'vitest';
import {
  countsTowardScore,
  displaySeverity,
  findingDisplayStatus,
} from '../../src/services/presentation/severity';

describe('displaySeverity', () => {
  it.each([
    ['critical', 'must'],
    ['major', 'should'],
    ['minor', 'nice'],
    ['needs-review', 'review'],
    ['advisory', 'advisory'],
  ])('maps %s to %s', (engine, display) => {
    expect(displaySeverity(engine)).toBe(display);
  });

  it('keeps needs-review out of the low-priority bucket', () => {
    // The prototype collapsed five severities into three, which put the human
    // review worklist into `nice` — a bucket nobody works. That queue is the
    // entire point of axe's `incomplete` results.
    expect(displaySeverity('needs-review')).not.toBe('nice');
  });

  it('sends an unrecognised severity to review rather than to nice', () => {
    // A finding we cannot categorise needs a human. Filing it as low-priority
    // is how it never gets looked at.
    expect(displaySeverity('some-future-severity')).toBe('review');
  });
});

describe('countsTowardScore', () => {
  it('excludes review and advisory', () => {
    // Neither is a proven failure: one is undecided, the other is a judgement
    // that never gates. Counting either against a score would contradict what
    // the product tells clients about both.
    expect(countsTowardScore('review')).toBe(false);
    expect(countsTowardScore('advisory')).toBe(false);
  });

  it('includes the three proven severities', () => {
    expect(countsTowardScore('must')).toBe(true);
    expect(countsTowardScore('should')).toBe(true);
    expect(countsTowardScore('nice')).toBe(true);
  });
});

describe('findingDisplayStatus', () => {
  it('shows an untriaged finding present in both runs as open', () => {
    expect(
      findingDisplayStatus({ inLatestRun: true, inBaseline: true, triage: null }),
    ).toBe('Open');
  });

  it('derives fixed from absence, not from a stored flag', () => {
    // A finding is fixed when the next run stops reporting it. Storing that as
    // human state lets the flag and the evidence disagree.
    expect(
      findingDisplayStatus({ inLatestRun: false, inBaseline: true, triage: null }),
    ).toBe('Fixed');
  });

  it('flags a finding that came back as retest due, not as merely open', () => {
    // Absent from the baseline and present now means the fix did not hold.
    // That is a regression, not a backlog item, and the two deserve different
    // words.
    expect(
      findingDisplayStatus({ inLatestRun: true, inBaseline: false, triage: null }),
    ).toBe('Retest due');
  });

  it.each(['dismissed', 'accepted-risk'] as const)(
    'lets a %s decision outrank a later run re-reporting the finding',
    (triage) => {
      // An operator said this is not a barrier. A re-run must not quietly undo
      // that, or the dismissal is a UI toggle rather than a judgement.
      expect(findingDisplayStatus({ inLatestRun: true, inBaseline: true, triage })).toBe(
        'Dismissed',
      );
    },
  );

  it('keeps a dismissal even once the finding stops being reported', () => {
    expect(
      findingDisplayStatus({ inLatestRun: false, inBaseline: true, triage: 'dismissed' }),
    ).toBe('Dismissed');
  });

  it('shows an assigned finding as assigned while it is still present', () => {
    expect(
      findingDisplayStatus({ inLatestRun: true, inBaseline: true, triage: 'assigned' }),
    ).toBe('Assigned');
  });

  it('reports an assigned finding that disappeared as fixed', () => {
    // Assignment is a plan; absence is evidence. Evidence wins.
    expect(
      findingDisplayStatus({ inLatestRun: false, inBaseline: true, triage: 'assigned' }),
    ).toBe('Fixed');
  });
});
