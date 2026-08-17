'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Environment } from '../../../../domain/contracts';
import type { JourneyStepView } from '../../../../domain/journey-step';
import {
  actionsFor,
  describeDraftProblem,
  draftsFromViews,
  emptyDraft,
  toAuthoredSteps,
  type DraftType,
  type StepDraft,
} from '../../../../domain/journey-step-draft';
import { isActionAllowed } from '../../../../domain/policy';
import { FONT, T } from '../../lib/tokens';

/**
 * Correct what a journey walks, from the screen that shows it.
 *
 * The only way to change a journey's steps was curl with a bearer token, which
 * meant in practice that they were never changed: a stale selector produced a
 * second journey called `acme-login-2` rather than a fix, and `getLatestRun`
 * then compared a client's audits against a baseline recorded for a journey
 * nobody runs any more.
 *
 * Structured rows rather than a JSON textarea, and that is not a style
 * preference. A textarea makes the operator the parser — a trailing comma is a
 * 400, and the shape a step must have lives in a schema they cannot see. Rows
 * can only produce steps of shapes that exist.
 *
 * **The read list stays the read list.** When the editor is closed this
 * renders its `children`, which is the server-rendered step list from 5b. Two
 * lists of the same steps on screen at once, one of them stale, is how an
 * operator edits the wrong thing.
 */

/**
 * What this route can answer, in words.
 *
 * `journey_has_no_steps` and `journey_not_runnable` are here even though the
 * editor refuses to save an empty list itself: the guard the route applies is
 * about the state a patch *leaves behind*, so a journey scheduled Daily whose
 * steps are edited into something unrunnable is refused there, and an operator
 * reading a bare code learns nothing.
 */
const MESSAGES: Record<string, string> = {
  inline_credential:
    'A step carried a credential of its own. Use a stored credential by name instead.',
  invalid_request_body: 'Those steps were refused. Check every row and try again.',
  invalid_journey_steps: 'Those steps are not ones a run could walk.',
  action_not_allowed_here:
    'One of these steps does something this journey’s environment does not allow.',
  journey_has_no_steps: 'A journey needs at least one step.',
  journey_not_runnable: 'This journey has no target URL, so nothing can run it.',
  journey_not_found: 'That journey is no longer on this client.',
  unauthorized: 'Your session expired. Reload and sign in again.',
};

const TYPES: Array<{ value: DraftType; label: string }> = [
  { value: 'goto', label: 'Go to a page' },
  { value: 'click', label: 'Click something' },
  { value: 'fill', label: 'Fill a field' },
  { value: 'expect', label: 'Check it arrived' },
];

const inputStyle = {
  fontFamily: FONT.mono,
  fontSize: 12,
  padding: '5px 8px',
  borderRadius: 7,
  border: `1px solid ${T.rule}`,
  background: T.surface,
  color: T.ink,
  minWidth: 0,
} as const;

const smallButtonStyle = {
  fontFamily: FONT.sans,
  fontSize: 12,
  fontWeight: 600,
  padding: '4px 9px',
  borderRadius: 7,
  border: `1px solid ${T.rule}`,
  background: T.surface,
  color: T.ink,
  cursor: 'pointer',
} as const;

