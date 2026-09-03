'use client';

import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { MAX_ANSWER_TEXT, figureGroups, suggestionOn, type Ask } from '../../../domain/document-answers';
import { languageTagSchema } from '../../../domain/document-structure';
import { declaredAnswersFrom, figureContextLine } from '../lib/stateless-answers';
import { FONT, T } from '../lib/tokens';
import { DocumentRunResult } from './client/document-run-result';
import {
  buttonStyle,
  conversionOutcome,
  disabledStyle,
  inputStyle,
  LanguageChoice,
  noteStyle,
  pdfNameFor,
  refusalMessage,
  SummaryView,
  type ActionOutcome,
  type Summary,
} from './client/document-shared';
import { ScreenHeading } from './ui';

/**
 * One file in, one file out, nothing recorded.
 *
 * The front of the stateless route the blind harness uses: a PDF is read by
 * `/api/documents/inspect`, the figures it cannot describe and the language
 * it does not declare are put to the person in the browser, and the file is
 * posted back to `/api/documents/remediate` with what they wrote as the
 * `answers` part. No row, no attribution, no history — which is why this is
 * not a client's screen: a client's document belongs in its inventory, where
 * an answer is kept, keyed to the bytes it was given for, and signed.
 *
 * It takes only what the route can write: descriptions and a language. A
 * decision — decorative, reviewed, requested — is a record, and this screen
 * records nothing. The rest of the punch list is shown anyway; a list with
 * the unanswerable half hidden is not the list.
 *
 * A Word file has no reading here (the stateless inspect is PDF-only), so it
 * converts without answers, and the screen says so before the button.
 */

type Toolchain = { available: true } | { available: false; reason: string };

const sectionStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 12px',
  border: `1px solid ${T.rule}`,
  borderRadius: 10,
  background: T.surface,
} as const;

/** Sections under the screen's h1: the next level down, sized like the workbench's group titles. */
const h2Style = { margin: 0, fontSize: 13, fontWeight: 700, color: T.ink } as const;

