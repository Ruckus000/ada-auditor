import type { SharedReport } from '../../../services/report-view';
import { FONT, T } from '../../platform/lib/tokens';

/**
 * The shared document itself.
 *
 * Every number here comes from the run the report pinned, so this page says
 * the same thing next month that it said the day it was sent.
 *
 * Triage is not applied. A dismissal is an internal decision with an internal
 * justification: publishing it would leak the note, and hiding the finding
 * because of it would make this document disagree with the audit it claims to
 * report.
 */
export function SharedReportPage({ report }: { report: SharedReport }) {
  const total = report.pages.reduce((sum, page) => sum + page.findings.length, 0);

  return (
    <main
      style={{
        maxWidth: 860,
        margin: '0 auto',
        padding: '40px clamp(16px,4vw,32px) 64px',
        fontFamily: FONT.sans,
        color: T.ink,
        background: T.surface,
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 25, fontWeight: 700, letterSpacing: '-0.02em' }}>
          {report.title}
        </h1>
        <p style={{ margin: 0, fontSize: 13.5, color: T.inkMuted }}>
          {report.clientName} · audit of{' '}
          <time dateTime={report.run.createdAt}>{report.run.createdAt.slice(0, 10)}</time>
          {report.issuedBy ? <> · issued by {report.issuedBy}</> : null}
        </p>
        <p style={{ margin: 0, fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted }}>
          run {report.run.requestId}
        </p>
      </header>

      <section style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>What we found</h2>

        {report.run.evidenceStatus !== 'complete' ? (
          <p
            style={{
              margin: 0,
              padding: '12px 15px',
              borderRadius: 9,
              background: T.surfaceSunk,
              border: `1px solid ${T.rule}`,
              fontSize: 13.5,
              lineHeight: 1.55,
            }}
          >
            Evidence for this audit was <strong>{report.run.evidenceStatus}</strong>. The result is
            inconclusive rather than a pass or a fail, and what follows covers only the pages we
            could see in full.
          </p>
        ) : null}

        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))',
            gap: 12,
            margin: 0,
          }}
        >
          <Stat label="Score" value={report.run.score === null ? '—' : String(report.run.score)} />
          <Stat label="Must fix" value={String(report.run.mustFix)} />
          <Stat label="Should fix" value={String(report.run.shouldFix)} />
          <Stat label="Pages audited" value={String(report.run.pagesAudited)} />
        </dl>

        <p style={{ margin: 0, fontSize: 13.5, color: T.inkSoft, lineHeight: 1.55 }}>
          {total === 0
            ? 'No barriers were found on any page we walked.'
            : `${total} ${total === 1 ? 'barrier' : 'barriers'} across ${report.pages.length} ${
                report.pages.length === 1 ? 'page' : 'pages'
              }, listed below with the WCAG success criterion each one fails.`}
        </p>
      </section>

      {report.pages.map((page) => (
        <section key={page.url} style={{ marginTop: 24 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>
            {page.title ?? page.route}
          </h3>
          <p style={{ margin: '0 0 10px', fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted }}>
            {page.url}
            {page.evidenceStatus !== 'complete' ? ` · evidence ${page.evidenceStatus}` : ''}
          </p>

          {page.findings.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: T.inkMuted }}>
              Nothing found on this page.
            </p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {page.findings.map((finding, index) => (
                <li key={`${finding.code}-${finding.selector ?? index}`} style={{ fontSize: 13.5 }}>
                  <span style={{ fontFamily: FONT.mono, fontWeight: 650 }}>{finding.code}</span>
                  {finding.wcagCriteria.length > 0 ? (
                    <span style={{ color: T.inkMuted }}> · WCAG {finding.wcagCriteria.join(', ')}</span>
                  ) : null}
                  {finding.selector ? (
                    <>
                      {' '}
                      <code style={{ fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted }}>
                        {finding.selector}
                      </code>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      <footer
        style={{
          marginTop: 34,
          paddingTop: 16,
          borderTop: `1px solid ${T.rule}`,
          fontSize: 12,
          color: T.inkMuted,
          lineHeight: 1.6,
        }}
      >
        This page reports one audit, fixed at the moment it ran. It does not update, which is why a
        link to it still means what it meant when it was sent.
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 10,
        border: `1px solid ${T.rule}`,
        background: T.surfaceSunk,
      }}
    >
      <dt style={{ fontSize: 11.5, color: T.inkMuted, letterSpacing: '0.03em' }}>
        {label.toUpperCase()}
      </dt>
      <dd style={{ margin: '3px 0 0', fontSize: 22, fontWeight: 700 }}>{value}</dd>
    </div>
  );
}
