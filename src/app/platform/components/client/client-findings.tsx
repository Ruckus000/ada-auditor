import type { DisplaySeverity } from '../../../../services/presentation/severity';
import type { FindingView, FindingsView, PageFindings } from '../../../../services/findings-view';
import { describeCriterion } from '../../../../services/wcag-reference';
import { FONT, T } from '../../lib/tokens';
import { Empty } from './client-overview';
import { IssueReport } from './issue-report';
import { TriageControl } from './triage-control';

/**
 * What the last run found, page by page.
 *
 * The screen this replaces had a plain-language title, an explanation, a code
 * fix and an effort estimate for every finding — all hand-written for eight
 * fictional clients. A run stores a rule code, a severity, the WCAG criteria,
 * a selector, the offending HTML and a help URL, so that is what is here. The
 * missing prose is a real gap and stated as one, not filled with invention.
 *
 * A Server Component. The only interactive part is `TriageControl`, which is a
 * client component on its own rather than a `'use client'` at the top of this
 * file — that would ship every finding on the page to the browser twice.
 */
export function ClientFindings({ view }: { view: FindingsView }) {
  if (!view.run) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>Findings</h2>
        <Empty
          title="Nothing audited yet"
          body="Findings appear here after the first run against one of this client's journeys."
          action={{ href: `/clients/${view.clientId}/journeys`, label: 'See the journeys' }}
        />
      </div>
    );
  }

  const total = view.pages.reduce((sum, page) => sum + page.findings.length, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>Findings</h2>
        <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}>
          {view.journeyName} · {new Date(view.run.createdAt).toISOString().slice(0, 10)} ·{' '}
          <span style={{ fontFamily: FONT.mono }}>{view.run.requestId}</span>
        </p>
      </div>

      {view.run.evidenceStatus !== 'complete' ? (
        <p
          style={{
            margin: 0,
            padding: '11px 14px',
            borderRadius: 9,
            background: T.surfaceSunk,
            border: `1px solid ${T.rule}`,
            fontFamily: FONT.sans,
            fontSize: 13,
            color: T.inkSoft,
          }}
        >
          Evidence for this run was <strong>{view.run.evidenceStatus}</strong>. This list covers
          only what we could actually see, so it is not a clean bill of health for anything missing
          from it.
        </p>
      ) : null}

      <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13, color: T.inkSoft }}>
        {total === 0
          ? 'Nothing found on any page walked.'
          : `${total} across ${view.pages.length} ${view.pages.length === 1 ? 'page' : 'pages'} — ` +
            `${view.counts.must} must fix, ${view.counts.should} should fix, ` +
            `${view.counts.nice} nice to fix, ${view.counts.review} to review.`}
      </p>

      <IssueReport clientId={view.clientId} requestId={view.run.requestId} />

      {view.pages.map((page) => (
        <PageSection key={page.url} page={page} clientId={view.clientId} />
      ))}

      {view.advisory.length > 0 ? (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Advisory</h3>
          <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}>
            Judgements a rule engine cannot make, produced once over the whole journey. They never
            affect the verdict.
          </p>
          {view.advisory.map((finding) => (
            <FindingRow key={finding.key} finding={finding} clientId={view.clientId} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function PageSection({ page, clientId }: { page: PageFindings; clientId: string }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{page.title ?? page.route}</h3>
        <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted }}>{page.url}</span>
        {page.evidenceStatus !== 'complete' ? (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 999,
              background: '#f1eef6',
              border: '1px solid #cfc5e0',
              fontFamily: FONT.sans,
              fontSize: 11,
              fontWeight: 650,
              color: '#4b3f68',
            }}
          >
            evidence {page.evidenceStatus}
          </span>
        ) : null}
      </div>

      {page.findings.length === 0 ? (
        <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}>
          Nothing found on this page.
        </p>
      ) : (
        page.findings.map((finding) => (
          <FindingRow key={finding.key} finding={finding} clientId={clientId} pageUrl={page.url} />
        ))
      )}
    </section>
  );
}

