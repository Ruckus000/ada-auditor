import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseAuditResponse } from '../../src/app/components/audit-types';
import { FindingsList } from '../../src/app/components/findings-list';

/**
 * The console's finding cards, rendered.
 *
 * Each card carries a gate flag — "Blocks release" or "Does not block
 * release" — and the flag once read `severity === 'critical'`, which is
 * axe's impact rating, not the gate. The gate fails a run on the success
 * criterion a finding cites: `meta-viewport` is impact moderate and cites
 * wcag2aa, so it is what turned a verdict to FAIL while its card said it did
 * not block; `region` (rated critical here) cites nothing, so its card said
 * it blocked a release it could not have. The flag now asks the gate.
 */

const PAGE = { url: 'https://acme.test/', route: '/', title: 'Home', evidenceStatus: 'complete' };

function result(
  findings: unknown[],
  over: { ciStatus?: string; evidenceStatus?: string; regression?: unknown } = {},
) {
  return parseAuditResponse(
    {
      requestId: 'req-cards',
      journeyId: 'checkout',
      ciStatus: 'fail',
      evidenceStatus: 'complete',
      findings,
      pages: [PAGE],
      ...over,
    },
    200,
    true,
    false,
  );
}

const CARDS = [
  {
    code: 'meta-viewport',
    severity: 'minor',
    source: 'deterministic',
    message: 'Zooming and scaling must not be disabled',
    conformanceLevel: 'AA',
    pageUrl: PAGE.url,
  },
  {
    code: 'region',
    severity: 'critical',
    source: 'deterministic',
    message: 'All page content should be contained by landmarks',
    conformanceLevel: null,
    pageUrl: PAGE.url,
  },
  {
    code: 'color-contrast',
    severity: 'needs-review',
    source: 'deterministic',
    message: 'Elements must meet minimum color contrast ratio thresholds',
    conformanceLevel: 'AA',
    pageUrl: PAGE.url,
  },
  {
    code: 'ai-advisory',
    severity: 'advisory',
    source: 'ai-advisory',
    message: 'Heading used for size',
    confidence: 0.8,
    gateable: false,
  },
];

/** One card's markup, found by the rule code it prints. */
function card(html: string, code: string): string {
  const found = html
    .split('<li class="finding ')
    .slice(1)
    .find((one) => one.includes(`>${code}</code>`) || one.includes(`>${code}</p>`));
  if (!found) throw new Error(`no card for ${code}`);
  return found;
}

describe('the console finding card', () => {
  const html = renderToStaticMarkup(createElement(FindingsList, { result: result(CARDS) }));

  it('flags a minor finding against a Level AA criterion as blocking', () => {
    expect(card(html, 'meta-viewport')).toContain('Blocks release');
  });

  it('does not flag a critical best-practice finding as blocking', () => {
    expect(card(html, 'region')).toContain('Does not block release');
    expect(card(html, 'region')).not.toContain('Fails the build');
  });

  it('shows an undecided check as needing review, and never as blocking', () => {
    const review = card(html, 'color-contrast');

    expect(review).toContain('Needs review');
    expect(review).toContain('Does not block release');
    expect(review).toContain('sev-needs-review');
  });

  it('explains a non-blocking rule-based finding as rule-based, not as an AI note', () => {
    // The tooltip beside "Does not block release" once pointed every
    // non-blocking card at the "Advisory note" entry — "An AI suggestion" —
    // including cards axe produced. The tip's trigger names its entry.
    expect(card(html, 'region')).toContain('Explain: Rule-based finding');
    expect(card(html, 'region')).not.toContain('Explain: Advisory note');
    expect(card(html, 'ai-advisory')).toContain('Explain: Advisory note');
    expect(card(html, 'meta-viewport')).toContain('Explain: Blocks release');
  });
});

describe('the console finding card on an inconclusive run', () => {
  // The gate declined to judge. The verdict panel says so; a card beneath it
  // reading "Blocks release" — whose tooltip says "it is what turned the
  // verdict to fail" — makes the claim the panel just withheld. Every stored
  // surface shows a dash for this run.
  const html = renderToStaticMarkup(
    createElement(FindingsList, {
      result: result(CARDS, { ciStatus: 'inconclusive', evidenceStatus: 'degraded' }),
    }),
  );

  it('flags no card as blocking, and none as not blocking either', () => {
    expect(html).not.toContain('Blocks release');
    expect(html).not.toContain('Does not block release');
  });

  it('still lists the cards', () => {
    expect(card(html, 'meta-viewport')).toContain('Zooming and scaling');
  });
});

