'use client';

import { conformanceLine, scopeLine } from '../../../../services/presentation/document-verdict';
import type { RemediationSummary } from '../../../../domain/document-remediation';
import type { LanguageHint } from '../../../../domain/language-hint';
import { LANGUAGES, languageName } from '../../../../domain/languages';
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

/**
 * The language ask, as both the workbench and the one-off screen put it.
 *
 * Nothing is preselected: a language is never guessed. The select carries
 * the common cases and the free field takes any BCP-47 tag; the document's
 * own title sits beside them because it is usually the clearest evidence a
 * person has, and the hint — what the text reads as, with its count — sits
 * beside the title as a sentence, never as a selection. `value` is whatever
 * the operator last chose, from either control.
 */
export function LanguageChoice({
  value,
  onChange,
  titleText,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  titleText?: string;
  hint?: LanguageHint;
}) {
  const inList = LANGUAGES.some(([tag]) => tag === value);
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <label style={{ fontSize: 11, color: T.inkMuted }}>
        The language it is written in{' '}
        <select
          value={inList ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          style={{ ...inputStyle, fontFamily: FONT.sans }}
        >
          <option value="">Choose…</option>
          {LANGUAGES.map(([tag, name]) => (
            <option key={tag} value={tag}>
              {name} ({tag})
            </option>
          ))}
        </select>
      </label>
      <label style={{ fontSize: 11, color: T.inkMuted }}>
        or a BCP-47 tag{' '}
        <input
          type="text"
          placeholder="cy-GB"
          maxLength={35}
          value={inList ? '' : value}
          onChange={(event) => onChange(event.target.value.trim())}
          style={{ ...inputStyle, width: 90 }}
        />
      </label>
      {titleText ? (
        <span style={{ fontSize: 11, color: T.inkMuted }}>The document calls itself “{titleText}”.</span>
      ) : null}
      {hint ? (
        <span style={{ fontSize: 11, color: T.inkMuted }}>
          Its text reads as {languageName(hint.suggested)} ({hint.evidence} match{hint.evidence === 1 ? '' : 'es'}).
          A suggestion — nothing is chosen for you.
        </span>
      ) : null}
    </span>
  );
}

/** A refused response, in the words `document-action-copy` chooses. */
export async function refusalMessage(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; detail?: string; message?: string }
    | null;
  return describeDocumentRefusal({ ...(payload ?? {}), status: response.status });
}

/**
 * An inspection's answer, and whether a batch may go on past it.
 *
 * "Inspect all unreviewed" is sequential and can be two hundred documents
 * long. A budget refusal is the one answer that will be the same for every
 * document after it, so the loop stops there rather than painting two
 * hundred red rows. Every other refusal is about this document — a signed
 * PDF in position three says nothing about position four — and the loop
 * carries on.
 */
export async function inspectOutcome(
  response: Response,
): Promise<{ outcome: ActionOutcome; halts: boolean }> {
  if (!response.ok) {
    return {
      outcome: { state: 'failed', message: await refusalMessage(response) },
      halts: response.status === 429,
    };
  }
  const payload = (await response.json().catch(() => null)) as
    | { inspection?: { summary: Summary } }
    | null;
  if (!payload?.inspection) {
    return {
      outcome: { state: 'failed', message: 'The server answered without a reading.' },
      halts: false,
    };
  }
  return {
    outcome: { state: 'done', summary: payload.inspection.summary, converted: false },
    halts: false,
  };
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
