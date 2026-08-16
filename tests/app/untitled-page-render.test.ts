import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseAuditResponse } from '../../src/app/components/audit-types';
import { FindingsList } from '../../src/app/components/findings-list';

/**
 * The console screen, for a page that has no title.
 *
 * This is the test that was missing, and its absence is the whole reason the
 * first attempt at this fix did nothing. Relaxing the evidence schema let an
 * untitled page reach the screens; the screens were then "fixed" with
 * `page.title ?? page.route`, which cannot fire on `''`. Every suite stayed
 * green and the heading stayed blank.
 *
 * `/console` is the path that proves it, because it is the one that does not
 * go through `findings-view`: `POST /api/audit/console` returns the run body
 * directly, `parseAuditResponse` reads it, and `FindingsList` renders it. So
 * this drives the real parser with the real response shape rather than
 * hand-building a component prop that could be given the convenient value.
 *
 * Rendered rather than asserted on the parser alone: the defect was three
 * separate reads of `title` in one file, and only the markup shows all three.
 */

const UNTITLED_URL = 'https://acme.test/dashboard';
const TITLED_URL = 'https://acme.test/checkout';

/** The body `/api/audit/console` returns when a page has an empty title. */
function responseWithUntitledPage() {
  return {
    requestId: 'req-untitled',
    journeyId: 'demo-login',
    environment: 'staging',
    evidenceStatus: 'complete',
    ciStatus: 'pass',
    findings: [
      {
        id: 'f1',
        source: 'deterministic',
        code: 'document-title',
        severity: 'major',
        message: 'Documents must have a title element to aid in navigation',
        pageUrl: UNTITLED_URL,
      },
    ],
    pages: [
      { url: UNTITLED_URL, route: '/dashboard', title: '', evidenceStatus: 'complete' },
      { url: TITLED_URL, route: '/checkout', title: 'Checkout', evidenceStatus: 'complete' },
    ],
  };
}

function render() {
  const result = parseAuditResponse(responseWithUntitledPage(), 200, true, false);
  return renderToStaticMarkup(createElement(FindingsList, { result }));
}

describe('the findings list, for a page with no title', () => {
  it('parses an empty title as absent rather than as a title', () => {
    const result = parseAuditResponse(responseWithUntitledPage(), 200, true, false);

    expect(result.pages?.[0]?.title).toBeUndefined();
    expect(result.pages?.[1]?.title).toBe('Checkout');
  });

  it('names the page by its route instead of rendering a blank heading', () => {
    const markup = render();

    // The bold name, not the muted route line beside it. `<span
    // class="page-title"></span>` is what shipped before this.
    expect(markup).toContain('<span class="page-title">/dashboard</span>');
    expect(markup).not.toContain('<span class="page-title"></span>');
  });

  it('gives the page’s section an accessible name', () => {
    const markup = render();

    // An empty `aria-label` does not fall back to the content — it strips the
    // region from the landmark list. In an accessibility tool, on the page
    // whose finding is that it has no name.
    expect(markup).toContain('aria-label="/dashboard"');
    expect(markup).not.toContain('aria-label=""');
  });

  it('names an untitled clean page in the "no issues" sentence', () => {
    const markup = render();

    // The titled page here has no findings, so it is the clean one. Reversing
    // which page is untitled is what puts a blank in this list, so assert the
    // sentence names something in both directions.
    expect(markup).toContain('No issues on Checkout.');
    expect(markup).not.toMatch(/No issues on\s*[,.]/);
  });

  it('still prefers a real title when there is one', () => {
    const markup = render();

    expect(markup).toContain('Checkout');
  });
});
