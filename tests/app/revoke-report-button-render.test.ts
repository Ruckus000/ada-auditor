import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The control that stops a shared report link working.
 *
 * The API has been able to revoke a token since reports existed
 * (`DELETE /api/platform/clients/<id>/reports` → `revokeShareToken`), and no
 * screen offered it — which is why `issue-report.tsx` had to delete the
 * sentence telling operators to "revoke it from Reports", a place with no such
 * control.
 *
 * **It is called "Revoke link", not "Turn off link".** This product already
 * names the act: the delivery panel renders a `Revoke link` button, and both
 * that panel and this screen render `Link revoked` as the resulting state. A
 * second word for one act, on a sibling screen, is the defect the whole
 * plain-English path exists to remove, and renaming the act belongs to the
 * pass that renames it everywhere at once.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { RevokeReportButton, describeRevokeFailure } = await import(
  '../../src/app/platform/components/revoke-report-button'
);

const REPORT = {
  id: 'report-1',
  requestId: 'req-abc',
  title: 'Acme accessibility audit',
  clientId: 'acme',
};

function render(over: Partial<typeof REPORT> = {}) {
  return renderToStaticMarkup(createElement(RevokeReportButton, { report: { ...REPORT, ...over } }));
}

describe('RevokeReportButton', () => {
  it('names the report it belongs to, with the visible text as a prefix', () => {
    // Every row would otherwise be one more "Revoke link" in a screen
    // reader's list of controls, with nothing to tell them apart — the
    // reasoning `triage-control.tsx` and `run-journey-button.tsx` both record.
    const html = render();

    expect(html).toContain('aria-label="Revoke link for Acme accessibility audit"');
    expect(html).toContain('>Revoke link<');
  });

  it('falls back to the run id when the report has no title', () => {
    expect(render({ title: undefined })).toContain('aria-label="Revoke link for req-abc"');
  });

  it('carries a pointer target of its own', () => {
    // WCAG 2.2 SC 2.5.8, which this product's own engine enforces against it:
    // the hydration suite asserts axe at zero, and `triage-control.tsx`
    // records the run where our radios failed `target-size`. The button sits
    // inline beside a 12.5px link, so without a minimum height it is about
    // 20px tall.
    expect(render()).toMatch(/min-height:24px/);
  });

  it('renders no button where the run behind the report is gone', () => {
    // `clientId` is absent exactly when `buildReports` could not find the run
    // (`report-view.ts`), and the route needs that run to prove the report is
    // this client's — so the button would 404 every time. The row says why
    // instead, because a missing control reads as "already revoked".
    const html = render({ clientId: undefined });

    expect(html).not.toContain('<button');
    expect(html).toMatch(/no longer stored/i);
  });
});

describe('describeRevokeFailure', () => {
  it('does not tell anyone to try again when the report is already gone', () => {
    // `report_not_found` answers three states — no such report, another
    // client's, and one whose run has aged out — and none of them changes by
    // repeating the request. "Try again" is the one instruction this refusal
    // makes wrong, which is the rule `discovery-copy.ts` states.
    const copy = describeRevokeFailure('report_not_found');

    expect(copy).not.toMatch(/try again/i);
    expect(copy).toMatch(/reload|refresh/i);
  });

  it('sends an expired session to sign in rather than to retry', () => {
    expect(describeRevokeFailure('unauthorized')).toMatch(/sign in/i);
  });

  it('prints an unknown code rather than inventing a sentence for it', () => {
    expect(describeRevokeFailure('something_new')).toBe('The link was not revoked: something_new.');
  });

  it('says the server could not be reached when there is no code at all', () => {
    expect(describeRevokeFailure(undefined)).toMatch(/reach/i);
  });

  it('does not walk the prototype for a hostile code', () => {
    // The code comes off a parsed JSON body, and `__proto__` looked up on an
    // object literal resolves to something truthy and not a string, which
    // React renders by throwing.
    expect(typeof describeRevokeFailure('__proto__')).toBe('string');
    expect(describeRevokeFailure('__proto__')).toContain('__proto__');
  });
});
