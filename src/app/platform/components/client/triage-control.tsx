'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { MAX_TRIAGE_NOTE } from '../../../../domain/platform';
import type { FindingView } from '../../../../services/findings-view';
import {
  TRIAGE_DECISIONS,
  triageNotePrompt,
  type TriageDecisionState,
} from '../../../../services/presentation/triage';
import { FONT, T } from '../../lib/tokens';

/**
 * Deciding what happens to a finding, and undoing it.
 *
 * Two decisions, not one: **not a barrier** (`dismissed`) and **a barrier the
 * client accepts** (`accepted-risk`). Both have existed in the type, the zod
 * enum and the SQL CHECK since Phase 2C with no control able to produce the
 * second, which is why the screens, the display mapper and the audit log all
 * branched two ways over three states and filed an accepted barrier as a
 * dismissal.
 *
 * This is deliberately *not* the prototype's five canned reasons. WCAG
 * conformance is binary per criterion, so a menu of excuses would sit in the
 * record as though each had been checked against something. The state is the
 * taxonomy; the note stays required free text for both, because what an
 * auditor needs from it is a sentence, not a category.
 *
 * A radio group inside the existing disclosure rather than two more buttons on
 * the row: a real run returns eighty-odd findings, and a fourth top-level
 * control per row is eighty more entries in a screen reader's list of
 * controls — the problem the single trigger below already exists to solve.
 *
 * A triaged finding stays on the screen, dimmed, with its decision and reason.
 * The decision to leave a barrier in place is itself something an auditor has
 * to be able to review, so hiding it would be the wrong kind of tidy.
 */
