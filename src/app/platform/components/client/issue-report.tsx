'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FONT, T } from '../../lib/tokens';

/**
 * Issuing a report from the run on screen.
 *
 * It lives here rather than on the Reports screen because the run being pinned
 * is the one an operator is looking at. A "new report" button over on Reports
 * would have to ask which client and which run first — the two questions this
 * page has already answered.
 *
 * The link it returns is shown once, plainly, with what it does spelled out.
 * Anyone holding it can read the audit, so a control that minted one quietly
 * would be the wrong shape entirely.
 */
export function IssueReport({ clientId, requestId }: { clientId: string; requestId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/platform/clients/${clientId}/reports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId }),
      });

      if (!response.ok) {
        const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(parsed?.error ?? `That did not save (${response.status}).`);
        return;
      }

      const { report } = await response.json();
      setLink(report.shareUrl);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (link) {
    return (
      <p
        style={{
          margin: 0,
          padding: '11px 14px',
          borderRadius: 9,
          border: `1px solid ${T.rule}`,
          background: T.surfaceSunk,
          fontFamily: FONT.sans,
          fontSize: 13,
          color: T.inkSoft,
        }}
      >
        Issued. <a href={link} style={{ color: T.accent, fontFamily: FONT.mono }}>{link}</a> — anyone
        with this link can read this audit, and it will keep reporting this run and no later one.
        Revoke it from Reports.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <button
        type="button"
        onClick={issue}
        disabled={busy}
        style={{
          padding: '7px 13px',
          border: 'none',
          borderRadius: 8,
          background: T.accent,
          fontFamily: FONT.sans,
          fontSize: 12.5,
          fontWeight: 650,
          color: '#fff',
          cursor: busy ? 'not-allowed' : 'pointer',
        }}
      >
        {busy ? 'Issuing…' : 'Issue a shareable report'}
      </button>
      <span style={{ fontFamily: FONT.sans, fontSize: 11.5, color: T.inkMuted }}>
        Pinned to this run, readable by anyone with the link.
      </span>
      {error ? (
        <span role="alert" style={{ fontFamily: FONT.sans, fontSize: 11.5, color: T.failDeep }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
