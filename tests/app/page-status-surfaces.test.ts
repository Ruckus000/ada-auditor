import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * `IssueReport` is a client component holding `useState`, and it renders
 * unconditionally at the top of `ClientFindings`. Stubbed so the server
 * renderer can reach the part under test; it sits nowhere near the evidence
 * pill and carries none of its behaviour.
 */
vi.mock('../../src/app/platform/components/client/issue-report', () => ({
  IssueReport: () => null,
}));

const { ClientFindings } = await import(
  '../../src/app/platform/components/client/client-findings'
);
import { SharedReportPage } from '../../src/app/r/[token]/shared-report';
import type { FindingsView } from '../../src/services/findings-view';
import type { SharedReport } from '../../src/services/report-view';

/**
 * The other two screens that show per-page evidence.
 *
 * `page-status-render` covers the console. Neither of these had *any* render
 * coverage before this file, so a `describePageEvidence` call added to them
 * would have been held in place by nothing but the compiler — and a call the
 * compiler accepts is exactly what "fully tested and completely unwired"
 * looked like the three times it happened in the phase before this one.
 *
 * The public share page matters most of the three. It is the document a client
 * reads, outside the auth gate, and telling them "evidence degraded" when the
 * truth is that their own server returned 500 sends them to argue with us
 * about our tooling.
 */

const RUN = {
  requestId: 'req-surfaces',
  createdAt: '2026-08-16T00:00:00.000Z',
  verdict: 'inconclusive' as const,
  score: null,
  mustFix: 0,
  shouldFix: 0,
  pagesAudited: 1,
  evidenceStatus: 'degraded',
  durationMs: 1000,
  slowestPageMs: 800,
};

const ERROR_PAGE = {
  url: 'https://acme.test/dashboard',
  route: '/dashboard',
  title: 'Server Error',
  evidenceStatus: 'degraded',
  statusCode: 503,
};

describe('the platform client screen', () => {
  it('names the status code on a page the server answered with an error', () => {
    const view = {
      clientId: 'acme',
      clientName: 'Acme',
      run: RUN,
      journeyName: 'Login',
      pages: [{ ...ERROR_PAGE, findings: [] }],
      advisory: [],
      counts: { must: 0, should: 0, nice: 0, review: 0, advisory: 0 },
    } as unknown as FindingsView;

    const html = renderToStaticMarkup(createElement(ClientFindings, { view }));

    expect(html).toContain('served 503 — not usable as evidence');
  });
});

describe('the public share page', () => {
  it('tells the client their server returned the error, not that our evidence failed', () => {
    const report = {
      title: 'Acme accessibility audit',
      clientName: 'Acme',
      createdAt: '2026-08-16T00:00:00.000Z',
      run: RUN,
      pages: [{ ...ERROR_PAGE, findings: [] }],
    } as unknown as SharedReport;

    const html = renderToStaticMarkup(createElement(SharedReportPage, { report }));

    expect(html).toContain('served 503 — not usable as evidence');
  });
});