export function TriageControl({
  clientId,
  finding,
  pageUrl,
}: {
  clientId: string;
  finding: FindingView;
  /** Stored alongside the decision; the key alone cannot be split back apart. */
  pageUrl?: string;
}) {
  const router = useRouter();
  const noteId = useId();
  /**
   * Unique per row, because this component is rendered once per finding.
   * A literal `name="state"` would put every row's radios in one group across
   * a page of eighty server-rendered findings, so choosing a decision on one
   * finding would silently clear the choice on another.
   */
  const groupName = useId();

  const [open, setOpen] = useState(false);
  const [state, setState] = useState<TriageDecisionState | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: unknown, method: 'POST' | 'DELETE') {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/platform/clients/${clientId}/triage`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(parsed?.error ?? `That did not save (${response.status}).`);
        return;
      }

      setOpen(false);
      setState(null);
      setNote('');
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (finding.triage !== null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => send({ findingKey: finding.key }, 'DELETE')}
          aria-label={`Reopen ${finding.code}${pageUrl ? ` on ${pageUrl}` : ''}`}
          style={link}
        >
          {busy ? 'Reopening…' : 'Reopen this finding'}
        </button>
        {error ? <Error>{error}</Error> : null}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        // Every row's control would otherwise be one more "Triage this
        // finding" in a screen reader's list of controls, with nothing to tell
        // them apart.
        aria-label={`Triage ${finding.code}${pageUrl ? ` on ${pageUrl}` : ''}`}
        style={link}
      >
        Triage this finding
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || state === null) return;
        void send(
          {
            findingKey: finding.key,
            state,
            note,
            ...(pageUrl ? { pageUrl } : {}),
            ...(finding.selector ? { selector: finding.selector } : {}),
          },
          'POST',
        );
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <fieldset
        style={{
          margin: 0,
          padding: 0,
          border: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: ROW_GAP,
        }}
      >
        <legend style={{ ...promptStyle, padding: 0, marginBottom: 3 }}>
          What is the decision?
        </legend>

        {TRIAGE_DECISIONS.map((decision) => {
          const id = `${groupName}-${decision.state}`;
          return (
            <span key={decision.state} style={radioRow}>
              <input
                id={id}
                type="radio"
                name={groupName}
                value={decision.state}
                checked={state === decision.state}
                onChange={() => setState(decision.state)}
                style={radioInput}
              />
              {/* An explicit `for`, not a wrapping element: the label is the
                  only thing that names the radio, and it is what the hydration
                  suite's axe pass checks. */}
              <label htmlFor={id} style={radioLabel}>
                {decision.label}
              </label>
            </span>
          );
        })}
      </fieldset>

      {/* The note only appears once a decision is made, because the question it
          answers is different for each one and there is no honest way to ask it
          before then. Pre-selecting a decision to keep the label static would
          put words in an operator's mouth, and "not a barrier" is the wrong
          default for a barrier. Switching between the two rewords the label in
          place — no focus move, no submission, no new window, so it is not a
          3.2.2 change of context — and the radios come first in DOM order, so
          the reword is always behind the reader rather than ahead of it. */}
      {state === null ? null : (
        <>
          <label htmlFor={noteId} style={promptStyle}>
            {triageNotePrompt(state)}
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            required
            rows={2}
            // Capped at the number the route enforces, so an operator cannot
            // type past a limit and be told only `invalid_request_body`, which
            // names no field.
            maxLength={MAX_TRIAGE_NOTE}
            // Required, and enforced by the route too, for both decisions. A
            // decision without a reason is indistinguishable from a mistake,
            // and this is the record an auditor defends later.
            style={{
              padding: '7px 9px',
              borderRadius: 7,
              border: `1px solid ${T.rule}`,
              fontFamily: FONT.sans,
              fontSize: 12.5,
              color: T.ink,
              resize: 'vertical',
            }}
          />
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="submit"
          disabled={busy || state === null || note.trim() === ''}
          style={primary}
        >
          {busy ? 'Saving…' : 'Record decision'}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={link}>
          Cancel
        </button>
        {error ? <Error>{error}</Error> : null}
      </div>
    </form>
  );
}

function Error({ children }: { children: React.ReactNode }) {
  return (
    <span
      role="alert"
      style={{ fontFamily: FONT.sans, fontSize: 11.5, color: T.failDeep }}
    >
      {children}
    </span>
  );
}

const promptStyle = {
  fontFamily: FONT.sans,
  fontSize: 11.5,
  fontWeight: 650,
  color: T.inkSoft,
} as const;

const radioRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
} as const;

/**
 * Sized and spaced for WCAG 2.2 SC 2.5.8, which our own engine enforces here.
 *
 * A default user-agent radio is about 13px square, and two of them 6px apart
 * failed `target-size` when this control first ran through the hydration
 * suite's axe pass — the product finding a barrier in the product. The
 * criterion is met either by a 24px target or by spacing: an undersized target
 * passes when no other target's 24px circle overlaps its own. 18px of radio
 * plus the 12px `ROW_GAP` below puts 30px between centres, which clears it
 * without a control that dwarfs the 12.5px label beside it.
 *
 * Both numbers are load-bearing together. Shrinking either one re-opens the
 * violation, and the build is asserted at zero.
 */
const radioInput = {
  width: 18,
  height: 18,
  margin: 0,
  flexShrink: 0,
  cursor: 'pointer',
} as const;

/** See `radioInput`: this is the spacing half of the target-size arithmetic. */
const ROW_GAP = 12;

/**
 * `inkSoft` rather than `inkMuted`: this is the choice being made, and the
 * screen's own axe pass is asserted at zero, so a label a shade short of
 * 4.5:1 is a failed build rather than a nit.
 */
const radioLabel = {
  fontFamily: FONT.sans,
  fontSize: 12.5,
  color: T.inkSoft,
  cursor: 'pointer',
} as const;

const link = {
  padding: 0,
  border: 'none',
  background: 'none',
  fontFamily: FONT.sans,
  fontSize: 12,
  fontWeight: 600,
  color: T.accent,
  textDecoration: 'underline',
  cursor: 'pointer',
} as const;

const primary = {
  padding: '6px 12px',
  border: 'none',
  borderRadius: 7,
  background: T.accent,
  fontFamily: FONT.sans,
  fontSize: 12,
  fontWeight: 650,
  color: '#fff',
  cursor: 'pointer',
} as const;
