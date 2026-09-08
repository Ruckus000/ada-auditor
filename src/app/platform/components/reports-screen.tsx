'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ReportRow } from '../../../services/report-view';
import { FONT, T } from '../lib/tokens';
import { scoreLine } from '../../../services/presentation/verdict';

/**
 * Reports that have been issued.
 *
 * The screen this replaces was a report *builder*: audience tabs, a section
 * editor, a live preview and a delivery panel, all over fixture prose. A
 * report in this system is a run plus a link, so that is what this lists.
 *
 * Issuing one happens on the client's findings screen, where the run being
 * pinned is on the page. A "new report" button here would have to ask which
 * client and which run first, which is the same question that screen has
 * already answered.
 */
export function ReportsScreen({ reports }: { reports: ReportRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(report: ReportRow) {
    if (!report.clientId || busy) return;
    setBusy(report.id);
    setError(null);
    try {
      const response = await fetch(`/api/platform/clients/${encodeURIComponent(report.clientId)}/reports`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: report.id }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error === 'unauthorized' ? 'Your session expired. Sign in again.' : 'The report link could not be turned off. Try again.');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: '-0.015em' }}>
          Reports
        </h1>
        <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13, color: T.inkMuted }}>
          Each one is pinned to the run it was issued from, so a link keeps meaning what it meant
          when it was sent.
        </p>
      </div>

      {reports.length === 0 ? (
        <div
          style={{
            padding: '30px 26px',
            borderRadius: 12,
            border: `1px dashed ${T.ruleStrong}`,
            background: T.surface,
            fontFamily: FONT.sans,
            fontSize: 13.5,
            color: T.inkSoft,
            maxWidth: 520,
            textWrap: 'pretty',
          }}
        >
          None issued yet. Open a client’s findings and issue one from the run you want it to
          report — the link points at that run and no other.
        </div>
      ) : (
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0 }}>
          {reports.map((report) => (
            <li
              key={report.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                padding: '13px 16px',
                borderRadius: 10,
                border: `1px solid ${T.rule}`,
                background: T.surface,
                listStyle: 'none',
                fontFamily: FONT.sans,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 14, fontWeight: 650 }}>
                  {report.title ?? 'Accessibility audit'}
                </span>
                {report.clientId && report.clientName ? (
                  <Link href={`/clients/${report.clientId}`} style={{ fontSize: 12.5, color: T.accent }}>
                    {report.clientName}
                  </Link>
                ) : null}
                {report.audience ? (
                  <span style={{ fontSize: 11.5, color: T.inkMuted }}>for {report.audience}</span>
                ) : null}
              </div>

              <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted }}>
                run {report.requestId}
                {report.run
                  ? ` · ${report.run.mustFix + report.run.shouldFix} confirmed issues · ${report.run.recommendations} recommendations · ${report.run.needsReview} need a person to check · ${scoreLine(report.run.score)}`
                  : ' · run no longer stored'}
                {report.documents
                  ? ` · ${report.documents.documents} document${
                      report.documents.documents === 1 ? '' : 's'
                    }, ${report.documents.withGaps} with gaps`
                  : ''}
              </span>

              <span style={{ fontSize: 12.5 }}>
                {report.shareToken ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                    <a href={`/r/${report.shareToken}`} style={{ color: T.accent }}>
                      Open the shared link ↗
                    </a>
                    {/* Only where the link can actually be turned off. A row
                        whose run is no longer stored has no `clientId` (see
                        `report-view.ts`), and the route needs the run to prove
                        the report is this client's — so the button would do
                        nothing at all, and silence here reads as "revoked". */}
                    {report.clientId ? (
                      <button
                        type="button"
                        onClick={() => void revoke(report)}
                        disabled={busy === report.id}
                        style={{ border: 0, background: 'none', padding: 0, color: T.failDeep, cursor: 'pointer', font: 'inherit' }}
                      >
                        {busy === report.id ? 'Turning off…' : 'Turn off link'}
                      </button>
                    ) : (
                      <span style={{ color: T.inkMuted }}>
                        This link cannot be turned off here — its run is no longer stored.
                      </span>
                    )}
                  </span>
                ) : (
                  // The row stays after revocation rather than disappearing:
                  // "this link was issued and then withdrawn" is part of the
                  // record an auditor may have to account for.
                  <span style={{ color: T.inkMuted }}>
                    Link turned off{report.revokedAt ? ` ${report.revokedAt.slice(0, 10)}` : ''}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error ? <p role="alert" style={{ margin: 0, color: T.failDeep, fontFamily: FONT.sans, fontSize: 12.5 }}>{error}</p> : null}
    </div>
  );
}
