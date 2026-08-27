import { describe, expect, it } from 'vitest';
import {
  coreHitRate,
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

    expect(coreHitRate(score)).toEqual({ hits: 1, total: 2 });
  });
});
