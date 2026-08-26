import { describe, expect, it } from 'vitest';
import {
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

  it('flags a finding that was fixed and came back as retest due', () => {
    // A fix that did not hold is a regression, not a backlog item, and the two
    // deserve different words.
    expect(
      findingDisplayStatus({
        inLatestRun: true,
        inBaseline: false,
        previouslyFixed: true,
        triage: null,
      }),
    ).toBe('Retest due');
  });

  it('does not call a brand-new finding a retest', () => {
    // Absence from the baseline describes a new finding and a returning one
    // identically. Guessing from that alone labelled every finding on a
    // client's first-ever audit "Retest due" — reporting a regression where
    // nothing had ever been fixed.
    expect(
      findingDisplayStatus({ inLatestRun: true, inBaseline: false, triage: null }),
    ).toBe('Open');
  });

  it.each(['dismissed', 'accepted-risk'] as const)(
    'lets a %s decision outrank a later run re-reporting the finding',
    (triage) => {
      // The property, not the word: an operator has settled this finding and a
      // re-run must not quietly reopen it, whichever of the two settlements it
      // was. Asserting a literal here is what let `accepted-risk` be checked
      // by a test that was really only checking `dismissed`.
      expect(findingDisplayStatus({ inLatestRun: true, inBaseline: true, triage })).not.toBe(
        'Open',
      );
    },
  );

  it.each(['dismissed', 'accepted-risk'] as const)(
    'keeps a %s decision even once the finding stops being reported',
    (triage) => {
      expect(findingDisplayStatus({ inLatestRun: false, inBaseline: true, triage })).not.toBe(
        'Fixed',
      );
    },
  );

  it('says an accepted risk is accepted, not dismissed', () => {
    // These are different decisions. "Dismissed" says nobody has to do
    // anything because there is no barrier; "Accepted risk" says there is one
    // and the client is living with it. Reading the second as the first is the
    // one thing this status must never do.
    expect(
      findingDisplayStatus({ inLatestRun: true, inBaseline: true, triage: 'accepted-risk' }),
    ).toBe('Accepted risk');
    expect(
      findingDisplayStatus({ inLatestRun: true, inBaseline: true, triage: 'dismissed' }),
    ).toBe('Dismissed');
  });

  it('keeps an accepted risk accepted after the finding disappears', () => {
    // Absence is evidence that the barrier is gone, but the acceptance is a
    // record of a decision that was made. `Fixed` would erase it.
    expect(
      findingDisplayStatus({ inLatestRun: false, inBaseline: true, triage: 'accepted-risk' }),
    ).toBe('Accepted risk');
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
