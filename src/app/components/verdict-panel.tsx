'use client';

import { InfoTip, TermLabel } from './info-tip';
import { describeApiError, type GlossaryKey } from './glossary';
import { countBySource, type AuditResult, type Verdict } from './audit-types';

const VERDICTS: Array<{
  key: Verdict;
  glossaryKey: GlossaryKey;
  label: string;
  meaning: string;
  nextStep: string;
  mark: string;
}> = [
  {
    key: 'pass',
    glossaryKey: 'pass',
    label: 'Pass',
    meaning: 'Evidence was complete, and no critical rule-based issues were found.',
    nextStep: 'Nothing here blocks a release.',
    mark: '✓',
  },
  {
    key: 'fail',
    glossaryKey: 'fail',
    label: 'Fail',
    meaning: 'Evidence was complete, and at least one critical rule-based issue was found.',
    nextStep: 'Fix the issues marked "Blocks release" below, then run again.',
    mark: '✕',
  },
  {
    key: 'inconclusive',
    glossaryKey: 'inconclusive',
    label: 'Inconclusive',
    meaning: 'Not enough evidence was captured to judge, so no verdict was issued.',
    nextStep: 'Run again using the demo journey, which captures full evidence.',
    mark: '—',
  },
];

/**
 * Shown before the first run: the three possible outcomes, so the outcome space
 * is understood in advance rather than discovered one verdict at a time.
 */
export function VerdictLegend({ current }: { current?: Verdict }) {
  return (
    <ul className="verdict-legend" aria-label="Possible outcomes">
      {VERDICTS.map((v) => (
        <li
          key={v.key}
          className={`legend-item legend-${v.key}${current === v.key ? ' is-current' : ''}`}
        >
          <span className="legend-mark" aria-hidden="true">
            {v.mark}
          </span>
          <span className="legend-body">
            <span className="legend-label">
              {v.label}
              {current === v.key && <span className="sr-only"> — this run</span>}
            </span>
            <span className="legend-meaning">{v.meaning}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function VerdictPanel({ result }: { result: AuditResult }) {
  const counts = countBySource(result.findings);

  // A transport or policy failure is not a verdict — it means no audit happened.
  if (!result.ok || !result.verdict) {
    const copy = describeApiError(result.error, result.httpStatus);
    return (
      <section className="verdict-panel verdict-error" aria-labelledby="verdict-heading">
        <p className="verdict-eyebrow">The run did not complete</p>
        <h2 id="verdict-heading" className="verdict-word">
          {copy.title}
        </h2>
        <p className="verdict-meaning">{copy.cause}</p>
        <p className="verdict-next">
          <span className="next-label">What to do</span>
          {copy.fix}
        </p>
        {result.error && (
          <p className="verdict-raw">
            <span>Reported as</span> <code>{result.error}</code>
          </p>
        )}
      </section>
    );
  }

  const verdict = VERDICTS.find((v) => v.key === result.verdict)!;

  return (
    <section
      className={`verdict-panel verdict-${verdict.key}`}
      aria-labelledby="verdict-heading"
    >
      <div className="verdict-head">
        <span className="verdict-mark" aria-hidden="true">
          {verdict.mark}
        </span>
        <div>
          <p className="verdict-eyebrow">
            {result.simulated ? 'Practice run — simulated result' : 'Verdict'}
            <InfoTip termKey={result.simulated ? 'chaosDemo' : 'verdict'} />
          </p>
          <h2 id="verdict-heading" className="verdict-word">
            {verdict.label}
          </h2>
        </div>
        {result.durationMs != null && (
          <span className="verdict-duration">
            <TermLabel termKey="duration">{result.durationMs}ms</TermLabel>
          </span>
        )}
      </div>

      <p className="verdict-meaning">{verdict.meaning}</p>
      <p className="verdict-next">
        <span className="next-label">What to do</span>
        {verdict.key === 'fail' && counts.blocking.length > 0
          ? `Fix the ${counts.blocking.length} issue${counts.blocking.length === 1 ? '' : 's'} marked “Blocks release” below, then run again.`
          : verdict.nextStep}
      </p>

      {verdict.key === 'pass' && (
        <p className="verdict-caveat">
          A pass means nothing blocking was detected by the rules that ran — not that the page is
          free of accessibility problems.
        </p>
      )}
    </section>
  );
}