export function JourneyStepsEditor({
  clientId,
  journeyId,
  journeyName,
  environment,
  steps,
  children,
}: {
  clientId: string;
  journeyId: string;
  journeyName: string;
  environment: Environment;
  steps: JourneyStepView[];
  children: ReactNode;
}) {
  const router = useRouter();
  const fieldPrefix = useId();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<StepDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Rows added in this session need keys that cannot collide with `stored-N`
  // or with each other. A counter, not `Math.random`, so two renders of the
  // same edit produce the same markup.
  const added = useRef(0);

  function start() {
    // Seeded on open rather than held from the first render, so an edit that
    // lands from another tab — or this one's own `router.refresh()` — is what
    // the next edit starts from.
    setDrafts(draftsFromViews(steps));
    setError(null);
    setOpen(true);
  }

  function update(key: string, patch: Partial<StepDraft>) {
    setDrafts((current) =>
      current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)),
    );
  }

  function move(index: number, by: -1 | 1) {
    setDrafts((current) => {
      const next = [...current];
      const target = index + by;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const writable = toAuthoredSteps(drafts, environment);
  // A journey that never says it arrived is the failure this whole plan is
  // named for: a login that silently fails is audited as though it succeeded,
  // and the run reports a clean pass over the login page. Said here, where the
  // steps are being written, rather than on a run result — a warning attached
  // to an audit would fire on healthy runs and teach an operator to ignore it.
  const noArrivalCheck = drafts.length > 0 && !drafts.some((draft) => draft.type === 'expect');

  async function save() {
    if (!writable.ok) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/platform/clients/${clientId}/journeys/${journeyId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ steps: writable.steps }),
      });

      if (!response.ok) {
        const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(
          (parsed?.error && MESSAGES[parsed.error]) ??
            parsed?.error ??
            `That did not save (${response.status}).`,
        );
        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div style={{ flexBasis: '100%' }}>
        {children}
        <button type="button" onClick={start} style={{ ...smallButtonStyle, marginTop: 6 }}>
          {/* Named, because every row carries one of these. */}
          Edit steps for {journeyName}
        </button>
      </div>
    );
  }

  return (
    <div style={{ flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ol
        style={{
          margin: '4px 0 0',
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {drafts.map((draft, index) => {
          const id = (name: string) => `${fieldPrefix}-${draft.key}-${name}`;
          const problem = describeDraftProblem(draft);
          const actions = actionsFor(environment, draft.action);
          const actionRefused = draft.action !== '' && !isActionAllowed(environment, draft.action);

          return (
            <li key={draft.key}>
              <fieldset
                style={{
                  margin: 0,
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: `1px solid ${problem ? T.fail : T.rule}`,
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'flex-end',
                  gap: 8,
                }}
              >
                <legend style={{ fontFamily: FONT.sans, fontSize: 12, fontWeight: 650 }}>
                  Step {index + 1}
                </legend>

                <Field id={id('type')} label="Does">
                  <select
                    id={id('type')}
                    value={draft.type}
                    onChange={(event) =>
                      update(draft.key, { type: event.target.value as DraftType })
                    }
                    style={inputStyle}
                  >
                    {/*
                      Only offered while it is the state a row is in. A stored
                      step the runner does not recognise cannot be guessed at,
                      so its row starts here rather than being silently
                      proposed as a navigation.
                    */}
                    {draft.type === '' ? <option value="">Choose…</option> : null}
                    {TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field id={id('action')} label="Action">
                  <select
                    id={id('action')}
                    value={draft.action}
                    onChange={(event) => update(draft.key, { action: event.target.value })}
                    style={inputStyle}
                  >
                    {draft.action === '' ? <option value="">Choose…</option> : null}
                    {actions.map((action) => (
                      <option key={action} value={action}>
                        {action}
                      </option>
                    ))}
                  </select>
                </Field>

                {draft.type === 'goto' ? (
                  <Field id={id('path')} label="Path">
                    <input
                      id={id('path')}
                      value={draft.path}
                      onChange={(event) => update(draft.key, { path: event.target.value })}
                      style={{ ...inputStyle, flex: '1 1 220px' }}
                    />
                  </Field>
                ) : null}

                {draft.type === 'click' || draft.type === 'fill' || draft.type === 'expect' ? (
                  <Field
                    id={id('selector')}
                    label={draft.type === 'expect' ? 'Selector (optional)' : 'Selector'}
                  >
                    <input
                      id={id('selector')}
                      value={draft.selector}
                      onChange={(event) => update(draft.key, { selector: event.target.value })}
                      style={{ ...inputStyle, flex: '1 1 180px' }}
                    />
                  </Field>
                ) : null}

                {draft.type === 'expect' ? (
                  <Field id={id('url')} label="URL contains (optional)">
                    <input
                      id={id('url')}
                      value={draft.urlIncludes}
                      onChange={(event) => update(draft.key, { urlIncludes: event.target.value })}
                      style={{ ...inputStyle, flex: '1 1 180px' }}
                    />
                  </Field>
                ) : null}

                {draft.type === 'fill' ? (
                  <>
                    <Field id={id('mode')} label="Types">
                      <select
                        id={id('mode')}
                        value={draft.fillMode}
                        onChange={(event) =>
                          update(draft.key, {
                            fillMode: event.target.value === 'credential' ? 'credential' : 'value',
                          })
                        }
                        style={inputStyle}
                      >
                        <option value="value">A plain value</option>
                        <option value="credential">A stored credential</option>
                      </select>
                    </Field>

                    {draft.fillMode === 'credential' ? (
                      <>
                        <Field id={id('cred')} label="Credential name">
                          <input
                            id={id('cred')}
                            value={draft.credentialRef}
                            onChange={(event) =>
                              update(draft.key, { credentialRef: event.target.value })
                            }
                            style={{ ...inputStyle, flex: '1 1 140px' }}
                          />
                        </Field>
                        <Field id={id('field')} label="Field">
                          <select
                            id={id('field')}
                            value={draft.field}
                            onChange={(event) =>
                              update(draft.key, {
                                field: event.target.value === 'pass' ? 'pass' : 'user',
                              })
                            }
                            style={inputStyle}
                          >
                            <option value="user">Username</option>
                            <option value="pass">Password</option>
                          </select>
                        </Field>
                      </>
                    ) : (
                      <Field id={id('value')} label="Value">
                        {/*
                          A plain text input, never a password one. A step that
                          needs a secret uses a credential by name; masking
                          this box would suggest it is a safe place for one.
                        */}
                        <input
                          id={id('value')}
                          type="text"
                          value={draft.value}
                          onChange={(event) => update(draft.key, { value: event.target.value })}
                          style={{ ...inputStyle, flex: '1 1 160px' }}
                        />
                      </Field>
                    )}
                  </>
                ) : null}

                <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move step ${index + 1} earlier`}
                    style={smallButtonStyle}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === drafts.length - 1}
                    aria-label={`Move step ${index + 1} later`}
                    style={smallButtonStyle}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDrafts((current) => current.filter((row) => row.key !== draft.key))
                    }
                    aria-label={`Remove step ${index + 1}`}
                    style={smallButtonStyle}
                  >
                    Remove
                  </button>
                </span>

                {problem ? (
                  <p
                    style={{
                      flexBasis: '100%',
                      margin: 0,
                      fontFamily: FONT.sans,
                      fontSize: 12,
                      color: T.fail,
                    }}
                  >
                    {problem}
                  </p>
                ) : null}

                {actionRefused ? (
                  <p
                    style={{
                      flexBasis: '100%',
                      margin: 0,
                      fontFamily: FONT.sans,
                      fontSize: 12,
                      color: T.fail,
                    }}
                  >
                    {/*
                      This blocks the save, and the route refuses the same
                      pair. An earlier version warned and let it through on the
                      reasoning that the action was already stored and blocking
                      would trap the operator — but it does not: the dropdown
                      beside this offers every action that *is* allowed, and
                      the row can be removed. What the softer version actually
                      produced was a save the route then rejected, which is two
                      doors disagreeing about one rule.
                    */}
                    “{draft.action}” is not allowed in {environment}. Choose another action or
                    remove this step.
                  </p>
                ) : null}
              </fieldset>
            </li>
          );
        })}
      </ol>

      {noArrivalCheck ? (
        <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}>
          This journey never says it arrived. Without a “check it arrived” step, a login that
          silently fails is audited as though it worked — and a login page scores well.
        </p>
      ) : null}

      {error ? (
        <p role="alert" style={{ margin: 0, fontFamily: FONT.sans, fontSize: 12.5, color: T.fail }}>
          {error}
        </p>
      ) : null}

      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setDrafts((current) => [...current, emptyDraft(`new-${added.current++}`)])}
          style={smallButtonStyle}
        >
          Add a step
        </button>
        <button
          type="button"
          onClick={save}
          disabled={busy || !writable.ok}
          style={{
            ...smallButtonStyle,
            background: busy || !writable.ok ? T.surfaceSunk : T.surface,
            color: busy || !writable.ok ? T.inkMuted : T.ink,
            cursor: busy || !writable.ok ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Saving…' : 'Save steps'}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={smallButtonStyle}>
          Cancel
        </button>
        {/*
          Why the button is dead, said out loud.

          A disabled control with no explanation is a dead end — it cannot take
          focus, so a screen reader user reaches the end of the form and finds
          nothing that says what is wrong. The per-row sentences are the detail;
          this is the one that is always there when the save is refused.
        */}
        {!writable.ok ? (
          <span style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}>
            {drafts.length === 0
              ? 'A journey needs at least one step.'
              : 'Finish the steps marked below before saving.'}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * A control with a real label.
 *
 * Not a placeholder and not an `aria-label`: the axe suite runs over these
 * screens at zero violations, and a form this size is exactly where a
 * disappearing label costs somebody the ability to use it.
 */
function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <label htmlFor={id} style={{ fontFamily: FONT.sans, fontSize: 11, color: T.inkMuted }}>
        {label}
      </label>
      {children}
    </span>
  );
}
