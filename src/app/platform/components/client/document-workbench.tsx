'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type KeyboardEvent } from 'react';
import { MAX_ANSWER_TEXT, type Ask } from '../../../../domain/document-answers';
import type { StoredDocumentAnswer } from '../../../../domain/platform';
import type { DocumentState } from '../../../../services/document-state';
import {
  conformanceLine,
  documentStateLabel,
  documentStateNote,
  scopeLine,
} from '../../../../services/presentation/document-verdict';
import { documentStateChip } from '../../lib/verdict-chip';
import { FONT, T } from '../../lib/tokens';
import { Pill } from '../ui';
import { clientHref } from '../../lib/params';
import {
  buttonStyle,
  conversionOutcome,
  disabledStyle,
  inputStyle,
  noteStyle,
  pathOf,
  pdfNameFor,
  refusalMessage,
  type ActionOutcome,
  type Summary,
} from './document-shared';
import { DocumentRunResult } from './document-run-result';

/**
 * The punch list as a form.
 *
 * Every item the latest reading raised, grouped by what it takes to close —
 * cheapest first: one language, then heading decisions, then the figures,
 * then the reviews, then what only the client can supply. A person answers
 * in place; Save writes the answers, attributed and keyed to the reading's
 * bytes; "Apply answers and run" is the ordinary Repair or Convert, which
 * consumes them. Nothing here changes a file: the pipeline does, on the run.
 *
 * What the form must never do is render a closed item as gone. Closure is a
 * join between the reading's asks and the answers on record, shown as who
 * decided what and when; the instrument's list is rendered whole, and
 * "conformant" is only ever the checker's word.
 */

type Draft = { disposition: 'declared' | 'decided' | 'requested'; value?: string; note?: string };

const LANGUAGES: Array<[string, string]> = [
  ['en', 'English'],
  ['en-US', 'English (US)'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['pt', 'Portuguese'],
  ['zh', 'Chinese'],
  ['vi', 'Vietnamese'],
  ['ko', 'Korean'],
  ['tl', 'Tagalog'],
  ['ar', 'Arabic'],
];

const groupStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 12px',
  border: `1px solid ${T.rule}`,
  borderRadius: 10,
  background: T.surface,
} as const;

const h3Style = { margin: 0, fontSize: 13, fontWeight: 700, color: T.ink } as const;

function itemFor(summary: Summary, ask: Ask): string {
  const index = (summary.asks ?? []).findIndex((candidate) => candidate.id === ask.id);
  return summary.needs?.[index]?.item ?? ask.id;
}

