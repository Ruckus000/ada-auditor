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
  // The gate makes no claim on an inconclusive run, so neither does the page.
  confirmed: null,
  recommendations: null,
  needsReview: 0,
  pagesAudited: 1,
  evidenceStatus: 'degraded',
  durationMs: 1000,
  slowestPageMs: 800,
};

/**
 * A decided run carrying the three findings that tell a count by the gate
 * from a count by impact: `meta-viewport` (impact moderate → minor, cites
 * wcag2aa — fails the audit), `region` (impact critical, cites nothing — a
 * recommendation) and `color-contrast` as axe's *incomplete* result
 * (needs-review, cites 1.4.3 — undecided, so not a failure).
 */
const GATED_RUN = {
  ...RUN,
  verdict: 'fail' as const,
  score: 72,
  confirmed: 1,
  recommendations: 1,
  needsReview: 1,
  evidenceStatus: 'complete',
};

const GATED_PAGE = {
  url: 'https://acme.test/',
  route: '/',
  title: 'Home',
  evidenceStatus: 'complete',
  findings: [
    {
      code: 'meta-viewport',
      severity: 'minor',
      conformanceLevel: 'AA',
      wcagCriteria: ['1.4.4'],
      fixAnyOf: ['Remove user-scalable=no from the viewport meta'],
      fixAllOf: [],
    },
    {
      code: 'region',
      severity: 'critical',
      conformanceLevel: null,
      wcagCriteria: [],
      fixAnyOf: ['Wrap page content in landmark regions'],
      fixAllOf: [],
    },
    {
      code: 'color-contrast',
      severity: 'needs-review',
      conformanceLevel: 'AA',
      wcagCriteria: ['1.4.3'],
      fixAnyOf: ['Check the background image behind the text'],
      fixAllOf: ['Confirm the computed foreground colour'],
    },
  ],
};

/** The value under one `<dt>` label on a stats list. */
function stat(html: string, label: string): string | undefined {
  return html.match(new RegExp(`${label}</dt><dd[^>]*>([^<]*)</dd>`))?.[1];
}

/** The markup of one section, from its heading to the section's end. */
function section(html: string, heading: string): string {
  const start = html.indexOf(heading);
  return start === -1 ? '' : html.slice(start, html.indexOf('</section>', start));
}

/** The markup of one finding's list item, by rule code. */
function item(html: string, code: string): string {
  return html.split('<li style="font-size:13.5px">').find((chunk) => chunk.includes(`>${code}</span>`)) ?? '';
}

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

    const html = renderToStaticMarkup(createElement(SharedReportPage, { report, token: 'test-token' }));

    expect(html).toContain('served 503 — not usable as evidence');
  });

  /**
   * The count a client reads under "Must fix" is the gate's count. It was once
   * the impact count — critical + major — and on a real document that put "0"
   * beside a list of failed criteria: `meta-viewport` is impact moderate and
   * cites wcag2aa.
   */
  it('counts through the gate, not by impact', () => {
    const report = {
      title: 'Acme accessibility audit',
      clientName: 'Acme',
      createdAt: '2026-08-16T00:00:00.000Z',
      run: GATED_RUN,
      pages: [GATED_PAGE],
    } as unknown as SharedReport;

    const html = renderToStaticMarkup(createElement(SharedReportPage, { report, token: 'test-token' }));

    expect(stat(html, 'MUST FIX')).toBe('1');
    expect(stat(html, 'SHOULD FIX')).toBe('1');
    expect(stat(html, 'NEEDS REVIEW')).toBe('1');
  });

  it('lists only the criteria the gate failed, not those an undecided check cites', () => {
    const report = {
      title: 'Acme accessibility audit',
      clientName: 'Acme',
      createdAt: '2026-08-16T00:00:00.000Z',
      run: GATED_RUN,
      pages: [GATED_PAGE],
    } as unknown as SharedReport;

    const html = renderToStaticMarkup(createElement(SharedReportPage, { report, token: 'test-token' }));
    const criteria = section(html, 'Success criteria not met');

    expect(criteria).toContain('1.4.4');
    expect(criteria).not.toContain('1.4.3');
  });

  it('does not tell the client every finding fails a criterion when one is undecided', () => {
    const report = {
      title: 'Acme accessibility audit',
      clientName: 'Acme',
      createdAt: '2026-08-16T00:00:00.000Z',
      run: GATED_RUN,
      pages: [GATED_PAGE],
    } as unknown as SharedReport;

    const html = renderToStaticMarkup(createElement(SharedReportPage, { report, token: 'test-token' }));

    expect(html).not.toContain('criterion each one fails');
    // The undecided item is marked as such where it is listed, in the same
    // words as the tile above it, so the reader can find which one it is.
    expect(item(html, 'color-contrast')).toContain('needs review');
    expect(item(html, 'meta-viewport')).not.toContain('needs review');
    // Both remediation lists still render for it: the branch that first
    // separated review items dropped one of the two.
    expect(html).toContain('Fix any one of these');
    expect(html).toContain('Fix all of these');
  });

  it('shows a dash, not a zero, where the gate made no claim', () => {
    const report = {
      title: 'Acme accessibility audit',
      clientName: 'Acme',
      createdAt: '2026-08-16T00:00:00.000Z',
      run: RUN,
      pages: [{ ...GATED_PAGE, evidenceStatus: 'degraded' }],
    } as unknown as SharedReport;

    const html = renderToStaticMarkup(createElement(SharedReportPage, { report, token: 'test-token' }));

    expect(stat(html, 'MUST FIX')).toBe('—');
    expect(stat(html, 'SHOULD FIX')).toBe('—');
    expect(html).not.toContain('0 confirmed');
    // "Success criteria not met" is the same claim as the count, in words.
    // Listing criteria by today's rule beside a dash that says the gate made
    // no claim is the recount the dash exists to refuse — seen on a real
    // gate-1 report, which read "—" above five criteria. The findings below
    // still show the criteria they cite; nothing is asserted about them.
    expect(html).not.toContain('Success criteria not met');
    expect(html).toContain('1.4.4');
  });
});
