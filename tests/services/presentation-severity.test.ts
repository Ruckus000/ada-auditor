import { describe, expect, it } from 'vitest';
import {
  displayBucket,
  findingDisplayStatus,
  gateDecided,
  severityCounts,
} from '../../src/services/presentation/severity';
import { GATE_VERSION } from '../../src/services/reporting';

describe('displayBucket', () => {
  const finding = (
    severity: string,
    over: { source?: string; conformanceLevel?: string | null } = {},
  ) => ({
    severity,
    source: over.source ?? 'deterministic',
    ...(over.conformanceLevel === undefined ? {} : { conformanceLevel: over.conformanceLevel }),
  });

  /**
   * `must` is the gate's word, so it is the gate's decision. The row badge
   * on the findings screen once read `critical → must`, directly beneath a
   * summary line that counted "must fix" through the gate — the same word
   * with two definitions, ninety lines apart. `meta-viewport` (minor, wcag2aa)
   * wore NICE TO FIX while being the one finding that failed the run.
   */
  it('puts a minor finding that fails a Level AA criterion in must', () => {
    expect(displayBucket(finding('minor', { conformanceLevel: 'AA' }), true)).toBe('must');
  });

  it('puts a critical best-practice finding in should, not must', () => {
    expect(displayBucket(finding('critical', { conformanceLevel: null }), true)).toBe('should');
  });

  it('orders the recommendations by impact', () => {
    expect(displayBucket(finding('major', { conformanceLevel: null }), true)).toBe('should');
    expect(displayBucket(finding('minor', { conformanceLevel: null }), true)).toBe('nice');
    expect(displayBucket(finding('critical', { conformanceLevel: 'AAA' }), true)).toBe('should');
  });

  it('keeps needs-review in the review bucket whatever it cites', () => {
    // The prototype collapsed five severities into three, which put the human
    // review worklist into `nice` — a bucket nobody works. That queue is the
    // entire point of axe's `incomplete` results.
    expect(displayBucket(finding('needs-review', { conformanceLevel: 'AA' }), true)).toBe('review');
  });

  it('keeps advisory findings in their own bucket', () => {
    expect(displayBucket(finding('advisory', { source: 'ai-advisory', conformanceLevel: 'A' }), true)).toBe('advisory');
  });

  it('sends an unrecognised severity to review rather than to nice', () => {
    // A finding we cannot categorise needs a human. Filing it as low-priority
    // is how it never gets looked at.
    expect(displayBucket(finding('some-future-severity'), true)).toBe('review');
  });

  it('puts nothing in must where the gate made no claim', () => {
    // An inconclusive run's tiles read "—" for must fix; a row badged MUST
    // FIX beneath them is the claim the dash refuses. The row keeps its
    // impact order instead.
    expect(displayBucket(finding('minor', { conformanceLevel: 'AA' }), false)).toBe('nice');
    expect(displayBucket(finding('critical', { conformanceLevel: 'A' }), false)).toBe('should');
    expect(displayBucket(finding('needs-review'), false)).toBe('review');
  });
});

describe('gateDecided', () => {
  it('is true only for a decided run judged by the current gate', () => {
    expect(gateDecided({ ciStatus: 'fail', gateVersion: GATE_VERSION })).toBe(true);
    expect(gateDecided({ ciStatus: 'pass', gateVersion: GATE_VERSION })).toBe(true);
    expect(gateDecided({ ciStatus: 'inconclusive', gateVersion: GATE_VERSION })).toBe(false);
    expect(gateDecided({ ciStatus: 'fail', gateVersion: 1 })).toBe(false);
    expect(gateDecided({ ciStatus: 'fail' })).toBe(false);
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
   * wcag2aa, so it fails the audit; `region` (rated critical here) cites
   * nothing, so it is a recommendation. A count by impact puts "0" beside a
   * list of failed criteria — which is the incident this shape replaces.
   */
  it('counts confirmed by the criterion the gate used, not by impact', () => {
    // Unbalanced on purpose: three gate failures, none of them critical, and
    // two recommendations, one critical and one major. The gate answers 3;
    // counting critical answers 1; counting critical + major answers 2. A
    // fixture with one critical and one gate failure let the old rule pass
    // this test's own name.
    const counts = severityCounts(
      run([
        finding('minor', { conformanceLevel: 'AA' }),
        finding('minor', { conformanceLevel: 'A' }),
        finding('minor', { conformanceLevel: 'AA' }),
        finding('critical', { conformanceLevel: null }),
        // A record written before conformance levels were stored.
        finding('major'),
      ]),
    );

    expect(counts).toEqual({ confirmed: 3, recommendations: 2, needsReview: 0 });
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
   * `displayBucket` sends an unrecognised severity to `review` rather than
   * to a low-priority bucket, and the counts have to agree with it — a finding
   * nobody can categorise is precisely one a human should see.
   */
  it('counts an unknown severity as needing review, as displayBucket does', () => {
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
