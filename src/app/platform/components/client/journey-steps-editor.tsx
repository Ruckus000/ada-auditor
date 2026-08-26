'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { Environment } from '../../../../domain/contracts';
import { CREDENTIAL_REF_PATTERN } from '../../../../domain/credential-ref';
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
import { inertWhen } from '../../lib/inert-button';
import { JOURNEY_STEPS_SAVED } from '../../lib/journey-events';
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

/**
 * What the credential surface can answer, in words. Split from `MESSAGES`
 * because the save these explain goes to a different route with failure modes
 * the step editor's own save cannot produce.
 */
const CREDENTIAL_MESSAGES: Record<string, string> = {
  credential_store_not_configured:
    'This deployment has no credential key, so values cannot be stored here. Set AUDITOR_CREDENTIAL_KEY, or keep using environment variables.',
  invalid_credential_ref:
    'That credential name cannot be stored. Letters, numbers, hyphens and underscores only.',
  invalid_request_body: 'Both a username and a password are needed, up to 512 characters each.',
  unauthorized: 'Your session expired. Reload and sign in again.',
};

/** What the presence listing answers per ref. Booleans, never values. */
type StoredCredentialPresence = { ref: string; user: boolean; pass: boolean; updatedAt: string };

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

/**
 * The same button, unavailable.
 *
 * These controls keep their place in the tab order rather than taking
 * `disabled` (see `lib/inert-button`), so the browser no longer greys them out
 * on our behalf and something has to. A control that is inert and still looks
 * live is the defect this trades for otherwise.
 */
