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
 * not block; `region` is impact critical and cites nothing, so its card said
 * it blocked a release it could not have. The flag now asks the gate.
 */

const PAGE = { url: 'https://acme.test/', route: '/', title: 'Home', evidenceStatus: 'complete' };

function result(findings: unknown[]) {
  return parseAuditResponse(
    {
      requestId: 'req-cards',
      journeyId: 'checkout',
      ciStatus: 'fail',
      evidenceStatus: 'complete',
      findings,
      pages: [PAGE],
    },
    200,
    true,
    false,
  );
}

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
  const html = renderToStaticMarkup(
    createElement(FindingsList, {
      result: result([
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
      ]),
    }),
  );

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
    },
  );
});
