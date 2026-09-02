'use client';

import { compareAsks } from '../../../../services/document-state';
import { conformanceLine } from '../../../../services/presentation/document-verdict';
import { T } from '../../lib/tokens';
import { noteStyle, SummaryView, type ActionOutcome, type Summary } from './document-shared';

/**
 * What one run did to a document — rendered ONCE, as a diff against the
 * reading before it, in place of a second summary box stacked under the
 * first with nothing saying which is current.
 *
 * The diff is by ask id: what this run closed, what stayed open, what it
 * surfaced. Gaps still render through `SummaryView` beneath, verbatim.
 */
export function DocumentRunResult({
  outcome,
  previous,
}: {
  outcome: ActionOutcome & { state: 'done' };
  previous: Summary | undefined;
}) {
  const diff = compareAsks(previous?.asks, outcome.summary.asks);
  const before = previous === undefined ? null : conformanceLine(previous);
  const after = conformanceLine(outcome.summary);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} role="status">
      <p style={{ ...noteStyle, color: T.ink }}>
        {outcome.converted ? 'Delivered a tagged PDF.' : 'Read the document.'}
        {outcome.summary.title === 'transcribed'
          ? ' The title was transcribed from the document’s own first heading.'
          : ''}
        {outcome.summary.declared
          ? ` Written from a person’s answers: ${outcome.summary.declared.figures} description${
              outcome.summary.declared.figures === 1 ? '' : 's'
            }${outcome.summary.declared.language ? ' and the language' : ''}.`
          : ''}{' '}
        {outcome.href && outcome.filename ? (
          <a href={outcome.href} download={outcome.filename}>
            Download {outcome.filename}
          </a>
        ) : null}
      </p>
      {previous !== undefined ? (
        <p style={noteStyle}>
          Against the previous reading: {diff.closed.length} item
          {diff.closed.length === 1 ? '' : 's'} closed · {diff.remaining.length} still open ·{' '}
          {diff.added.length} new
          {before === after ? ` · ${after}` : ` · was “${before}”, now “${after}”`}
        </p>
      ) : null}
      <SummaryView summary={outcome.summary} />
    </div>
  );
}