/**
 * The diff's headline and the cards underneath it.
 *
 * The block had no render test at all, which is how its headline kept axe's
 * vocabulary through the pass that moved every card to the gate. The two are
 * asserted together on one render, because their agreement is the property —
 * a headline that says "worse" over a card that says "Does not block release"
 * is the defect, and either assertion alone would pass while it stood.
 */
describe('the console regression block', () => {
  /** Just the diff section, so a card in the list above cannot answer for it. */
  function block(html: string): string {
    const found = html.split('<section class="regression-block"')[1];
    if (!found) throw new Error('no regression block');
    return found;
  }

  it('names the gate when a new finding failed the run, and flags that card', () => {
    const html = renderToStaticMarkup(
      createElement(FindingsList, {
        result: result(CARDS, {
          regression: {
            status: 'fail',
            baselineRequestId: 'req-old',
            newFindings: [CARDS[0]],
            resolvedFindings: [],
            unchangedCount: 0,
          },
        }),
      }),
    );

    expect(block(html)).toContain('Worse than last time — a new issue must be fixed.');
    expect(block(html)).not.toContain('critical issue');
    expect(card(block(html), 'meta-viewport')).toContain('Blocks release');
  });

  /**
   * The withheld diff has to explain itself truthfully. "The last run walked a
   * different path" is a good sentence and the wrong one for a run that walked
   * the right path and could not see it — a reader who believes it goes
   * looking for a journey change that never happened.
   */
  it.each([
    ['different-path', 'walked a different path', 'could not see every page'],
    ['partial-run', 'could not see every page', 'walked a different path'],
  ])('explains an incomparable diff by its actual reason: %s', (reason, says, doesNotSay) => {
    const html = renderToStaticMarkup(
      createElement(FindingsList, {
        result: result(CARDS, {
          regression: {
            status: 'incomparable',
            reason,
            baselineRequestId: 'req-old',
            newFindings: [],
            resolvedFindings: [],
            unchangedCount: 0,
          },
        }),
      }),
    );

    expect(block(html)).toContain(says);
    expect(block(html)).not.toContain(doesNotSay);
  });

  it('claims neither cause when the payload names no reason', () => {
    const html = renderToStaticMarkup(
      createElement(FindingsList, {
        result: result(CARDS, {
          regression: {
            status: 'incomparable',
            baselineRequestId: 'req-old',
            newFindings: [],
            resolvedFindings: [],
            unchangedCount: 0,
          },
        }),
      }),
    );

    expect(block(html)).toContain('cannot be held to the same measurement');
    expect(block(html)).not.toContain('walked a different path');
    expect(block(html)).not.toContain('could not see every page');
  });

  it('does not call a run worse when the new finding blocks nothing', () => {
    const html = renderToStaticMarkup(
      createElement(FindingsList, {
        result: result(CARDS, {
          ciStatus: 'pass',
          regression: {
            status: 'warn',
            baselineRequestId: 'req-old',
            newFindings: [CARDS[1]],
            resolvedFindings: [],
            unchangedCount: 0,
          },
        }),
      }),
    );

    expect(block(html)).toContain('Slightly worse than last time');
    expect(card(block(html), 'region')).toContain('Does not block release');
  });
});

/**
 * The stylesheet is a plain file with no test of its own, so the two classes
 * the card renders for a review item are checked the way
 * `document-verdict-copy.test.ts` checks a source file: by reading it. A
 * class with no rule renders the card with no left border and the badge with
 * no colour, which is a finding that looks like nothing.
 */
describe('the console stylesheet', () => {
  const css = readFileSync('src/app/globals.css', 'utf8');

  it('styles the needs-review card and badge', () => {
    expect(css).toMatch(/\.finding-needs-review\s*\{/);
    expect(css).toMatch(/\.sev-needs-review\s*\{/);
  });
});

/**
 * Four sentences in the console's own words said the verdict turns on
 * `critical`. They are prose, held in place by nothing, so they are checked
 * by reading the files: the gate is the success criterion, and the console
 * may not describe a different rule from the one that produced its verdict.
 */
describe('the console copy', () => {
  it.each(['src/app/components/glossary.ts', 'src/app/components/verdict-panel.tsx'])(
    '%s does not say the verdict turns on critical findings',
    (file) => {
      const source = readFileSync(file, 'utf8');

      expect(source).not.toMatch(/critical rule-based/);
      expect(source).not.toMatch(/Only critical/);
      expect(source).not.toMatch(/finding is critical/);
      // The fourth sentence, which the three above did not reach. The
      // regression InfoTip read "A newly appearing critical issue is reported
      // as a failure" and survived the sweep that wrote them — a guard is
      // only as wide as the wording it happens to have seen.
      expect(source).not.toMatch(/critical issue/i);
    },
  );
});
