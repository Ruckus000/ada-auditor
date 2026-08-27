import { describe, expect, it } from 'vitest';
import {
  cleanRate,
  coreBarrierOutcomes,
  scoreSite,
  type Expectation,
  type ScoredFinding,
} from '../../scripts/blind-test/score';

/**
 * The blind test's scorer, which decides whether the auditor saw a planted
 * barrier. It is imported from `scripts/blind-test/score.ts` and not from
 * `run.ts`: entry points call `main()` at import, and importing one from a
 * test runs it — the trap that once migrated the real database on every local
 * `npm test`.
 *
 * What is worth pinning is the arithmetic that turns a run into a claim about
 * the product, because that claim is what a reader will quote.
 */

const finding = (over: Partial<ScoredFinding> = {}): ScoredFinding => ({
  code: 'image-alt',
  severity: 'critical',
  selector: '#hero',
  pageUrl: 'file:///sites/demo/index.html',
  wcagCriteria: ['1.1.1'],
  conformanceLevel: 'A',
  ...over,
});

const expectation = (over: Partial<Expectation> = {}): Expectation => ({
  id: 'X1',
  page: 'index.html',
  selector: '#hero',
  what: 'Hero image has no alt.',
  criterion: '1.1.1',
  level: 'A',
  expect: 'deterministic',
  axeRule: 'image-alt',
  weight: 'core',
  ...over,
});

