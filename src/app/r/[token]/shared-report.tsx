import type { SharedReport } from '../../../services/report-view';
import { describePageEvidence } from '../../../services/presentation/page-evidence';
import {
  SCORE_EXPLAINER,
  SCORE_STAT_LABEL,
  scoreStatValue,
} from '../../../services/presentation/verdict';
import { describeCriterion, summariseCriteria } from '../../../services/wcag-reference';
import { documentGapKey } from '../../../services/document-regression';
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
export function SharedReportPage({
  report,
  token,
}: {
  report: SharedReport;
  /** For the download links the documents section renders — they live under
   * this page's own path, so the same token guards page and file alike. */
  token: string;
}) {
  const total = report.pages.reduce((sum, page) => sum + page.findings.length, 0);
  const failed = summariseCriteria(
    report.pages.flatMap((page) => page.findings.flatMap((finding) => finding.wcagCriteria)),
  );

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
          <Stat label={SCORE_STAT_LABEL} value={scoreStatValue(report.run.score)} />
          <Stat label="Must fix" value={String(report.run.mustFix)} />
          <Stat label="Should fix" value={String(report.run.shouldFix)} />
          <Stat label="Pages audited" value={String(report.run.pagesAudited)} />
        </dl>

        <p style={{ margin: 0, fontSize: 12.5, color: T.inkMuted, lineHeight: 1.5 }}>
          {SCORE_EXPLAINER}
        </p>

        <p style={{ margin: 0, fontSize: 13.5, color: T.inkSoft, lineHeight: 1.55 }}>
          {total === 0
            ? 'No barriers were found on any page we walked.'
            : `${total} ${total === 1 ? 'barrier' : 'barriers'} across ${report.pages.length} ${
                report.pages.length === 1 ? 'page' : 'pages'
              }, listed below with the WCAG success criterion each one fails.`}
        </p>
      </section>

      {failed.length > 0 ? (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700 }}>
            Success criteria not met
          </h2>
          <p style={{ margin: '0 0 10px', fontSize: 13, color: T.inkMuted, lineHeight: 1.55 }}>
            A conformance claim is made against criteria, not against rule names, so these are the
            ones this audit found failing. Criteria not listed were not necessarily met — only
            those we could test automatically appear here.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {failed.map((criterion) => (
              <li key={criterion.number} style={{ fontSize: 13.5 }}>
                {criterion.number} {criterion.name}{' '}
                <span style={{ color: T.inkMuted }}>(Level {criterion.level})</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.pages.map((page) => (
        <section key={page.url} style={{ marginTop: 24 }}>
          <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700 }}>
            {page.title ?? page.route}
          </h3>
          <p style={{ margin: '0 0 10px', fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted }}>
            {page.url}
            {/* One phrase, shared with the console and the platform screen.
                A client reading this document must not be told "evidence
                degraded" where the truth is that their server returned 500.

                The exact code is shown here, outside the auth gate, and that
                is a decision rather than an oversight. It is finer-grained
                than the old wording — 403 says "exists and is gated" where 404
                says "gone" — so for a host the reader cannot reach themselves
                this page is a small oracle. Kept anyway: the site is the
                client's own, the token is unguessable and the route is
                `noindex`, and "your server returned 503" is the whole reason
                this slice exists. Coarsening to "served an error" here alone
                is a one-argument change at this call site if that trade ever
                stops being worth it. */}
            {page.evidenceStatus !== 'complete'
              ? ` · ${describePageEvidence(page.evidenceStatus, page.statusCode)}`
              : ''}
          </p>

          {page.findings.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: T.inkMuted }}>
              Nothing found on this page.
            </p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {page.findings.map((finding, index) => (
                <li key={`${finding.code}-${finding.selector ?? index}`} style={{ fontSize: 13.5 }}>
                  {/* On the page a client's legal team reads, the rule's
                      sentence has to come first; `image-alt` is our word for
                      it, not theirs. */}
                  <span style={{ fontWeight: 650 }}>{finding.title ?? finding.code}</span>
                  {finding.title ? (
                    <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted }}>
                      {' '}
                      {finding.code}
                    </span>
                  ) : null}
                  {finding.wcagCriteria.length > 0 ? (
                    <span style={{ color: T.inkMuted }}>
                      {' '}
                      · WCAG {finding.wcagCriteria.map(describeCriterion).join(' · ')}
                    </span>
                  ) : null}
                  {finding.selector ? (
                    <>
                      {' '}
                      <code style={{ fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted }}>
                        {finding.selector}
                      </code>
                    </>
                  ) : null}
                  <Fix label="Fix any one of these" items={finding.fixAnyOf} />
                  <Fix label="Fix all of these" items={finding.fixAllOf} />
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {report.documents ? <DocumentsSection section={report.documents} token={token} /> : null}

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

/**
 * The documents half of the report: the client's document inventory as it
 * stood when this report was ISSUED — a snapshot the issuing route captured,
 * rendered verbatim, never recomputed. The same pinning the footer promises
 * for the audit covers this section.
 *
 * The boundary is stated in words because the page above it carries a
 * verdict: nothing here changes that verdict. Documents are reviewed
 * separately, on their own lifecycle, and their gaps are listed as evidence
 * of what remains — not as findings of the audit run.
 */
function DocumentsSection({
  section,
  token,
}: {
  section: NonNullable<SharedReport['documents']>;
  token: string;
}) {
  const failed = summariseCriteria(
    section.entries.flatMap((entry) => entry.gaps.map(documentGapKey)),
  );

  return (
    <section style={{ marginTop: 30 }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700 }}>Documents</h2>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: T.inkMuted, lineHeight: 1.55 }}>
        Documents linked from the site — PDF and Word — reviewed separately from the page audit
        above. Nothing in this section changes the audit&rsquo;s outcome. Captured{' '}
        <time dateTime={section.capturedAt}>{section.capturedAt.slice(0, 10)}</time>, when this
        report was issued.
      </p>

      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))',
          gap: 12,
          margin: '0 0 12px',
        }}
      >
        <Stat label="On record" value={String(section.totals.documents)} />
        <Stat label="Reviewed" value={String(section.totals.read)} />
        <Stat label="With gaps" value={String(section.totals.withGaps)} />
        <Stat label="Not yet reviewed" value={String(section.totals.unread)} />
      </dl>

      {failed.length > 0 ? (
        <p style={{ margin: '0 0 10px', fontSize: 13, color: T.inkMuted, lineHeight: 1.55 }}>
          Criteria found failing in reviewed documents:{' '}
          {failed.map((criterion) => `${criterion.number} ${criterion.name}`).join(' · ')}.
        </p>
      ) : null}

      {section.entries.length === 0 ? (
        <p style={{ margin: 0, fontSize: 13, color: T.inkMuted }}>
          No document had been reviewed when this report was issued.
        </p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {section.entries.map((entry) => (
            <li key={entry.url} style={{ fontSize: 13.5 }}>
              <span style={{ fontFamily: FONT.mono, fontSize: 12 }}>{entry.url}</span>{' '}
              <span style={{ color: T.inkMuted }}>
                · {entry.kind === 'pdf' ? 'PDF' : 'Word'} ·{' '}
                {entry.readBy === 'conversion' ? 'converted' : 'reviewed'}{' '}
                <time dateTime={entry.readAt}>{entry.readAt.slice(0, 10)}</time> ·{' '}
                {entry.tagged ? 'tagged' : 'not tagged'} · {entry.pages}{' '}
                {entry.pages === 1 ? 'page' : 'pages'}
              </span>
              {entry.conversionId ? (
                <>
                  {' '}
                  <a href={`/r/${token}/documents/${entry.conversionId}`} style={{ fontSize: 12.5 }}>
                    Download the remediated file
                  </a>
                </>
              ) : null}
              {entry.gaps.length === 0 ? (
                <p style={{ margin: '2px 0 0', fontSize: 12.5, color: T.inkSoft }}>
                  No machine-detectable gaps.
                </p>
              ) : (
                <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
                  {entry.gaps.map((gap) => (
                    <li key={gap} style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.5 }}>
                      {gap}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The remediation, in the engine's words.
 *
 * The two groups stay apart here for the same reason they do on the console
 * screen: any one entry in the first clears the finding, and merging them
 * would ask a client's developer to do three things when one is the fix.
 */
function Fix({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div style={{ margin: '4px 0 0' }}>
      <span style={{ fontSize: 12, fontWeight: 650, color: T.inkSoft }}>{label}</span>
      <ul style={{ margin: '2px 0 0', paddingLeft: 18 }}>
        {items.map((item) => (
          <li key={item} style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.5 }}>
            {item}
          </li>
        ))}
      </ul>
    </div>
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
