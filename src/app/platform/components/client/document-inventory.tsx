'use client';

import { Fragment, useState } from 'react';
import { DOCUMENT_STATES, type DocumentState } from '../../../../services/document-state';
import {
  conformanceLine,
  documentStateLabel,
  documentStateNote,
} from '../../../../services/presentation/document-verdict';
import { documentStateChip } from '../../lib/verdict-chip';
import { FONT, T } from '../../lib/tokens';
import { Pill, TableShell } from '../ui';
import { DocumentRunResult } from './document-run-result';
import {
  buttonStyle,
  disabledStyle,
  noteStyle,
  pathOf,
  SummaryView,
  type ActionOutcome,
  type ClientDocument,
  type StateCounts,
} from './document-shared';

/**
 * The inventory as a work system: one row per document, one state each, one
 * primary action, and counts by state across everything on record.
 *
 * A real `<table>` rather than the portfolio's button-row grid: these rows
 * carry several controls, and a row that is itself a button with buttons
 * inside it is the nested-interactive defect this product's own engine
 * reports.
 *
 * A Word document that is the SOURCE of a PDF on record folds under that PDF
 * — converting the source is that PDF's remediation, and two rows for one
 * remediation is how the delivered file went missing from the row an
 * operator was looking at.
 */

const cellStyle = {
  padding: '10px 14px',
  borderBottom: `1px solid ${T.rule}`,
  verticalAlign: 'top',
  fontFamily: FONT.sans,
  fontSize: 12.5,
  color: T.ink,
} as const;

const headStyle = {
  ...cellStyle,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.07em',
  color: T.inkMuted,
  background: T.paperDeep,
  textAlign: 'left',
} as const;

/**
 * Where a document lives, as an operator should read it: the bare path when
 * it sits on the same host as the page that linked it, host and path when it
 * does not. Website-builder platforms host every document on their own CDN —
 * measured on a real municipal site — so a bare path would routinely hide
 * where the client's documents actually are.
 */
function documentLabel(doc: ClientDocument): string {
  try {
    const url = new URL(doc.url);
    const sameHost =
      doc.foundOn === undefined || url.hostname === new URL(doc.foundOn).hostname;
    return sameHost ? `${url.pathname}${url.search}` : `${url.hostname}${url.pathname}${url.search}`;
  } catch {
    return doc.url;
  }
}

/**
 * The row's provenance line: kind, where it was found, and the latest word
 * on record. Dates as the date half of the ISO stamp — stable across
 * locales, so the server-rendered and hydrated trees agree.
 */
function statusLine(doc: ClientDocument): string {
  const parts = [
    doc.kind === 'pdf' ? 'PDF' : 'Word',
    doc.source === 'upload' ? 'uploaded' : `found on ${pathOf(doc.foundOn ?? '')}`.trim(),
    `seen ${doc.lastSeenAt.slice(0, 10)}`,
  ];
  if (doc.latestInspection) {
    // A count, never a verdict: the verdict, with its scope beside it, is the
    // reading itself, one click away.
    const gaps = doc.latestInspection.summary.gaps.length;
    parts.push(
      `inspected ${doc.latestInspection.inspectedAt.slice(0, 10)} — ${gaps} gap${gaps === 1 ? '' : 's'}`,
    );
  }
  if (doc.latestConversion) {
    parts.push(`converted ${doc.latestConversion.convertedAt.slice(0, 10)}`);
  }
  return parts.join(' · ');
}

function latestSummary(doc: ClientDocument) {
  const inspection = doc.latestInspection;
  const conversion = doc.latestConversion;
  if (inspection && conversion) {
    return conversion.convertedAt > inspection.inspectedAt ? conversion : inspection;
  }
  return conversion ?? inspection;
}

function regressionWords(regression: NonNullable<ClientDocument['regression']>): string {
  if (regression.status === 'incomparable') {
    return 'instrument changed since the last reading — not comparable';
  }
  return `since last reading: ${regression.newGaps.length} new, ${regression.resolvedGaps.length} resolved`;
}

