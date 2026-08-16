import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { parseAuditResponse } from '../../src/app/components/audit-types';
import { FindingsList } from '../../src/app/components/findings-list';

/**
 * The console screen, for a page the client's server answered with an error.
 *
 * `describePageEvidence` has its own unit test, and that proves nothing about
 * whether a screen calls it — three guards shipped fully tested and completely
 * unwired in the phase before this one, green every time. So this drives the
 * real parser with the real `/api/audit/console` response shape and renders
 * the real component.
 *
 * The specific thing being guarded: before this, a page that captured all
 * three artifacts and came back 500 rendered the word "incomplete" — which
 * named the wrong problem, and sent whoever read it to look at our capture
 * pipeline instead of at their own server.
 */

const ERROR_URL = 'https://acme.test/dashboard';
const OK_URL = 'https://acme.test/checkout';

function responseWithErrorPage() {
  return {
    requestId: 'req-status',
    journeyId: 'demo-login',
    environment: 'staging',
    // A page served 500 drags the whole run down; the run cannot be scored.
    evidenceStatus: 'degraded',
    ciStatus: 'inconclusive',
    findings: [
      {
        code: 'image-alt',
        severity: 'critical',
        source: 'deterministic',
        message: 'Image has no accessible name.',
        pageUrl: OK_URL,
      },
    ],
    pages: [
      {
        url: OK_URL,
        route: '/checkout',
        title: 'Checkout',
        evidenceStatus: 'complete',
        statusCode: 200,
        artifacts: {
          screenshotUrl: 'https://blob.test/a.png',
          domSnapshotUrl: 'https://blob.test/a.html',
          axTreeUrl: 'https://blob.test/a.json',
        },
      },
      {
        url: ERROR_URL,
        route: '/dashboard',
        title: 'Server Error',
        evidenceStatus: 'degraded',
        statusCode: 500,
        // All three present, deliberately. Nothing failed to capture; the page
        // itself was the problem. If an artifact were missing here the test
        // would pass for the wrong reason.
        artifacts: {
          screenshotUrl: 'https://blob.test/b.png',
          domSnapshotUrl: 'https://blob.test/b.html',
          axTreeUrl: 'https://blob.test/b.json',
        },
      },
    ],
  };
}

function render(body: unknown): string {
  const result = parseAuditResponse(body, 200, true, false);
  if (!result) throw new Error('the fixture must parse');
  return renderToStaticMarkup(createElement(FindingsList, { result }));
}

describe('the console screen, for a page served as an error', () => {
  it('names the status code rather than calling the capture incomplete', () => {
    const html = render(responseWithErrorPage());

    expect(html).toContain('served 500 — not usable as evidence');

    // The word that used to be there, and was wrong: no artifact was missing.
    expect(html).not.toContain('incomplete');
  });

  it('says nothing about the status of a page that was fine', () => {
    // A 200 beside a complete page is noise, and the badge only renders for
    // pages worth remarking on.
    const html = render(responseWithErrorPage());

    expect(html).not.toContain('200');
  });

  /**
   * A degraded page with no measured status must not be blamed on a code.
   *
   * `file://` runs and every page recorded before the column existed have
   * none. Printing "served undefined" — or worse, inventing 200 — would be a
   * measurement nobody took.
   */
  it('falls back to the plain status when none was measured', () => {
    const body = responseWithErrorPage();
    delete (body.pages[1] as Record<string, unknown>).statusCode;

    const html = render(body);

    expect(html).toContain('evidence degraded');
    expect(html).not.toContain('undefined');

    // The per-page badge, specifically. A bare `not.toContain('served')` was
    // the first version of this and it failed on the run-level summary, which
    // legitimately says "…or was served as an error" — a sentence about the
    // rule, not a claim about this page.
    expect(html).not.toContain('not usable as evidence');
    expect(html).not.toContain('page returned');
  });
});
