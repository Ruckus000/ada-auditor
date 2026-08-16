'use client';

import { InfoTip, TermLabel } from './info-tip';
import {
  countBySource,
  groupFindingsByPage,
  type AuditPage,
  type AuditResult,
  type Finding,
  type Severity,
} from './audit-types';

const SEVERITY_COPY: Record<Severity, { label: string; mark: string; note: string }> = {
  critical: { label: 'Critical', mark: '▲', note: 'Serious barrier. Fails the build.' },
  major: { label: 'Major', mark: '◆', note: 'Significant problem worth prioritising.' },
  minor: { label: 'Minor', mark: '●', note: 'Small problem. Fix when convenient.' },
  advisory: { label: 'Advisory', mark: '◌', note: 'A suggestion to check by hand.' },
};

/**
 * `showPage` is for lists that are not already grouped by page — the
 * regression diff, where "a new critical appeared" is only actionable once you
 * know which of five screens it appeared on.
 */
function FindingCard({ finding, showPage }: { finding: Finding; showPage?: boolean }) {
  const severity = SEVERITY_COPY[finding.severity];
  const blocks = finding.source === 'deterministic' && finding.severity === 'critical';

  return (
    <li className={`finding finding-${finding.severity}`}>
      <span className={`sev-badge sev-${finding.severity}`}>
        {/* Shape and word both carry the meaning — never colour alone. */}
        <span className="sev-mark" aria-hidden="true">
          {severity.mark}
        </span>
        {severity.label}
      </span>

      <div className="finding-body">
        {/* Regression entries carry no message, so the rule code becomes the
            headline rather than leaving an empty line. */}
        <p className="finding-message">{finding.message ?? finding.code}</p>
        <p className="finding-meta">
          {finding.message && <code className="finding-code">{finding.code}</code>}
          {showPage && finding.pageUrl && (
            <span className="finding-page">on {finding.pageUrl}</span>
          )}
          {finding.confidence != null && (
            <span className="finding-confidence">
              {Math.round(finding.confidence * 100)}% confidence
            </span>
          )}
          <span className={blocks ? 'gate-flag gate-blocks' : 'gate-flag gate-advisory'}>
            {blocks ? 'Blocks release' : 'Does not block release'}
            <InfoTip termKey={blocks ? 'blocksCi' : 'advisory'} />
          </span>
        </p>
        <p className="finding-note">{severity.note}</p>
      </div>
    </li>
  );
}

const ARTIFACT_ITEMS: Array<{
  key: 'screenshot' | 'domSnapshot' | 'axTree';
  label: string;
  /** Field on the page's reported artifact set. */
  stored: 'screenshot' | 'dom' | 'axTree';
  /** The `kind` segment this artifact is served under. */
  path: string;
}> = [
  { key: 'screenshot', label: 'Screenshot', stored: 'screenshot', path: 'screenshot' },
  { key: 'domSnapshot', label: 'DOM snapshot', stored: 'dom', path: 'dom' },
  { key: 'axTree', label: 'Accessibility tree', stored: 'axTree', path: 'axtree' },
];

/**
 * What was captured for one page, and a way to open it.
 *
 * Two sources, in order of honesty. When the run reports which artifacts it
 * actually stored, that is used and each present one becomes a link — the
 * evidence a finding rests on is now reachable from the finding. When it does
 * not (an error response, or a run recorded before this existed), we fall back
 * to the rolled-up status, which says "one of these is missing" without saying
 * which, and the checklist says exactly that rather than guessing.
 */