function itemFor(summary: Summary, ask: Ask): string {
  const index = (summary.asks ?? []).findIndex((candidate) => candidate.id === ask.id);
  return summary.needs?.[index]?.item ?? ask.id;
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The reading as a form: one field per group of figures, the language once,
 * and everything else listed as what this screen cannot answer.
 */
export function StatelessAnswersForm({
  summary,
  descriptions,
  language,
  onDescription,
  onLanguage,
  onSubmit,
  busy,
  languageError,
}: {
  summary: Summary;
  descriptions: Record<string, string>;
  language: string;
  onDescription: (askId: string, value: string) => void;
  onLanguage: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  languageError?: string | null;
}) {
  const asks = summary.asks ?? [];
  const figureAsks = asks.filter((ask) => ask.kind === 'figure');
  const languageAsk = asks.find((ask) => ask.id === 'language');
  const answerable = new Set<string>([
    ...figureAsks.map((ask) => ask.id),
    ...(languageAsk ? [languageAsk.id] : []),
  ]);
  const elsewhere = asks.filter((ask) => !answerable.has(ask.id) && ask.answerable !== 'none');
  const contextFor = (ordinal: number) =>
    summary.excerpt?.figures.find((figure) => figure.ordinal === ordinal)?.context ?? {};

  /** Enter moves to the next description; Shift+Enter keeps a newline. */
  function advance(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    const fields = [...(event.currentTarget.form?.querySelectorAll<HTMLTextAreaElement>('textarea[data-figure]') ?? [])];
    fields[fields.indexOf(event.currentTarget) + 1]?.focus();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {languageAsk ? (
        <section aria-label="Language" style={sectionStyle}>
          <h2 style={h2Style}>Language</h2>
          <p style={noteStyle}>{itemFor(summary, languageAsk)}. Nothing is preselected: a language is never guessed.</p>
          <LanguageChoice
            value={language}
            onChange={onLanguage}
            titleText={summary.titleText}
            hint={suggestionOn(languageAsk.target)}
          />
          {languageError ? (
            <p role="alert" style={{ ...noteStyle, color: T.fail }}>
              {languageError}
            </p>
          ) : null}
        </section>
      ) : null}

      {figureAsks.length > 0 ? (
        <section aria-label="Figures" style={sectionStyle}>
          <h2 style={h2Style}>Figures</h2>
          <p style={noteStyle}>
            Write what a reader would need to know. Enter moves to the next figure. A figure you
            leave blank is left as it is.
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {figureGroups(figureAsks).map((group) => {
              const lead = group[0]!;
              const target = lead.target && 'ordinal' in lead.target ? lead.target : null;
              const context = target ? figureContextLine(contextFor(target.ordinal)) : '';
              const pages = [
                ...new Set(
                  group
                    .map((member) => (member.target && 'ordinal' in member.target ? member.target.page : null))
                    .filter((page): page is number => page !== null),
                ),
              ];
              const label =
                group.length > 1
                  ? `${group.length} figures draw the same image (pages ${pages.join(', ')}) — one description lands on all of them`
                  : itemFor(summary, lead);
              return (
                <li key={lead.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ fontSize: 12.5, color: T.ink }}>{label}</span>
                  {context ? <span style={{ fontSize: 11, color: T.inkMuted }}>{context}</span> : null}
                  <textarea
                    data-figure={lead.id}
                    aria-label={
                      group.length > 1
                        ? `Description for ${group.length} repeated figures`
                        : `Description for ${itemFor(summary, lead).split(':')[0]}`
                    }
                    rows={2}
                    maxLength={MAX_ANSWER_TEXT}
                    value={descriptions[lead.id] ?? ''}
                    onChange={(event) => onDescription(lead.id, event.target.value)}
                    onKeyDown={advance}
                    disabled={busy}
                    style={{ ...inputStyle, fontFamily: FONT.sans, resize: 'vertical' }}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {elsewhere.length > 0 ? (
        <section aria-label="Not answerable on this screen" style={sectionStyle}>
          <h2 style={h2Style}>Not answerable on this screen</h2>
          <p style={noteStyle}>
            These are decisions or the client&rsquo;s to supply, and a decision is a record. On a
            client&rsquo;s inventory they are answered and kept; here they are only listed.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {elsewhere.map((ask) => (
              <li key={ask.id} style={{ fontSize: 12.5, color: T.inkSoft }}>
                {itemFor(summary, ask)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <span>
        <button type="submit" disabled={busy} style={{ ...buttonStyle, ...disabledStyle(busy) }}>
          {busy ? 'Remediating… (up to 5 minutes)' : 'Remediate'}
        </button>
      </span>
    </form>
  );
}

export function RemediateFileScreen({ toolchain, converter }: { toolchain: Toolchain; converter: boolean }) {
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [sha, setSha] = useState<string | null>(null);
  const [reading, setReading] = useState<Summary | null>(null);
  const [readState, setReadState] = useState<'idle' | 'reading' | 'failed'>('idle');
  const [readError, setReadError] = useState<string | null>(null);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [language, setLanguage] = useState('');
  const [languageError, setLanguageError] = useState<string | null>(null);
  const [run, setRun] = useState<ActionOutcome>({ state: 'idle' });

  function reset() {
    // A previous run's object URL is revoked rather than left to the tab.
    if (run.state === 'done' && run.href) URL.revokeObjectURL(run.href);
    setRun({ state: 'idle' });
    setReading(null);
    setReadState('idle');
    setReadError(null);
    setDescriptions({});
    setLanguage('');
    setLanguageError(null);
    setSha(null);
  }

  async function choose(next: File) {
    reset();
    setFile(next);
    if (!isPdf(next)) return;

    setReadState('reading');
    try {
      // Hashed and posted from the same bytes: the route holds the answers
      // to the sha of what it receives.
      const bytes = await next.arrayBuffer();
      setSha(await sha256Hex(bytes));
      const form = new FormData();
      form.set('file', next);
      const response = await fetch('/api/documents/inspect', { method: 'POST', body: form });
      if (!response.ok) {
        setReadState('failed');
        setReadError(await refusalMessage(response));
        return;
      }
      setReading((await response.json()) as Summary);
      setReadState('idle');
    } catch {
      setReadState('failed');
      setReadError('Could not reach the server.');
    }
  }

  async function remediate() {
    if (!file) return;
    const chosen = language.trim();
    if (chosen !== '' && !languageTagSchema.safeParse(chosen).success) {
      setLanguageError('That is not a language tag this can write. It needs a BCP-47 tag such as en or cy-GB.');
      return;
    }
    setLanguageError(null);
    setRun({ state: 'running' });
    try {
      const form = new FormData();
      form.set('file', file);
      const answers = reading && sha ? declaredAnswersFrom(reading, sha, descriptions, chosen) : null;
      if (answers) form.set('answers', JSON.stringify(answers));
      const response = await fetch('/api/documents/remediate', { method: 'POST', body: form });
      setRun(await conversionOutcome(response, pdfNameFor(file.name)));
    } catch {
      setRun({ state: 'failed', message: 'Could not reach the server.' });
    }
  }

  const busy = run.state === 'running' || readState === 'reading';
  const accept = converter
    ? 'application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/msword,.doc'
    : 'application/pdf,.pdf';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 860 }}>
      <ScreenHeading
        title="Remediate a file"
        lede="One file in, one file out. Nothing is recorded here and no one is attributed — for a client's document use its inventory, where every answer is kept, keyed to the bytes it was given for."
      />

      {!toolchain.available ? (
        <p role="status" style={{ ...noteStyle, color: T.ink }}>
          This host cannot read documents: {toolchain.reason}. Nothing can be uploaded until it can.
        </p>
      ) : (
        <>
          <section aria-label="Upload" style={sectionStyle}>
            <label htmlFor={fileId} style={{ fontSize: 12.5, fontWeight: 600, color: T.ink }}>
              The file
            </label>
            <input
              id={fileId}
              type="file"
              accept={accept}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.files?.[0];
                if (next) void choose(next);
              }}
              // A pointer target of at least 24px: the browser's own file
              // control is shorter than that at this font size.
              style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.ink, minHeight: 28, padding: '4px 0' }}
            />
            <p style={noteStyle}>
              {converter
                ? 'A PDF is read first so you can describe its figures. A Word file converts without answers here — its reading comes with the delivered PDF.'
                : 'A PDF is read first so you can describe its figures. This host has no converter, so Word files cannot be taken here.'}
            </p>
            {readState === 'reading' ? (
              <p role="status" aria-busy="true" style={noteStyle}>
                Reading…
              </p>
            ) : null}
            {readState === 'failed' && readError ? (
              <p role="alert" style={{ ...noteStyle, color: T.fail }}>
                {readError}
              </p>
            ) : null}
          </section>

          {reading ? (
            <section aria-label="The reading" style={sectionStyle}>
              <h2 style={h2Style}>What the reading found</h2>
              <SummaryView summary={reading} />
            </section>
          ) : null}

          {file && (reading || !isPdf(file)) ? (
            reading ? (
              <StatelessAnswersForm
                summary={reading}
                descriptions={descriptions}
                language={language}
                onDescription={(askId, value) => setDescriptions((current) => ({ ...current, [askId]: value }))}
                onLanguage={setLanguage}
                onSubmit={() => void remediate()}
                busy={busy}
                languageError={languageError}
              />
            ) : (
              <span>
                <button
                  type="button"
                  onClick={() => void remediate()}
                  disabled={busy}
                  style={{ ...buttonStyle, ...disabledStyle(busy) }}
                >
                  {busy ? 'Converting… (up to 5 minutes)' : 'Convert'}
                </button>
              </span>
            )
          ) : null}

          {run.state === 'done' ? <DocumentRunResult outcome={run} previous={undefined} /> : null}
          {run.state === 'failed' ? (
            <p role="alert" style={{ ...noteStyle, color: T.fail }}>
              {run.message}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