const SEVERITY_LABEL: Record<DisplaySeverity, string> = {
  must: 'MUST FIX',
  should: 'SHOULD FIX',
  nice: 'NICE TO FIX',
  review: 'REVIEW',
  advisory: 'ADVISORY',
};

const SEVERITY_COLOR: Record<DisplaySeverity, string> = {
  must: '#96231c',
  should: '#7a4e0a',
  nice: '#37507e',
  review: '#4b3f68',
  advisory: '#4b3f68',
};

function FindingRow({
  finding,
  clientId,
  pageUrl,
}: {
  finding: FindingView;
  clientId: string;
  pageUrl?: string;
}) {
  const dimmed = finding.triage !== null;

  return (
    <article
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        padding: '13px 16px',
        borderRadius: 10,
        // A dismissed finding is kept visible rather than hidden: the decision
        // to ignore a barrier is itself something an auditor has to be able to
        // review. It is set back with a tint and a rule rather than with
        // `opacity`, which our own engine caught failing contrast on the code
        // snippet — an accessibility auditor cannot dim text below 4.5:1 to
        // say "this one matters less".
        border: `1px solid ${dimmed ? T.ruleFaint : T.rule}`,
        borderLeft: dimmed ? `3px solid ${T.ruleStrong}` : `1px solid ${T.rule}`,
        background: dimmed ? T.surfaceSunk : T.surface,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span
          style={{
            fontFamily: FONT.sans,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.06em',
            color: SEVERITY_COLOR[finding.severity],
          }}
        >
          {SEVERITY_LABEL[finding.severity]}
        </span>
        {/* The rule's own sentence leads, and the code follows it. `image-alt`
            is the stable identity a developer greps for; "Images must have
            alternate text" is what anyone else needs to read first. Older runs
            have no title, so the code leads for those rather than a blank. */}
        <span style={{ fontFamily: FONT.sans, fontSize: 13.5, fontWeight: 650, color: T.ink }}>
          {finding.title ?? finding.code}
        </span>
        {finding.title ? (
          <span style={{ fontFamily: FONT.mono, fontSize: 12, color: T.inkMuted }}>
            {finding.code}
          </span>
        ) : null}
        <span style={{ fontFamily: FONT.sans, fontSize: 11.5, color: T.inkMuted }}>
          {finding.status}
        </span>
        {finding.wcagCriteria.length > 0 ? (
          <span style={{ fontFamily: FONT.sans, fontSize: 11.5, color: T.inkMuted }}>
            {/* The criterion's name, not just its number. `1.4.3` means
                nothing to most people reading a finding, and the name is a
                quoted fact rather than authored prose. */}
            WCAG {finding.wcagCriteria.map(describeCriterion).join(' · ')}
          </span>
        ) : null}
      </div>

      {finding.message ? (
        <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13.5, color: T.inkSoft }}>
          {finding.message}
        </p>
      ) : null}

      {finding.selector ? (
        <code
          style={{
            fontFamily: FONT.mono,
            fontSize: 11.5,
            color: T.inkMuted,
            wordBreak: 'break-all',
          }}
        >
          {finding.selector}
        </code>
      ) : null}

      {finding.htmlSnippet ? (
        <pre
          style={{
            margin: 0,
            padding: '8px 10px',
            borderRadius: 7,
            background: T.surfaceSunk,
            border: `1px solid ${T.ruleFaint}`,
            fontFamily: FONT.mono,
            fontSize: 11.5,
            color: T.inkSoft,
            overflowX: 'auto',
          }}
        >
          {finding.htmlSnippet}
        </pre>
      ) : null}

      {finding.triageNote ? (
        <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 12, color: T.inkMuted }}>
          {finding.triage === 'assigned' ? 'Assigned' : 'Dismissed'}: {finding.triageNote}
        </p>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {finding.helpUrl ? (
          <a
            href={finding.helpUrl}
            rel="noreferrer noopener"
            target="_blank"
            style={{ fontFamily: FONT.sans, fontSize: 12, color: T.accent }}
          >
            What this rule checks ↗
          </a>
        ) : null}
        <TriageControl clientId={clientId} finding={finding} pageUrl={pageUrl} />
      </div>
    </article>
  );
}