describe('blind-test scorer', () => {
  it('counts a predicted violation reported by the predicted rule as seen', () => {
    const score = scoreSite({
      site: 'demo',
      expectations: [expectation()],
      findings: [finding()],
      advisory: [],
    });

    expect(score.results[0].outcome).toBe('hit');
    expect(score.results[0].predictedRuleFired).toBe(true);
    expect(score.unexpected).toEqual([]);
  });

  /**
   * The case that flatters a tool if nobody looks: something fired on the
   * element, so a naive scorer calls it seen, but the rule that fired names a
   * different problem and the operator is never told about this one.
   */
  it('records that the predicted rule did not fire, even when another one did', () => {
    const score = scoreSite({
      site: 'demo',
      expectations: [expectation({ axeRule: 'skip-link' })],
      findings: [finding({ code: 'region', severity: 'minor' })],
      advisory: [],
    });

    expect(score.results[0].outcome).toBe('hit');
    expect(score.results[0].predictedRuleFired).toBe(false);
    expect(score.results[0].matchedRules).toEqual(['region']);
  });

  it('separates a violation from the human-review queue in both directions', () => {
    const undecided = finding({ severity: 'needs-review' });

    const downgraded = scoreSite({
      site: 'demo',
      expectations: [expectation()],
      findings: [undecided],
      advisory: [],
    });
    expect(downgraded.results[0].outcome).toBe('downgraded');

    const upgraded = scoreSite({
      site: 'demo',
      expectations: [expectation({ expect: 'needs-review' })],
      findings: [finding()],
      advisory: [],
    });
    expect(upgraded.results[0].outcome).toBe('upgraded');
  });

  it('credits a judgement expectation only when the advisory names it', () => {
    const judgement = expectation({
      selector: '#photo',
      expect: 'judgement',
      axeRule: undefined,
      cue: 'image1',
    });

    const withAdvisory = scoreSite({
      site: 'demo',
      expectations: [judgement],
      findings: [],
      advisory: ['The team photo on index.html has alt="image1", which describes nothing.'],
    });
    expect(withAdvisory.results[0].outcome).toBe('hit');

    const withoutAdvisory = scoreSite({
      site: 'demo',
      expectations: [judgement],
      findings: [],
      advisory: [],
    });
    expect(withoutAdvisory.results[0].outcome).toBe('miss');
  });

  it('treats a rule finding on a judgement expectation as better than asked', () => {
    const score = scoreSite({
      site: 'demo',
      expectations: [expectation({ expect: 'judgement', axeRule: undefined, cue: 'nothing here' })],
      findings: [finding()],
      advisory: [],
    });

    expect(score.results[0].outcome).toBe('caught-by-rules');
  });

  it('reports a finding on a correctly built element as a false positive', () => {
    const score = scoreSite({
      site: 'demo',
      expectations: [expectation({ expect: 'clean', axeRule: undefined })],
      findings: [finding()],
      advisory: [],
    });

    expect(score.results[0].outcome).toBe('false-positive');
  });

  it('does not match a finding on another page carrying the same selector', () => {
    const score = scoreSite({
      site: 'demo',
      expectations: [expectation()],
      findings: [finding({ pageUrl: 'file:///sites/demo/contact.html' })],
      advisory: [],
    });

    expect(score.results[0].outcome).toBe('miss');
    expect(score.unexpected).toEqual([
      { code: 'image-alt', severity: 'critical', count: 1, pages: ['contact.html'] },
    ]);
  });

  /**
   * `html` must not match `html > body > p`, or every page-level rule would
   * claim every finding on the page. Id selectors are the opposite case: axe
   * reports a path whenever the bare id is not the whole story, so `#hero` has
   * to match both `.card > #hero` and `#hero > span` — the second is the real
   * shape, `#contrast-on-photo > p` on the dentist's services page.
   */
  it('matches id selectors by path and everything else exactly', () => {
    const scoped = scoreSite({
      site: 'demo',
      expectations: [expectation()],
      findings: [finding({ selector: '.card > #hero' })],
      advisory: [],
    });
    expect(scoped.results[0].outcome).toBe('hit');

    const inside = scoreSite({
      site: 'demo',
      expectations: [expectation()],
      findings: [finding({ selector: '#hero > span' })],
      advisory: [],
    });
    expect(inside.results[0].outcome).toBe('hit');

    const documentLevel = scoreSite({
      site: 'demo',
      expectations: [expectation({ selector: 'html', axeRule: 'html-has-lang' })],
      findings: [finding({ code: 'image-alt', selector: 'html > body > p' })],
      advisory: [],
    });
    expect(documentLevel.results[0].outcome).toBe('miss');
  });

  /**
   * The case that made the substring test wrong, and it is not hypothetical:
   * Kestrel's index carries `#stat-uptime` and `#stat-uptime-note` in the same
   * card, predicting `heading-order` and `color-contrast` respectively. Under a
   * substring test the caption's contrast failure also scored the heading
   * expectation, which survived as an honest hit only because `heading-order`
   * happened to fire too. Disable that rule — exactly the regression this
   * scorecard exists to catch — and the expectation would still have read SEEN,
   * scored entirely off the element next to it.
   */
  it('does not credit an id with a longer id that merely starts the same way', () => {
    const score = scoreSite({
      site: 'demo',
      expectations: [
        expectation({ id: 'C3', selector: '#stat-uptime', axeRule: 'heading-order' }),
        expectation({ id: 'C2', selector: '#stat-uptime-note', axeRule: 'color-contrast' }),
      ],
      findings: [
        finding({ code: 'color-contrast', severity: 'major', selector: '#stat-uptime-note' }),
      ],
      advisory: [],
    });

    const [heading, caption] = score.results;
    expect(heading.outcome).toBe('miss');
    expect(heading.matchedRules).toEqual([]);
    expect(caption.outcome).toBe('hit');
    expect(caption.matchedRules).toEqual(['color-contrast']);
  });

  it('scores the core hit rate over core expectations only', () => {
    const score = scoreSite({
      site: 'demo',
      expectations: [
        expectation({ id: 'X1' }),
        expectation({ id: 'X2', selector: '#other', weight: 'probe' }),
        expectation({ id: 'X3', selector: '#third' }),
      ],
      findings: [finding()],
      advisory: [],
    });

    expect(coreBarrierOutcomes(score)).toMatchObject({ seen: 1, total: 2 });
  });

  /**
   * A `clean` row is a correctly built element that must produce no finding.
   * Leaving one alone is not a barrier the auditor saw, and counting it as one
   * flatters the tool that sees least: with these three expectations an auditor
   * that reported nothing at all would score 1/3 on the old arithmetic, because
   * the clean row passes by doing nothing. Worse, the seven `clean` rows exist
   * as the guard against enabling a noisier rule — so under the old sum,
   * strengthening that guard raised the hit rate.
   */
  it('keeps clean rows out of the barrier rate and reports them separately', () => {
    const score = scoreSite({
      site: 'demo',
      expectations: [
        expectation({ id: 'X1', selector: '#hero' }),
        expectation({ id: 'X2', selector: '#missed', axeRule: 'label' }),
        expectation({ id: 'X3', selector: '#tidy', expect: 'clean', axeRule: undefined }),
      ],
      findings: [finding()],
      advisory: [],
    });

    expect(score.results.map((result) => result.outcome)).toEqual([
      'hit',
      'miss',
      'clean-pass',
    ]);
    // One barrier of two, not two of three.
    expect(coreBarrierOutcomes(score)).toEqual({
      seen: 1,
      total: 2,
      missed: 1,
      downgraded: 0,
    });
    expect(cleanRate(score)).toEqual({ quiet: 1, total: 1 });
  });

  it('counts a clean row reported against as noisy rather than as a miss', () => {
    const score = scoreSite({
      site: 'demo',
      expectations: [expectation({ expect: 'clean', axeRule: undefined })],
      findings: [finding()],
      advisory: [],
    });

    expect(score.results[0].outcome).toBe('false-positive');
    expect(cleanRate(score)).toEqual({ quiet: 0, total: 1 });
    // No barriers were planted, so there is no rate to report.
    expect(coreBarrierOutcomes(score)).toEqual({
      seen: 0,
      total: 0,
      missed: 0,
      downgraded: 0,
    });
  });

  /**
   * The property that makes the summary line readable: a reader adds the three
   * and gets the total. It holds because a barrier can only be seen, missed or
   * downgraded — `clean-pass` and `false-positive` belong to `clean` rows,
   * which are not in this population.
   *
   * The line used to pair this fraction with a miss count taken over every
   * row, so Fairview printed `4/8 seen · 5 missed`: the 5 counted two `probe`
   * misses and skipped a core barrier that was downgraded rather than missed,
   * and the subtraction a reader would do came out wrong.
   */
  it('accounts for every core barrier, so seen + missed + downgraded is the total', () => {
    const score = scoreSite({
      site: 'demo',
      expectations: [
        expectation({ id: 'X1', selector: '#seen' }),
        expectation({ id: 'X2', selector: '#gone' }),
        expectation({ id: 'X3', selector: '#undecided' }),
        // Neither of these may reach the barrier arithmetic.
        expectation({ id: 'X4', selector: '#probe', weight: 'probe' }),
        expectation({ id: 'X5', selector: '#tidy', expect: 'clean', axeRule: undefined }),
      ],
      findings: [
        finding({ selector: '#seen' }),
        finding({ selector: '#undecided', severity: 'needs-review' }),
        finding({ selector: '#probe' }),
      ],
      advisory: [],
    });

    const core = coreBarrierOutcomes(score);

    expect(core).toEqual({ seen: 1, total: 3, missed: 1, downgraded: 1 });
    expect(core.seen + core.missed + core.downgraded).toBe(core.total);
    expect(cleanRate(score)).toEqual({ quiet: 1, total: 1 });
  });
});