function ArtifactChecklist({
  status,
  page,
  requestId,
  position,
}: {
  status: 'complete' | 'degraded';
  page?: AuditPage;
  requestId?: string;
  position?: number;
}) {
  const stored = page?.artifacts;
  const complete = status === 'complete';
  const linkable = requestId !== undefined && position !== undefined;

  return (
    <ul className="evidence-list">
      {ARTIFACT_ITEMS.map((item) => {
        const present = stored ? stored[item.stored] : complete;
        const known = Boolean(stored) || complete;

        return (
          <li
            key={item.key}
            className={present ? 'artifact is-present' : known ? 'artifact' : 'artifact is-unknown'}
          >
            <span className="artifact-mark" aria-hidden="true">
              {present ? '✓' : known ? '—' : '?'}
            </span>
            <TermLabel termKey={item.key}>{item.label}</TermLabel>
            {present && linkable ? (
              <a
                className="artifact-state"
                href={`/api/audit/runs/${requestId}/artifacts/${position}/${item.path}`}
                // A DOM snapshot is markup from someone else's site, served as
                // an attachment so the browser cannot execute it on our origin.
                // Opening it in a new tab keeps the run result on screen.
                target="_blank"
                rel="noreferrer"
              >
                {/*
                  Named per page, or every row is another "View" in a screen
                  reader's list of links — and the new tab is announced rather
                  than sprung. axe does not flag an unannounced `target=_blank`
                  and it is not an AA failure, which is exactly why it needs
                  saying here: this product cannot ship the accessibility bug
                  its own engine would not catch.
                */}
                View
                <span className="sr-only">
                  {' '}
                  {item.label} for {page?.route ?? 'this page'}, opens in a new tab
                </span>
              </a>
            ) : (
              <span className="artifact-state">
                {present ? 'captured' : known ? 'not captured' : 'not confirmed'}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A page's URL, shown only when it says something the title does not. */
function PageLabel({ page }: { page: AuditPage }) {
  // A page with no title still needs a name here, and its route is the only
  // honest one available. Without this the heading was empty for exactly the
  // pages a titling violation was reported against.
  const label = page.title ?? page.route;

  return (
    <>
      <span className="page-title">{label}</span>
      {page.route !== label && <span className="page-route">{page.route}</span>}
    </>
  );
}

function EvidenceBlock({ result }: { result: AuditResult }) {
  const status = result.evidenceStatus;
  if (!status) return null;

  const pages = result.pages ?? [];
  const complete = status === 'complete';

  return (
    <section className="evidence-block" aria-labelledby="evidence-heading">
      {/* The tip sits beside the heading, never inside it, so the heading's
          accessible name stays clean. */}
      <div className="ledger-heading">
        <h3 id="evidence-heading">Evidence</h3>
        <InfoTip termKey="evidence" />
      </div>

      <p className={`evidence-status evidence-${status}`}>
        {complete
          ? pages.length > 1
            ? `Complete — all three artifacts were captured on each of the ${pages.length} pages, so this run could be judged.`
            : 'Complete — all three artifacts were captured, so this run could be judged.'
          : 'Incomplete — at least one artifact is missing, which is why the verdict is inconclusive. A single page short of evidence makes the whole run inconclusive.'}
      </p>

      {pages.length > 0 ? (
        <ul className="evidence-pages">
          {pages.map((page, index) => (
            <li key={page.url} className="evidence-page">
              <p className="evidence-page-name">
                <PageLabel page={page} />
                {page.evidenceStatus && (
                  <span className={`page-evidence page-evidence-${page.evidenceStatus}`}>
                    {page.evidenceStatus === 'complete' ? 'complete' : 'incomplete'}
                  </span>
                )}
              </p>
              <ArtifactChecklist
                status={page.evidenceStatus ?? status}
                page={page}
                requestId={result.requestId}
                position={index}
              />
            </li>
          ))}
        </ul>
      ) : (
        // An error response, or a shape without pages. The rolled-up status is
        // all there is, so do not invent a per-page breakdown.
        <ArtifactChecklist status={status} />
      )}

      {result.truncatedPages != null && result.truncatedPages > 0 && (
        <p className="evidence-truncated" role="status">
          This run stopped at its page limit and did not audit {result.truncatedPages} further{' '}
          {result.truncatedPages === 1 ? 'page' : 'pages'}. Anything on{' '}
          {result.truncatedPages === 1 ? 'it' : 'them'} is unknown, not clean.
        </p>
      )}
    </section>
  );
}

function RegressionBlock({ result }: { result: AuditResult }) {
  const regression = result.regression;
  if (!regression) return null;

  const headline =
    regression.status === 'fail'
      ? 'Worse than last time — a new critical issue appeared.'
      : regression.status === 'warn'
        ? 'Slightly worse than last time — new issues appeared.'
        : regression.resolvedFindings.length > 0
          ? 'Better than last time — issues were resolved and nothing new appeared.'
          : 'No change since the last run.';

  return (
    <section className="regression-block" aria-labelledby="regression-heading">
      <div className="ledger-heading">
        <h3 id="regression-heading">Compared to last run</h3>
        <InfoTip termKey="regression" />
      </div>
      <p className={`regression-headline regression-${regression.status}`}>{headline}</p>

      <ul className="regression-counts">
        <li>
          <strong>{regression.newFindings.length}</strong> new
        </li>
        <li>
          <strong>{regression.resolvedFindings.length}</strong> resolved
        </li>
        <li>
          <strong>{regression.unchangedCount}</strong> unchanged
        </li>
      </ul>

      {regression.newFindings.length > 0 && (
        <>
          <p className="regression-sub">New since last run</p>
          <ul className="findings-list">
            {regression.newFindings.map((finding, i) => (
              <FindingCard key={`${finding.code}-${i}`} finding={finding} showPage />
            ))}
          </ul>
        </>
      )}

      {regression.baselineRequestId && (
        <p className="regression-baseline">
          Compared against run <code>{regression.baselineRequestId}</code>
        </p>
      )}
    </section>
  );
}

/**
 * One page's findings, split into rule-based and advisory.
 *
 * The two kinds mean different things — one is proof, one is a judgement call
 * that never gates a release — so they stay visually separate inside a page
 * rather than being interleaved.
 */
function PageFindings({ group }: { group: { page: AuditPage | null; findings: Finding[] } }) {
  const { deterministic, advisory } = countBySource(group.findings);

  return (
    <section className="page-findings" aria-label={group.page ? group.page.title : 'Across the journey'}>
      <div className="page-findings-head">
        <h4 className="page-findings-title">
          {group.page ? (
            <PageLabel page={group.page} />
          ) : (
            // The advisory pass reads the whole journey at once, so its
            // findings belong to no single page. Saying so beats filing them
            // under a page they were not derived from.
            <span className="page-title">Across the journey</span>
          )}
        </h4>
        <span className="page-findings-count">
          {group.findings.length} {group.findings.length === 1 ? 'issue' : 'issues'}
        </span>
      </div>

      {deterministic.length > 0 && (
        <>
          <div className="findings-group">
            <h5>Rule-based ({deterministic.length})</h5>
            <InfoTip termKey="deterministic" />
          </div>
          <ul className="findings-list">
            {deterministic.map((finding, i) => (
              <FindingCard key={`${finding.code}-${i}`} finding={finding} />
            ))}
          </ul>
        </>
      )}

      {advisory.length > 0 && (
        <>
          <div className="findings-group">
            <h5>Advisory ({advisory.length})</h5>
            <InfoTip termKey="advisory" />
          </div>
          <ul className="findings-list">
            {advisory.map((finding, i) => (
              <FindingCard key={`${finding.code}-${i}`} finding={finding} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Pages the run audited and found nothing on — worth saying out loud. */
function CleanPages({ result, groups }: { result: AuditResult; groups: Array<{ page: AuditPage | null }> }) {
  const withFindings = new Set(groups.map((g) => g.page?.url).filter(Boolean));
  const clean = (result.pages ?? []).filter((page) => !withFindings.has(page.url));

  if (clean.length === 0) return null;

  return (
    <p className="pages-clean">
      No issues on {clean.map((page) => page.title).join(', ')}.
    </p>
  );
}

export function FindingsList({ result }: { result: AuditResult }) {
  const groups = groupFindingsByPage(result);
  const pagesAudited = result.pages?.length ?? 0;

  return (
    <>
      <EvidenceBlock result={result} />

      <section className="findings-block" aria-labelledby="findings-heading">
        <div className="ledger-heading">
          <h3 id="findings-heading">What we found</h3>
        </div>

        {pagesAudited > 0 && (
          <p className="findings-scope">
            {pagesAudited} {pagesAudited === 1 ? 'page' : 'pages'} audited — every page the journey
            walked through, not just the last one.
          </p>
        )}

        {result.findings.length === 0 ? (
          <div className="findings-empty">
            <p className="empty-headline">No issues found.</p>
            <p className="empty-note">
              This version ships a small rule set, so an empty result means the rules that ran found
              nothing — not that the {pagesAudited === 1 ? 'page is' : 'pages are'} free of
              accessibility problems. A manual review is still worth doing.
            </p>
          </div>
        ) : (
          <>
            {groups.map((group, i) => (
              <PageFindings key={group.page?.url ?? `journey-${i}`} group={group} />
            ))}
            <CleanPages result={result} groups={groups} />
          </>
        )}
      </section>

      <RegressionBlock result={result} />
    </>
  );
}

export function RunDetails({
  result,
  onCopyTrace,
  copied,
}: {
  result: AuditResult;
  onCopyTrace: () => void;
  copied: boolean;
}) {
  return (
    <section className="details-block" aria-labelledby="details-heading">
      <div className="ledger-heading">
        <h3 id="details-heading">Run details</h3>
      </div>
      <dl className="details-grid">
        {result.journeyId && (
          <>
            <TermLabel termKey="journeyId" as="dt">
              Journey
            </TermLabel>
            <dd>{result.journeyId}</dd>
          </>
        )}
        {result.environment && (
          <>
            <TermLabel termKey="environment" as="dt">
              Environment
            </TermLabel>
            <dd>{result.environment}</dd>
          </>
        )}
        {result.platform && (
          <>
            <TermLabel termKey="platformHint" as="dt">
              Platform
            </TermLabel>
            <dd>{result.platform}</dd>
          </>
        )}
        {result.requestId && (
          <>
            <TermLabel termKey="traceId" as="dt">
              Trace ID
            </TermLabel>
            <dd className="trace-row">
              <code>{result.requestId}</code>
              <button type="button" className="copy-btn" onClick={onCopyTrace}>
                {copied ? 'Copied' : 'Copy'}
                <span className="sr-only"> trace ID</span>
              </button>
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
