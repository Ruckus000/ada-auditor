'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { inertWhen } from '../lib/inert-button';
import { FONT, T } from '../lib/tokens';

/**
 * Stops a shared report link working.
 *
 * A component of its own rather than a handler on `reports-screen.tsx`,
 * because that screen is a Server Component and the whole of it would
 * otherwise ship to the browser — every row's title, run line, document
 * counts and links — to give one button a `useState`. The same reason
 * `client-findings.tsx` keeps `TriageControl` separate.
 *
 * **"Revoke link", not "Turn off link".** The delivery panel already renders a
 * `Revoke link` button, and this screen and that one both render `Link
 * revoked` as the resulting state; the route writes the activity event
 * "revoked a report link". A second word for one act, on a sibling screen, is
 * the defect this path exists to remove, and renaming the act is a job for the
 * pass that renames every instance of it at once.
 *
 * What revoking does to the person holding the link is worth knowing before
 * pressing it: `/r/<token>` answers 404 afterwards, indistinguishable from a
 * token that never existed. Nothing here can un-revoke; a new link can be
 * issued, at a new address.
 */

/** Just the fields this control needs, so a test does not build a whole row. */
export type RevokableReport = {
  id: string;
  requestId: string;
  title?: string;
  /**
   * Absent when `buildReports` could not find the run behind the report. The
   * route proves the report is this client's by walking run → journey →
   * client, so without it every request would answer `report_not_found`.
   */
  clientId?: string;
};

/**
 * Why a revocation did not happen, in words an operator can act on.
 *
 * A `switch` rather than a lookup, for the reason `discovery-copy.ts` records:
 * the code arrives off a parsed JSON body, and `__proto__` resolved against an
 * object literal walks the prototype chain to something truthy and not a
 * string, which React renders by throwing.
 *
 * `report_not_found` deliberately does not say "try again". It answers three
 * states — no such report, another client's report, and one whose run is no
 * longer stored — and repeating the request changes none of them. (Not a run
 * aged past the fifty this screen lists: the route looks runs up by id, with
 * no bound, so such a report revokes fine — it just has no row to click.) The screen in front of the operator is stale, so reloading it is
 * the move.
 */
export function describeRevokeFailure(code: string | undefined): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session has ended. Sign in again, then revoke it.';
    case 'client_not_found':
      return 'This client no longer exists.';
    case 'report_not_found':
      return 'This report is not on record any more, so there was nothing to revoke. Reload the page to see what is.';
    case 'invalid_request_body':
      return 'The server did not accept that request. Reload the page and try once more.';
    case undefined:
      return 'The server could not be reached, so the link is still live.';
    default:
      // A code this screen does not know is one the route grew and this did
      // not. Printing it is ugly and true; inventing a sentence is neither.
      return `The link was not revoked: ${code}.`;
  }
}

export function RevokeReportButton({ report }: { report: RevokableReport }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!report.clientId) {
    // Said rather than implied by an absent control: a row with no button
    // reads as one already revoked, and this one is still live.
    return (
      <span style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}>
        This link cannot be revoked here — the run behind it is no longer stored.
      </span>
    );
  }

  const clientId = report.clientId;

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/platform/clients/${encodeURIComponent(clientId)}/reports`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: report.id }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(describeRevokeFailure(payload?.error));
        return;
      }

      // The row re-renders without a share token, so this button goes and the
      // "Link revoked" line takes its place. No local state pretends to know
      // that ahead of the server.
      router.refresh();
    } catch {
      setError(describeRevokeFailure(undefined));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <button
        type="button"
        /*
         * `aria-disabled` and an early return, never `disabled`. A control
         * that its own click disables takes focus off itself mid-interaction,
         * dropping the operator at `<body>` to tab back through the whole
         * workspace nav to reach the row they were on. `inert-button.ts`
         * records the finding and why axe cannot see it. Eight other controls
         * in this workspace do the same; this is the ninth.
         */
        {...inertWhen(busy, () => void revoke())}
        /*
         * Named for its row. Every one of these is otherwise another
         * identically-named control in a screen reader's list — the reasoning
         * `triage-control.tsx` and `run-journey-button.tsx` both record — and
         * the visible text is a prefix of it, so speech input still matches
         * what is on screen (SC 2.5.3).
         *
         * Held still while the request is in flight, as `run-journey-button`
         * holds its own: renaming the control someone just pressed is how a
         * screen reader ends up talking over the result.
         */
        aria-label={`Revoke link for ${report.title ?? report.requestId}`}
        style={{
          fontFamily: FONT.sans,
          fontSize: 12.5,
          fontWeight: 600,
          color: T.failDeep,
          background: 'none',
          border: 'none',
          padding: '4px 0',
          // A pointer target of its own (WCAG 2.2 SC 2.5.8). Inline beside a
          // 12.5px link this is about 20px tall without it, and the hydration
          // suite asserts axe at zero — `triage-control.tsx` records the run
          // where this product's own engine caught this product's radios.
          minHeight: 24,
          display: 'inline-flex',
          alignItems: 'center',
          cursor: busy ? 'default' : 'pointer',
          // An inert control that still looks live is its own defect, which is
          // the pairing `inert-button.ts` asks every call site for.
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Revoking…' : 'Revoke link'}
      </button>
      {error ? (
        // Beside the control that failed, not at the foot of the list: on a
        // screen of fifty reports an alert at the bottom belongs to none of
        // them.
        <span role="alert" style={{ fontFamily: FONT.sans, fontSize: 11.5, color: T.failDeep }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
