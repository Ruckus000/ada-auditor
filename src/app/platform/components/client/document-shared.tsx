'use client';

import { conformanceLine, scopeLine } from '../../../../services/presentation/document-verdict';
import type { RemediationSummary } from '../../../../domain/document-remediation';
import type { DocumentState } from '../../../../services/document-state';
import { describeDocumentRefusal } from '../../lib/document-action-copy';
import { FONT, T } from '../../lib/tokens';

/**
 * What the document screen's parts share: the row shape the route returns,
 * the styles, the one summary renderer, and the outcome of an action.
 *
 * One file rather than four copies, for the reason `SummaryView` was written
 * once in the first place: a document must not end up described differently
 * depending on which part of the screen its reading arrived through.
 */

export type Summary = RemediationSummary;

/** One inventory row, as the client-scoped GET returns it. */
export type ClientDocument = {
  id: string;
  url: string;
  kind: 'pdf' | 'docx' | 'doc';
  source: 'crawl' | 'upload';
  foundOn?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** Derived server-side from the rows; the row leads with it. */
  state: DocumentState;
  /** Asks nobody has answered, client asks included. */
  open: number;
  /** Client asks logged as requested. */
  waiting: number;
  /** Answers given against other bytes than the latest reading's. */
  expired: number;
  latestInspection?: { id: string; summary: Summary; inspectedAt: string };
  latestConversion?: {
    id: string;
    summary: Summary;
    convertedAt: string;
    outputSha256: string;
    /** Whether the delivered file itself is retrievable from the server. */
    stored: boolean;
  };
  /**
   * A Word document in the same inventory shares this PDF's stem — its
   * conversion, not this file's punch list, is the remediation.
   */
  sourceAvailable?: { id: string; kind: 'docx' | 'doc'; url: string };
  /** The server's diff of the latest two readings. Absent on a first reading. */
  regression?: {
    status: 'unchanged' | 'improved' | 'regressed' | 'mixed' | 'incomparable';
    newGaps: string[];
    resolvedGaps: string[];
    unchangedCount: number;
    baselineAt?: string;
  };
};

export type StateCounts = Record<DocumentState, number>;

/**
 * What one action left behind: the reading it produced, and — for a
 * conversion — the file, as an object URL the operator can download.
 */
export type ActionOutcome =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'done'; summary: Summary; href?: string; filename?: string; converted: boolean }
  | { state: 'failed'; message: string };

export const inputStyle = {
  fontFamily: FONT.mono,
  fontSize: 12,
  padding: '6px 9px',
  borderRadius: 7,
  border: `1px solid ${T.rule}`,
  background: T.surface,
  color: T.ink,
  minWidth: 0,
} as const;

export const buttonStyle = {
  fontFamily: FONT.sans,
  fontSize: 12.5,
  fontWeight: 600,
  padding: '6px 12px',
  borderRadius: 8,
  border: `1px solid ${T.rule}`,
  background: T.surface,
  color: T.ink,
  cursor: 'pointer',
} as const;

export const noteStyle = {
  margin: 0,
  fontFamily: FONT.sans,
  fontSize: 12.5,
  color: T.inkMuted,
} as const;

export function disabledStyle(disabled: boolean) {
  return disabled
    ? { background: T.surfaceSunk, color: T.inkMuted, cursor: 'default' as const }
    : {};
}

/** The path half of a URL — what an operator recognises their document by. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    // An upload's `url` is a filename, not a URL, and reads fine as itself.
    return url;
  }
}

/** `agenda.docx` → `agenda-remediated.pdf`, purely for the download's name. */
export function pdfNameFor(sourceName: string): string {
  // CDN-hosted documents routinely carry a query (`/blob.docx?ver=2`); the
  // download's name wants neither it nor a fragment.
  const base = sourceName.split(/[?#]/)[0].split('/').pop() ?? '';
  return `${(base.replace(/\.docx?$/i, '') || 'document')}-remediated.pdf`;
}

/** A refused response, in the words `document-action-copy` chooses. */
export async function refusalMessage(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; detail?: string; message?: string }
    | null;
  return describeDocumentRefusal({ ...(payload ?? {}), status: response.status });
}

/**
 * The conversion response is the PDF itself, with the summary riding in a
 * header — one request, both halves. A refusal is JSON, same as everywhere.
 */
export async function conversionOutcome(response: Response, filename: string): Promise<ActionOutcome> {
  if (!response.ok) return { state: 'failed', message: await refusalMessage(response) };

  let summary: Summary;
  try {
    summary = JSON.parse(response.headers.get('x-remediation-summary') ?? '') as Summary;
  } catch {
    return { state: 'failed', message: 'The file arrived without its summary. Reload to see the stored reading.' };
  }

  const href = URL.createObjectURL(await response.blob());
  return { state: 'done', summary, href, filename, converted: true };
}

/**
 * One reading, rendered the same way wherever it came from — the stored
 * record, an action this session, an upload.
 */
export function SummaryView({ summary }: { summary: Summary }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 10px',
        borderRadius: 8,
        border: `1px solid ${T.rule}`,
        background: T.surfaceSunk,
      }}
    >
      <p style={{ ...noteStyle, color: T.ink }}>
        {summary.tagged ? 'Tagged' : 'Not tagged'} · {summary.pages}{' '}
        {summary.pages === 1 ? 'page' : 'pages'} · {summary.headings} headings ·{' '}
        {summary.tables} tables · {summary.figures} figures
        {summary.titleText ? ` · “${summary.titleText}”` : ' · no title'}
      </p>
      <p style={noteStyle}>{conformanceLine(summary)}</p>
      <p style={noteStyle}>{scopeLine(summary)}</p>
      {summary.gaps.length === 0 ? (
        <p style={noteStyle}>No machine-detectable gaps.</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {summary.gaps.map((gap) => (
            <li key={gap} style={{ ...noteStyle, color: T.fail }}>
              {gap}
            </li>
          ))}
        </ul>
      )}
      {summary.needs && summary.needs.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* The punch list: each line is one thing a person still has to do.
              Rendered apart from the gaps because a gap states a failure and
              a need states the work. Keyed by identity where the reading
              carries one; two identical sentences are two figures. */}
          {summary.needs.map((need, index) => (
            <li key={summary.asks?.[index]?.id ?? `${index}:${need.item}`} style={noteStyle}>
              {need.criterion}: {need.item}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
