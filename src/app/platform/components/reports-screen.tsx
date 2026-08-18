import Link from 'next/link';
import type { ReportRow } from '../../../services/report-view';
import { FONT, T } from '../lib/tokens';

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
                  ? ` · ${report.run.mustFix} must fix · score ${report.run.score ?? '—'}`
                  : ' · run no longer stored'}
              </span>

              <span style={{ fontSize: 12.5 }}>
                {report.shareToken ? (
                  <a href={`/r/${report.shareToken}`} style={{ color: T.accent }}>
                    Open the shared link ↗
                  </a>
                ) : (
                  // The row stays after revocation rather than disappearing:
                  // "this link was issued and then withdrawn" is part of the
                  // record an auditor may have to account for.
                  <span style={{ color: T.inkMuted }}>
                    Link revoked{report.revokedAt ? ` ${report.revokedAt.slice(0, 10)}` : ''}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