export function DocumentWorkbench({
  clientId,
  document,
  reading,
  answers,
  standing,
  nextDocumentId,
}: {
  clientId: string;
  document: {
    id: string;
    url: string;
    kind: 'pdf' | 'docx' | 'doc';
    source: 'crawl' | 'upload';
    foundOn?: string;
    /** The Word source paired with this PDF; converting it is the run. */
    sourceUrl?: string;
  };
  reading: {
    summary: Summary;
    at: string;
    by: 'inspection' | 'conversion';
    inputSha256?: string;
    conversionId?: string;
  } | null;
  /** Latest per ask, at the reading's bytes only. */
  answers: StoredDocumentAnswer[];
  standing: { state: DocumentState; open: string[]; waiting: string[]; expired: number };
  nextDocumentId: string | null;
}) {
  const router = useRouter();
  const headingId = `${useId()}-heading`;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [run, setRun] = useState<ActionOutcome>({ state: 'idle' });

  const documentsPath = `/api/platform/clients/${encodeURIComponent(clientId)}/documents`;
  const inventoryHref = clientHref(clientId, 'documents');

  if (reading === null) {
    return (
      <section aria-labelledby={headingId} style={{ padding: 'clamp(14px,1.8vw,28px)', fontFamily: FONT.sans }}>
        <h2 id={headingId} style={{ margin: 0, fontSize: 15 }}>{pathOf(document.url)}</h2>
        <p style={noteStyle}>No reading yet — inspect or convert it from <a href={inventoryHref}>the inventory</a>.</p>
      </section>
    );
  }

  const summary = reading.summary;
  const asks = summary.asks ?? [];
  const answered = new Map(answers.map((answer) => [answer.askId, answer]));
  const byKind = (kind: Ask['kind']) => asks.filter((ask) => ask.kind === kind);
  const openFigures = byKind('figure').filter((ask) => !answered.has(ask.id));
  const contextFor = (ordinal: number) =>
    summary.excerpt?.figures.find((figure) => figure.ordinal === ordinal)?.context ?? {};
  const workAsks = asks.filter((ask) => ask.answerable !== 'none');
  const answeredCount = workAsks.filter((ask) => answered.has(ask.id)).length;
  const chip = documentStateChip(standing.state);

  /** Where a person can look at the figure: the delivered file at its page,
   * else the document's own address. An upload with no stored file has
   * neither, and says so. */
  const openAt = (page: number | null) => {
    const anchor = page === null ? '' : `#page=${page}`;
    if (reading.conversionId) return `${documentsPath}/conversions/${reading.conversionId}${anchor}`;
    if (document.source === 'crawl') return `${document.url}${anchor}`;
    return null;
  };

  function draft(askId: string, next: Draft | null) {
    setDrafts((current) => {
      const copy = { ...current };
      if (next === null) delete copy[askId];
      else copy[askId] = next;
      return copy;
    });
    setSaved(null);
  }

  const pending = Object.entries(drafts).filter(([, d]) => d.disposition !== 'declared' || (d.value ?? '').trim() !== '');

  async function save(): Promise<boolean> {
    if (pending.length === 0) return true;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`${documentsPath}/${encodeURIComponent(document.id)}/answers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          answers: pending.map(([askId, d]) => ({
            askId,
            disposition: d.disposition,
            ...(d.value === undefined ? {} : { value: d.value }),
            ...(d.note === undefined || d.note === '' ? {} : { note: d.note }),
          })),
        }),
      });
      if (!response.ok) {
        setSaveError(await refusalMessage(response));
        return false;
      }
      const body = (await response.json()) as { saved: number; state: DocumentState };
      setDrafts({});
      setSelected({});
      setSaved(`Saved ${body.saved} answer${body.saved === 1 ? '' : 's'} — now ${documentStateLabel(body.state).toLowerCase()}.`);
      router.refresh();
      return true;
    } catch {
      setSaveError('Could not reach the server.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function applyAndRun(): Promise<void> {
    if (!(await save())) return;
    setRun({ state: 'running' });
    try {
      // The ordinary run: a paired PDF converts its source; anything else
      // repairs or converts itself. Declared answers on record for these
      // bytes are what the run consumes.
      const url = document.sourceUrl ?? document.url;
      const response = await fetch(`${documentsPath}/convert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url, ...(document.foundOn === undefined ? {} : { foundOn: document.foundOn }) }),
      });
      setRun(await conversionOutcome(response, pdfNameFor(pathOf(url))));
      router.refresh();
    } catch {
      setRun({ state: 'failed', message: 'Could not reach the server.' });
    }
  }

  async function saveAndNext(): Promise<void> {
    if (await save()) {
      router.push(nextDocumentId === null ? inventoryHref : `${inventoryHref}/${encodeURIComponent(nextDocumentId)}`);
    }
  }

  /** Enter saves the field's draft and moves to the next description. */
  function advance(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    const fields = [...event.currentTarget.form?.querySelectorAll<HTMLTextAreaElement>('textarea[data-figure]') ?? []];
    const next = fields[fields.indexOf(event.currentTarget) + 1];
    next?.focus();
  }

  function markSelectedDecorative() {
    for (const ask of openFigures) {
      if (selected[ask.id]) draft(ask.id, { disposition: 'decided', note: 'decorative' });
    }
  }

  const answerLine = (ask: Ask) => {
    const answer = answered.get(ask.id);
    if (!answer) return null;
    const what =
      answer.disposition === 'declared'
        ? `declared${ask.kind === 'figure' || ask.kind === 'language' ? `: “${answer.value}”` : ''}`
        : answer.disposition === 'decided'
          ? `decided${answer.note ? ` — ${answer.note}` : ''}`
          : `requested from the client${answer.note ? ` — ${answer.note}` : ''}`;
    return (
      <span style={{ fontSize: 11, color: T.inkMuted }}>
        {what} · {answer.actor}, {answer.declaredAt.slice(0, 10)}
        {answer.disposition === 'decided' && ask.kind === 'figure'
          ? ' · recorded, not written to the file: artifacting is deferred, and the item still counts against 7.3-1'
          : ''}
      </span>
    );
  };

  const decisionButtons = (ask: Ask, options: Array<{ label: string; draft: Draft }>) => (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {options.map((option) => {
        const chosen = drafts[ask.id]?.disposition === option.draft.disposition
          && drafts[ask.id]?.value === option.draft.value
          && drafts[ask.id]?.note === option.draft.note;
        return (
          <button
            key={option.label}
            type="button"
            aria-pressed={chosen}
            onClick={() => draft(ask.id, chosen ? null : option.draft)}
            style={{ ...buttonStyle, fontWeight: chosen ? 700 : 600 }}
          >
            {option.label}
          </button>
        );
      })}
    </span>
  );

  const group = (title: string, kindAsks: Ask[], render: (ask: Ask) => React.ReactNode, lede?: string) =>
    kindAsks.length === 0 ? null : (
      <section aria-label={title} style={groupStyle}>
        <h3 style={h3Style}>{title}</h3>
        {lede ? <p style={noteStyle}>{lede}</p> : null}
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {kindAsks.map((ask) => (
            <li key={ask.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 12.5, color: T.ink }}>{itemFor(summary, ask)}</span>
              {answerLine(ask) ?? render(ask)}
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <section
      aria-labelledby={headingId}
      style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 'clamp(14px,1.8vw,28px)', fontFamily: FONT.sans }}
    >
      <p style={noteStyle}>
        <a href={inventoryHref}>← Documents</a>
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <h2 id={headingId} style={{ margin: 0, fontSize: 15, fontWeight: 700, fontFamily: FONT.mono, color: T.ink }}>
          {pathOf(document.url)}
        </h2>
        <Pill bg={chip.bg} color={chip.color} border={chip.border}>{chip.label}</Pill>
        <span style={{ fontSize: 11, color: T.inkMuted }}>{documentStateNote(standing.state, { open: standing.open.length, waiting: standing.waiting.length, expired: standing.expired })}</span>
      </div>
      <p style={noteStyle}>
        <label>
          {answeredCount} of {workAsks.length} answered{' '}
          <progress value={answeredCount} max={Math.max(workAsks.length, 1)} />
        </label>
        {' · '}read {reading.at.slice(0, 10)} by {reading.by}
        {' · '}{conformanceLine(summary)}
        {openAt(null) ? (
          <>
            {' · '}<a href={openAt(null)!} target="_blank" rel="noreferrer">Open the document</a>
          </>
        ) : null}
      </p>
      <p style={noteStyle}>{scopeLine(summary)}</p>

      {standing.expired > 0 ? (
        <p role="status" style={{ ...noteStyle, color: T.caution }}>
          {standing.expired} answer{standing.expired === 1 ? ' was' : 's were'} given against earlier bytes of this
          document and no longer apply; the items they answered are open again below.
        </p>
      ) : null}

      {workAsks.length === 0 ? (
        <p style={noteStyle}>Nothing here needs a person.</p>
      ) : null}

      <form onSubmit={(event) => { event.preventDefault(); void save(); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {group(
          'Language',
          byKind('language'),
          (ask) => (
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <label style={{ fontSize: 11, color: T.inkMuted }}>
                The language it is written in{' '}
                <select
                  value={drafts[ask.id]?.value ?? ''}
                  onChange={(event) =>
                    draft(ask.id, event.target.value === '' ? null : { disposition: 'declared', value: event.target.value })
                  }
                  style={{ ...inputStyle, fontFamily: FONT.sans }}
                >
                  <option value="">Choose…</option>
                  {LANGUAGES.map(([tag, name]) => (
                    <option key={tag} value={tag}>{name} ({tag})</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 11, color: T.inkMuted }}>
                or a BCP-47 tag{' '}
                <input
                  type="text"
                  placeholder="cy-GB"
                  maxLength={35}
                  onChange={(event) =>
                    draft(ask.id, event.target.value.trim() === '' ? null : { disposition: 'declared', value: event.target.value.trim() })
                  }
                  style={{ ...inputStyle, width: 90 }}
                />
              </label>
              {summary.titleText ? (
                <span style={{ fontSize: 11, color: T.inkMuted }}>The document calls itself “{summary.titleText}”.</span>
              ) : null}
            </span>
          ),
          'Nothing is preselected: a language is never guessed.',
        )}

        {group('Headings', byKind('heading'), (ask) =>
          decisionButtons(ask, [
            { label: 'Keep as the author wrote it', draft: { disposition: 'decided', note: 'accepted as authored' } },
            { label: 'Start the ladder at H1', draft: { disposition: 'declared', value: 'start-at-h1' } },
          ]),
          'Starting at H1 re-ranks every level on the next run; where a heading is reached through a RoleMap the run refuses and records the decision instead.',
        )}

        {byKind('figure').length > 0 ? (
          <section aria-label="Figures" style={groupStyle}>
            <span style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <h3 style={h3Style}>Figures</h3>
              {openFigures.length > 1 ? (
                <span style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setSelected(Object.fromEntries(openFigures.map((ask) => [ask.id, true])))}
                    style={buttonStyle}
                  >
                    Select all open
                  </button>
                  <button
                    type="button"
                    onClick={markSelectedDecorative}
                    disabled={!openFigures.some((ask) => selected[ask.id])}
                    style={{ ...buttonStyle, ...disabledStyle(!openFigures.some((ask) => selected[ask.id])) }}
                  >
                    Mark selected decorative
                  </button>
                </span>
              ) : null}
            </span>
            <p style={noteStyle}>
              Write what a reader would need to know. Enter moves to the next figure. A figure marked
              decorative is recorded as your decision and stays on the punch list until it is artifacted —
              an empty description is not the treatment.
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {byKind('figure').map((ask) => {
                const target = ask.target && 'ordinal' in ask.target ? ask.target : null;
                const context = target ? contextFor(target.ordinal) : {};
                const href = openAt(target?.page ?? null);
                const answer = answerLine(ask);
                const d = drafts[ask.id];
                return (
                  <li key={ask.id} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                      {answer === null ? (
                        <input
                          type="checkbox"
                          aria-label={`Select ${itemFor(summary, ask).split(':')[0]}`}
                          checked={selected[ask.id] === true}
                          onChange={(event) => setSelected((current) => ({ ...current, [ask.id]: event.target.checked }))}
                        />
                      ) : null}
                      <span style={{ fontSize: 12.5, color: T.ink }}>{itemFor(summary, ask)}</span>
                      {href ? (
                        <a href={href} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>
                          open at page {target?.page ?? '?'}
                        </a>
                      ) : null}
                    </span>
                    {context.heading || context.before || context.after || context.caption ? (
                      <span style={{ fontSize: 11, color: T.inkMuted, paddingLeft: 24 }}>
                        {context.caption ? `Caption: “${context.caption}”. ` : ''}
                        {context.heading ? `Under “${context.heading}”. ` : ''}
                        {context.before ? `Before it: “${context.before}”. ` : ''}
                        {context.after && context.after !== context.caption ? `After it: “${context.after}”.` : ''}
                      </span>
                    ) : null}
                    {answer ?? (
                      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start', paddingLeft: 24 }}>
                        <textarea
                          data-figure={ask.id}
                          aria-label={`Description for ${itemFor(summary, ask).split(':')[0]}`}
                          rows={2}
                          maxLength={MAX_ANSWER_TEXT}
                          value={d?.disposition === 'declared' ? (d.value ?? '') : ''}
                          disabled={d?.disposition === 'decided'}
                          onChange={(event) =>
                            draft(ask.id, event.target.value === '' ? null : { disposition: 'declared', value: event.target.value })
                          }
                          onKeyDown={advance}
                          style={{ ...inputStyle, fontFamily: FONT.sans, flex: '1 1 320px', resize: 'vertical' }}
                        />
                        <button
                          type="button"
                          aria-pressed={d?.disposition === 'decided'}
                          onClick={() =>
                            draft(ask.id, d?.disposition === 'decided' ? null : { disposition: 'decided', note: 'decorative' })
                          }
                          style={{ ...buttonStyle, fontWeight: d?.disposition === 'decided' ? 700 : 600 }}
                        >
                          Decorative
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {group('Reviews', [...byKind('contrast'), ...byKind('pdfua')], (ask) =>
          decisionButtons(ask, [
            { label: 'Reviewed — accepted as is', draft: { disposition: 'decided', note: 'reviewed and accepted' } },
            { label: 'Will change in the source', draft: { disposition: 'requested', note: 'design change requested' } },
          ]),
          'Nothing here is written to the file: a colour or a check somebody reviewed is recorded as their decision.',
        )}

        {group(
          'Needed from the client',
          asks.filter((ask) => ask.answerable === 'client'),
          (ask) =>
            decisionButtons(ask, [
              { label: 'Mark requested', draft: { disposition: 'requested' } },
              { label: 'Decided — leave as is', draft: { disposition: 'decided', note: 'accepted' } },
            ]),
          'Only the client can supply these — the Word source, a re-signed or unprotected copy, an export with fonts embedded. When the file arrives, upload it against this row from the inventory.',
        )}

        {group('Needs no action', asks.filter((ask) => ask.answerable === 'none'), () => (
          <span style={{ fontSize: 11, color: T.inkMuted }}>Listed so the checker’s verdict is complete; not counted as work.</span>
        ))}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <button type="submit" disabled={saving || pending.length === 0} style={{ ...buttonStyle, ...disabledStyle(saving || pending.length === 0) }}>
            {saving ? 'Saving…' : `Save ${pending.length === 0 ? 'answers' : `${pending.length} answer${pending.length === 1 ? '' : 's'}`}`}
          </button>
          <button
            type="button"
            onClick={() => void applyAndRun()}
            disabled={saving || run.state === 'running'}
            style={{ ...buttonStyle, ...disabledStyle(saving || run.state === 'running') }}
          >
            {run.state === 'running' ? 'Running… (up to 5 minutes)' : 'Apply answers and run'}
          </button>
          <button type="button" onClick={() => void saveAndNext()} disabled={saving} style={{ ...buttonStyle, ...disabledStyle(saving) }}>
            {nextDocumentId === null ? 'Save and back to the inventory' : 'Save and open the next'}
          </button>
          {saved ? <span role="status" style={{ ...noteStyle, color: T.accent }}>{saved}</span> : null}
          {saveError ? <span role="alert" style={{ ...noteStyle, color: T.fail }}>{saveError}</span> : null}
        </div>
      </form>

      {run.state === 'done' ? <DocumentRunResult outcome={run} previous={summary} /> : null}
      {run.state === 'failed' ? (
        <p role="alert" style={{ ...noteStyle, color: T.fail }}>{run.message}</p>
      ) : null}
    </section>
  );
}
