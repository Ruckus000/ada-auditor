'use client';

import { InfoTip, TermLabel } from './info-tip';
import { countBySource, type AuditResult, type Finding, type Severity } from './audit-types';

const SEVERITY_COPY: Record<Severity, { label: string; mark: string; note: string }> = {
  critical: { label: 'Critical', mark: '▲', note: 'Serious barrier. Fails the build.' },
  major: { label: 'Major', mark: '◆', note: 'Significant problem worth prioritising.' },
  minor: { label: 'Minor', mark: '●', note: 'Small problem. Fix when convenient.' },
  advisory: { label: 'Advisory', mark: '◌', note: 'A suggestion to check by hand.' },
};

function FindingCard({ finding }: { finding: Finding }) {
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

function EvidenceChecklist({ status }: { status: 'complete' | 'degraded' }) {
  // The API reports a single rolled-up status. Under `complete` all three
  // artifacts are guaranteed present; under `degraded` at least one is missing
  // and the response does not say which, so we say exactly that rather than
  // guessing.
  const complete = status === 'complete';
  const items: Array<{ key: 'screenshot' | 'domSnapshot' | 'axTree'; label: string }> = [
    { key: 'screenshot', label: 'Screenshot' },
    { key: 'domSnapshot', label: 'DOM snapshot' },
    { key: 'axTree', label: 'Accessibility tree' },
  ];

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
          ? 'Complete — all three artifacts were captured, so this run could be judged.'
          : 'Incomplete — at least one artifact is missing, which is why the verdict is inconclusive.'}
      </p>
      <ul className="evidence-list">
        {items.map((item) => (
          <li key={item.key} className={complete ? 'artifact is-present' : 'artifact is-unknown'}>
            <span className="artifact-mark" aria-hidden="true">
              {complete ? '✓' : '?'}
            </span>
            <TermLabel termKey={item.key}>{item.label}</TermLabel>
            <span className="artifact-state">{complete ? 'captured' : 'not confirmed'}</span>
          </li>
        ))}
      </ul>
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
              <FindingCard key={`${finding.code}-${i}`} finding={finding} />
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

export function FindingsList({ result }: { result: AuditResult }) {
  const { deterministic, advisory } = countBySource(result.findings);

  return (
    <>
      {result.evidenceStatus && <EvidenceChecklist status={result.evidenceStatus} />}

      <section className="findings-block" aria-labelledby="findings-heading">
        <div className="ledger-heading">
          <h3 id="findings-heading">What we found</h3>
        </div>

        {result.findings.length === 0 ? (
          <div className="findings-empty">
            <p className="empty-headline">No issues found.</p>
            <p className="empty-note">
              This version ships a small rule set, so an empty result means the rules that ran found
              nothing — not that the page is free of accessibility problems. A manual review is
              still worth doing.
            </p>
          </div>
        ) : (
          <>
            {deterministic.length > 0 && (
              <>
                <div className="findings-group">
                  <h4>Rule-based ({deterministic.length})</h4>
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
                  <h4>Advisory ({advisory.length})</h4>
                  <InfoTip termKey="advisory" />
                </div>
                <ul className="findings-list">
                  {advisory.map((finding, i) => (
                    <FindingCard key={`${finding.code}-${i}`} finding={finding} />
                  ))}
                </ul>
              </>
            )}
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
