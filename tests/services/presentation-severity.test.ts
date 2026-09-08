import { describe, expect, it } from 'vitest';
import {
  displaySeverity,
  findingDisplayStatus,
  severityCounts,
} from '../../src/services/presentation/severity';
import { GATE_VERSION } from '../../src/services/reporting';

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

describe('severityCounts', () => {
  const finding = (
    severity: string,
    over: { source?: string; conformanceLevel?: string | null } = {},
  ) => ({
    severity,
    source: over.source ?? 'deterministic',
    ...(over.conformanceLevel === undefined ? {} : { conformanceLevel: over.conformanceLevel }),
  });
  const run = (
    findings: ReturnType<typeof finding>[],
    over: { ciStatus?: string; gateVersion?: number } = {},
  ) => ({ ciStatus: 'fail', gateVersion: GATE_VERSION, findings, ...over });

  /**
   * The count a client reads as "confirmed" is the gate's count, not a
   * severity table's. `meta-viewport` is impact moderate (→ minor) and cites
   * wcag2aa, so it fails the audit; `region` is impact critical and cites
   * nothing, so it is a recommendation. A count by impact puts "0" beside a
   * list of failed criteria — which is the incident this shape replaces.
   */
  it('counts confirmed by the criterion the gate used, not by impact', () => {
    const counts = severityCounts(
      run([
        finding('minor', { conformanceLevel: 'AA' }),
        finding('critical', { conformanceLevel: null }),
        // A record written before conformance levels were stored.
        finding('major'),
      ]),
    );

    expect(counts).toEqual({ confirmed: 1, recommendations: 2, needsReview: 0 });
  });

  it('keeps a needs-review finding in the review queue whatever it cites', () => {
    const counts = severityCounts(run([finding('needs-review', { conformanceLevel: 'AA' })]));

    expect(counts).toEqual({ confirmed: 0, recommendations: 0, needsReview: 1 });
  });

  /**
   * The reason this helper exists. Everything HTML_CodeSniffer emits is
   * `needs-review` by design, and on a real fixture run that was 130 findings
   * of 139 — so a summary counting only the decided ones described nine of
   * them and called it the audit.
   */
  it('counts a second engine\'s findings, which are all needs-review', () => {
    const counts = severityCounts(
      run([
        finding('critical', { conformanceLevel: 'A' }),
        ...Array.from({ length: 130 }, () => finding('needs-review')),
      ]),
    );

    expect(counts.needsReview).toBe(130);
    expect(counts.confirmed).toBe(1);
  });

  /**
   * Advisory findings are `gateable: false` and are reported under their own
   * name. Absorbing them into the review queue would present a model's opinion
   * as outstanding work.
   */
  it('excludes advisory findings from every bucket', () => {
    const counts = severityCounts(run([finding('advisory', { source: 'ai-advisory', conformanceLevel: 'A' })]));

    expect(counts).toEqual({ confirmed: 0, recommendations: 0, needsReview: 0 });
  });

  /**
   * `displaySeverity` sends an unrecognised severity to `review` rather than
   * to a low-priority bucket, and the counts have to agree with it — a finding
   * nobody can categorise is precisely one a human should see.
   */
  it('counts an unknown severity as needing review, as displaySeverity does', () => {
    expect(severityCounts(run([finding('bizarre')])).needsReview).toBe(1);
  });

  it('counts nothing for an empty run', () => {
    expect(severityCounts(run([]))).toEqual({ confirmed: 0, recommendations: 0, needsReview: 0 });
  });

  /**
   * `summarizeRun` reports `blockingFindings: 0` on an inconclusive run by
   * design — a verdict it could not reach is not a verdict of zero. A count
   * here would be a second definition of the same number, one that says "1
   * confirmed" beside the gate's 0. The review queue is still work, so it is
   * still counted.
   */
  it('makes no confirmed claim on an inconclusive run', () => {
    const counts = severityCounts(
      run([finding('minor', { conformanceLevel: 'AA' }), finding('needs-review')], {
        ciStatus: 'inconclusive',
      }),
    );

    expect(counts).toEqual({ confirmed: null, recommendations: null, needsReview: 1 });
  });

  /**
   * Gate 1 decided by impact. Recounting its findings with today's gate would
   * put a number beside a verdict that number did not produce — and rows from
   * before `gate_version` was stored carry no version at all.
   */
  it('makes no confirmed claim for a run an earlier gate decided', () => {
    const findings = [finding('critical', { conformanceLevel: 'A' })];

    expect(severityCounts(run(findings, { gateVersion: 1 })).confirmed).toBeNull();
    expect(severityCounts({ ciStatus: 'fail', findings }).confirmed).toBeNull();
    expect(severityCounts({ ciStatus: 'fail', findings }).recommendations).toBeNull();
  });
});