export function DocumentInventory({
  documents,
  counts,
  stateFilter,
  onStateFilter,
  converterAvailable,
  outcomes,
  onInspect,
  onConvert,
  documentsPath,
  inventoryHref,
}: {
  documents: ClientDocument[];
  counts: StateCounts | null;
  stateFilter: DocumentState | undefined;
  onStateFilter: (state: DocumentState | undefined) => void;
  converterAvailable: boolean;
  /** Keyed by the URL the action ran on — a paired PDF reads its source's. */
  outcomes: Record<string, ActionOutcome>;
  onInspect: (doc: ClientDocument) => void;
  onConvert: (doc: Pick<ClientDocument, 'url' | 'foundOn'>) => void;
  documentsPath: string;
  /** The inventory page's own path — the workbench lives one segment under it. */
  inventoryHref: string;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // A source folds under the PDF it produces; the PDF row names it.
  const sourceIds = new Set(documents.flatMap((doc) => (doc.sourceAvailable ? [doc.sourceAvailable.id] : [])));
  const rows = documents.filter((doc) => !sourceIds.has(doc.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {counts ? (
        <p style={{ ...noteStyle, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {/* Each count is the filter for its state. `aria-pressed` says which
              one is on; "all" is the absence of a filter. */}
          <button
            type="button"
            aria-pressed={stateFilter === undefined}
            onClick={() => onStateFilter(undefined)}
            style={{ ...buttonStyle, fontWeight: stateFilter === undefined ? 700 : 500 }}
          >
            All {Object.values(counts).reduce((a, b) => a + b, 0)}
          </button>
          {DOCUMENT_STATES.map((state) => (
            <button
              key={state}
              type="button"
              aria-pressed={stateFilter === state}
              onClick={() => onStateFilter(stateFilter === state ? undefined : state)}
              style={{ ...buttonStyle, fontWeight: stateFilter === state ? 700 : 500 }}
            >
              {documentStateLabel(state)} {counts[state]}
            </button>
          ))}
          <span>
            {sourceIds.size > 0
              ? ` · ${sourceIds.size} Word source${sourceIds.size === 1 ? '' : 's'} shown with the PDF ${sourceIds.size === 1 ? 'it produces' : 'they produce'}`
              : ''}
            {' · counts cover the first 200 documents on record'}
          </span>
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p style={noteStyle}>
          {stateFilter === undefined
            ? 'No documents on record yet — scan the site, or add one.'
            : 'Nothing on record is in this state.'}
        </p>
      ) : (
        <TableShell>
          <table aria-label="Document inventory" style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th scope="col" style={headStyle}>DOCUMENT</th>
                <th scope="col" style={headStyle}>STATE</th>
                <th scope="col" style={headStyle}>READING</th>
                <th scope="col" style={headStyle}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((doc) => {
                const own = outcomes[doc.url] ?? { state: 'idle' };
                const sourceOutcome =
                  doc.sourceAvailable === undefined
                    ? ({ state: 'idle' } as const)
                    : (outcomes[doc.sourceAvailable.url] ?? { state: 'idle' });
                const running = own.state === 'running' || sourceOutcome.state === 'running';
                const latest = latestSummary(doc);
                // A repair transcribes what the structure tree already says,
                // so an untagged PDF has nothing to repair FROM. Offered only
                // once a reading proves there is a tree.
                const repairable = doc.kind === 'pdf' && latest !== undefined && latest.summary.tagged;
                const chip = documentStateChip(doc.state);
                const hasRecord = latest !== undefined;
                const isOpen = expanded[doc.id] === true;
                const result = own.state === 'done' ? own : sourceOutcome.state === 'done' ? sourceOutcome : null;
                const failure = own.state === 'failed' ? own : sourceOutcome.state === 'failed' ? sourceOutcome : null;

                return (
                  <Fragment key={doc.id}>
                    <tr aria-busy={running || undefined}>
                      <td style={cellStyle}>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span style={{ fontFamily: FONT.mono, fontSize: 12 }}>{documentLabel(doc)}</span>
                          <span style={{ fontSize: 11, color: T.inkMuted }}>{statusLine(doc)}</span>
                          {doc.sourceAvailable ? (
                            <span style={{ fontSize: 11, color: T.inkMuted }}>
                              Word source on record — converting the source is this PDF&apos;s
                              remediation, not repairing the PDF itself: {pathOf(doc.sourceAvailable.url)}
                            </span>
                          ) : null}
                          {doc.kind === 'pdf' && latest !== undefined && !latest.summary.tagged && doc.sourceAvailable === undefined ? (
                            <span style={{ fontSize: 11, color: T.inkMuted }}>
                              No structure tree, so there is nothing to transcribe — this one needs the
                              Word source it came from, or a person to tag it. Repairing it here would
                              mean inventing its headings and reading order.
                            </span>
                          ) : null}
                          {doc.regression ? (
                            <span
                              style={{
                                fontSize: 11,
                                color:
                                  doc.regression.status === 'regressed' || doc.regression.status === 'mixed'
                                    ? T.fail
                                    : T.inkMuted,
                              }}
                            >
                              {regressionWords(doc.regression)}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td style={cellStyle}>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                          <Pill bg={chip.bg} color={chip.color} border={chip.border}>
                            {chip.label}
                          </Pill>
                          <span style={{ fontSize: 11, color: T.inkMuted }}>
                            {documentStateNote(doc.state, doc)}
                          </span>
                        </span>
                      </td>
                      <td style={cellStyle}>
                        <span style={{ fontSize: 11, color: T.inkMuted }}>
                          {latest === undefined ? '—' : conformanceLine(latest.summary)}
                        </span>
                      </td>
                      <td style={cellStyle}>
                        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {/* The workbench: every item the reading raised, as a
                              form. First where there is work to answer, because
                              that is the operator's next act. */}
                          {hasRecord ? (
                            <a
                              href={`${inventoryHref}/${encodeURIComponent(doc.id)}`}
                              style={{
                                ...buttonStyle,
                                textDecoration: 'none',
                                display: 'inline-flex',
                                alignItems: 'center',
                                fontWeight: doc.state === 'needs-answers' ? 700 : 600,
                              }}
                            >
                              {doc.state === 'needs-answers' ? `Answer ${doc.open} item${doc.open === 1 ? '' : 's'}` : 'Open'}
                            </a>
                          ) : null}
                          {doc.kind === 'pdf' ? (
                            <button
                              type="button"
                              onClick={() => onInspect(doc)}
                              disabled={running}
                              style={{ ...buttonStyle, ...disabledStyle(running) }}
                            >
                              {own.state === 'running' ? 'Inspecting…' : hasRecord ? 'Inspect again' : 'Inspect'}
                            </button>
                          ) : null}
                          {doc.sourceAvailable && converterAvailable ? (
                            <button
                              type="button"
                              onClick={() => onConvert(doc.sourceAvailable!)}
                              disabled={running}
                              style={{ ...buttonStyle, ...disabledStyle(running) }}
                            >
                              {sourceOutcome.state === 'running'
                                ? 'Converting source… (up to 5 minutes)'
                                : 'Convert the Word source'}
                            </button>
                          ) : null}
                          {/* Repair writes back what the PDF already states —
                              and consumes the answers on record for these
                              bytes. Offered second where a Word source
                              exists, because converting the source reaches
                              structure a repair never can. */}
                          {repairable && doc.kind === 'pdf' ? (
                            <button
                              type="button"
                              onClick={() => onConvert(doc)}
                              disabled={running}
                              style={{ ...buttonStyle, ...disabledStyle(running) }}
                            >
                              {own.state === 'running' ? 'Repairing… (up to 5 minutes)' : 'Repair this PDF'}
                            </button>
                          ) : null}
                          {doc.kind !== 'pdf' && converterAvailable ? (
                            <button
                              type="button"
                              onClick={() => onConvert(doc)}
                              disabled={running}
                              style={{ ...buttonStyle, ...disabledStyle(running) }}
                            >
                              {own.state === 'running' ? 'Converting… (up to 5 minutes)' : 'Convert to tagged PDF'}
                            </button>
                          ) : null}
                          {hasRecord ? (
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              onClick={() => setExpanded((current) => ({ ...current, [doc.id]: !isOpen }))}
                              style={buttonStyle}
                            >
                              {isOpen ? 'Hide details' : 'Details'}
                            </button>
                          ) : null}
                          {doc.latestConversion?.stored ? (
                            <a
                              href={`${documentsPath}/conversions/${doc.latestConversion.id}`}
                              style={{ ...buttonStyle, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                            >
                              Download the delivered file
                            </a>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                    {isOpen || result !== null || failure !== null ? (
                      <tr>
                        <td colSpan={4} style={{ ...cellStyle, background: T.surfaceSunk }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {/* The stored record, rendered ONCE from the latest
                                reading — the newer of inspection and conversion.
                                A result from this session renders as a diff
                                against it, never as a second box beside it. */}
                            {isOpen && doc.regression && doc.regression.newGaps.length > 0 ? (
                              <p style={{ ...noteStyle, color: T.fail }}>
                                New since last reading: {doc.regression.newGaps.join(' · ')}
                              </p>
                            ) : null}
                            {isOpen && doc.regression && doc.regression.resolvedGaps.length > 0 ? (
                              <p style={noteStyle}>
                                Resolved since last reading: {doc.regression.resolvedGaps.join(' · ')}
                              </p>
                            ) : null}
                            {isOpen && latest !== undefined && result === null ? (
                              <SummaryView summary={latest.summary} />
                            ) : null}
                            {result !== null ? (
                              <DocumentRunResult outcome={result} previous={latest?.summary} />
                            ) : null}
                            {failure !== null ? (
                              <p role="alert" style={{ ...noteStyle, color: T.fail }}>
                                {failure.message}
                              </p>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      )}
    </div>
  );
}