const inertSmallButtonStyle = {
  ...smallButtonStyle,
  background: T.surfaceSunk,
  color: T.inkMuted,
  cursor: 'default',
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
  // Which credentials the store holds for this client, keyed by ref. Null
  // until the listing answers — presence is a badge, never a gate, so the
  // editor edits whether or not this ever loads.
  const [storedCredentials, setStoredCredentials] = useState<Record<
    string,
    StoredCredentialPresence
  > | null>(null);

  async function loadStoredCredentials() {
    try {
      const response = await fetch(`/api/platform/clients/${clientId}/credentials`);
      if (!response.ok) return;
      const parsed = (await response.json()) as { credentials?: StoredCredentialPresence[] };
      setStoredCredentials(
        Object.fromEntries((parsed.credentials ?? []).map((entry) => [entry.ref, entry])),
      );
    } catch {
      // The badge degrades to silence. Saying "could not load" on every row
      // would put an error in front of an operator who only came to reorder
      // steps.
    }
  }
  // Rows added in this session need keys that cannot collide with `stored-N`
  // or with each other. A counter, not `Math.random`, so two renders of the
  // same edit produce the same markup.
  const added = useRef(0);
  // Keeping the save button focusable is only half the answer here: a
  // successful save — and Cancel — unmount the whole form, so the focused
  // control disappears and focus lands on `<body>` anyway. Closing the editor
  // therefore hands focus back to the button that opened it, the way a closed
  // dialog returns focus to its opener.
  const openButton = useRef<HTMLButtonElement>(null);
  // Only after *this* component closed the editor. Without the flag the effect
  // fires on first mount and steals focus from wherever the operator was on a
  // page that has one of these per journey.
  const returnFocus = useRef(false);

  useEffect(() => {
    if (open || !returnFocus.current) return;
    returnFocus.current = false;
    openButton.current?.focus();
  }, [open]);

  // The other way a reorder loses the operator's place, and the one
  // `aria-disabled` does not touch — on the engines where it happens.
  //
  // Reordering the drafts makes React move the keyed `<li>`, and a DOM move
  // has historically been remove-then-insert: moving a node blurs the focused
  // element inside it, so focus lands on `<body>` after *every* successful
  // move, not only the one that reaches an end. Measured, not assumed —
  // `insertBefore` on a list item containing the focused button leaves
  // `document.activeElement` as `<body>`.
  //
  // React 19.2 uses `Element.moveBefore` where the browser has it, which is
  // atomic and preserves focus, so in Chromium this effect is a no-op that
  // re-focuses the button already focused. `moveBefore` is Chromium-only
  // today: on Firefox and Safari React falls back to `insertBefore` and the
  // defect is real. Our hydration suite is Chromium, so the suite is not what
  // justifies this — the operator on another browser is.
  //
  // Focusing the button that was pressed is also where the operator wants it:
  // pressing ↓ twice moves the same step down twice.
  const list = useRef<HTMLOListElement>(null);
  const refocus = useRef<string | null>(null);

  useEffect(() => {
    const handle = refocus.current;
    if (!handle) return;
    refocus.current = null;
    list.current?.querySelector<HTMLButtonElement>(`[data-move="${handle}"]`)?.focus();
  }, [drafts]);

  function start() {
    // Seeded on open rather than held from the first render, so an edit that
    // lands from another tab — or this one's own `router.refresh()` — is what
    // the next edit starts from.
    setDrafts(draftsFromViews(steps));
    setError(null);
    setOpen(true);
    // Fire-and-forget: the badges fill in when the listing answers, and the
    // form does not wait on them.
    void loadStoredCredentials();
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

      returnFocus.current = true;
      setOpen(false);
      router.refresh();

      // Announce the save so a verify control beside this editor can walk the
      // path that was just written, without anybody having to press a second
      // button.
      //
      // An event rather than a callback prop, because of where the pair is
      // composed: three wizard stages put this editor next to `VerifyButton`,
      // and all three are *server* components, which cannot hand a function to
      // a client one. The alternatives were restructuring those three around a
      // client wrapper whose only job is to hold a number, or threading a
      // `useImperativeHandle` through both — more machinery than a named
      // announcement, and no more traceable.
      //
      // Scoped by `journeyId`, so a screen showing two editors cannot make one
      // journey's save verify a different journey's path.
      window.dispatchEvent(
        new CustomEvent(JOURNEY_STEPS_SAVED, { detail: { journeyId } }),
      );
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
        <button
          type="button"
          ref={openButton}
          onClick={start}
          style={{ ...smallButtonStyle, marginTop: 6 }}
        >
          {/* Named, because every row carries one of these. */}
          Edit steps for {journeyName}
        </button>
      </div>
    );
  }

  return (
    <div style={{ flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ol
        ref={list}
        style={{
          margin: '4px 0 0',
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* eslint-disable-next-line react-hooks/refs -- the reorder handlers below write `refocus.current`; see `lib/inert-button` */}
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
                        {/*
                          Only for a name that could resolve: the pattern is
                          the same one the route holds the ref to, so this
                          never offers to store under a name a step could not
                          use.
                        */}
                        {CREDENTIAL_REF_PATTERN.test(draft.credentialRef) ? (
                          <CredentialValues
                            clientId={clientId}
                            credentialRef={draft.credentialRef}
                            presence={
                              storedCredentials === null
                                ? undefined
                                : (storedCredentials[draft.credentialRef] ?? null)
                            }
                            onSaved={loadStoredCredentials}
                          />
                        ) : null}
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
                  {/*
                    These are the sharpest case for `aria-disabled` in the
                    product: the click is what makes the control unavailable.
                    Moving a step to the top disables ↑ *on the button being
                    pressed*, and with `disabled` that dropped focus to
                    `<body>` in the middle of reordering a list — with the
                    keyboard the only way to reorder one.
                  */}
                  <button
                    type="button"
                    // Keyed on the draft, not the position: after the move it
                    // is the same step's button, one row further up.
                    data-move={`${draft.key}-earlier`}
                    {...inertWhen(index === 0, () => {
                      refocus.current = `${draft.key}-earlier`;
                      move(index, -1);
                    })}
                    // Re-read after a move, so the focused button says where
                    // the step ended up.
                    aria-label={`Move step ${index + 1} earlier`}
                    style={index === 0 ? inertSmallButtonStyle : smallButtonStyle}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    data-move={`${draft.key}-later`}
                    {...inertWhen(index === drafts.length - 1, () => {
                      refocus.current = `${draft.key}-later`;
                      move(index, 1);
                    })}
                    aria-label={`Move step ${index + 1} later`}
                    style={index === drafts.length - 1 ? inertSmallButtonStyle : smallButtonStyle}
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
          // `save` writes `returnFocus.current`. Same false positive as the
          // reorder buttons above — see `lib/inert-button`.
          // eslint-disable-next-line react-hooks/refs
          {...inertWhen(busy || !writable.ok, save)}
          // Only while the sentence below is on the page: a description
          // pointing at an id that is not there is itself a violation.
          aria-describedby={writable.ok ? undefined : `${fieldPrefix}-save-refused`}
          style={busy || !writable.ok ? inertSmallButtonStyle : smallButtonStyle}
        >
          {busy ? 'Saving…' : 'Save steps'}
        </button>
        <button
          type="button"
          onClick={() => {
            returnFocus.current = true;
            setOpen(false);
          }}
          style={smallButtonStyle}
        >
          Cancel
        </button>
        {/*
          Why the button is refusing, said out loud.

          An unavailable control with no explanation is a dead end: the operator
          reaches the end of the form and finds nothing that says what is wrong.
          The per-row sentences are the detail; this is the one that is always
          there when the save is refused. Now that the button keeps its place in
          the tab order it can also *describe* itself with this — a `disabled`
          button could not be reached to hear it.
        */}
        {!writable.ok ? (
          <span
            id={`${fieldPrefix}-save-refused`}
            style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}
          >
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
 * The values behind one credential name: a presence badge and a write-only
 * "Set values" disclosure.
 *
 * Write-only is the whole design. The inputs are never pre-filled — the GET
 * behind the badge answers presence and cannot answer a value — and a
 * successful save clears them, because this surface holds a secret for
 * exactly as long as the write takes. What persists on screen afterwards is
 * the badge saying the store has it, which is everything an operator needs to
 * know and everything this component is allowed to know.
 *
 * `presence` is three-valued on purpose: `undefined` while the listing has
 * not answered (say nothing), `null` when it answered and this ref is not in
 * it (say "nothing stored"), an entry when it is. Collapsing the first two
 * would tell an operator "nothing stored" on a listing that merely had not
 * arrived yet.
 */
function CredentialValues({
  clientId,
  credentialRef,
  presence,
  onSaved,
}: {
  clientId: string;
  credentialRef: string;
  presence: StoredCredentialPresence | null | undefined;
  onSaved: () => void;
}) {
  const idPrefix = useId();
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    // Closing clears: a typed value must not linger behind a collapsed
    // disclosure on a screen somebody walks away from.
    setUser('');
    setPass('');
    setError(null);
    setOpen((current) => !current);
  }

  async function save() {
    if (busy || !user || !pass) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/platform/clients/${clientId}/credentials/${credentialRef}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ user, pass }),
        },
      );

      if (!response.ok) {
        const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(
          (parsed?.error && CREDENTIAL_MESSAGES[parsed.error]) ??
            `That did not save (${response.status}).`,
        );
        return;
      }

      // Cleared on success — see the component comment. The badge refresh is
      // what confirms the write, and it confirms it from the server rather
      // than from this component's optimism.
      setUser('');
      setPass('');
      setOpen(false);
      onSaved();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted }}>
          {presence === undefined
            ? `credential ${credentialRef}`
            : presence === null
              ? `credential ${credentialRef} — nothing stored for this client`
              : `credential ${credentialRef} — stored for this client · updated ${presence.updatedAt.slice(0, 10)}`}
        </span>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={`${open ? 'Close values' : 'Set values'} for ${credentialRef}`}
          style={smallButtonStyle}
        >
          {open ? 'Close values' : 'Set values'}
        </button>
      </span>

      {open ? (
        <span style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field id={`${idPrefix}-user`} label="Username">
            <input
              id={`${idPrefix}-user`}
              type="text"
              autoComplete="off"
              value={user}
              onChange={(event) => setUser(event.target.value)}
              style={{ ...inputStyle, flex: '1 1 160px' }}
            />
          </Field>
          <Field id={`${idPrefix}-pass`} label="Password">
            {/*
              `type="password"` is correct HERE, and that does not contradict
              the literal-value box above being `type="text"`. That box holds
              ordinary content — search terms, postcodes — and masking it
              would suggest it is a safe place for a secret, which it is not.
              This box exists for exactly one secret, headed for an encrypted
              write-only store, and masking it is the point.
            */}
            <input
              id={`${idPrefix}-pass`}
              type="password"
              autoComplete="off"
              value={pass}
              onChange={(event) => setPass(event.target.value)}
              style={{ ...inputStyle, flex: '1 1 160px' }}
            />
          </Field>
          <button
            type="button"
            {...inertWhen(busy || !user || !pass, save)}
            aria-describedby={!user || !pass ? `${idPrefix}-needs-both` : undefined}
            style={busy || !user || !pass ? inertSmallButtonStyle : smallButtonStyle}
          >
            {busy ? 'Saving…' : 'Save values'}
          </button>
          {!user || !pass ? (
            <span
              id={`${idPrefix}-needs-both`}
              style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}
            >
              A login is both halves — enter a username and a password.
            </span>
          ) : null}
        </span>
      ) : null}

      {error ? (
        <p role="alert" style={{ margin: 0, fontFamily: FONT.sans, fontSize: 12.5, color: T.fail }}>
          {error}
        </p>
      ) : null}
    </span>
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
