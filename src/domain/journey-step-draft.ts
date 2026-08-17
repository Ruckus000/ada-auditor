import type { Environment } from './contracts';
import { AUTHORABLE_ACTIONS, isActionAllowed } from './policy';
import { authoredStepsSchema, type JourneyStepView } from './journey-step';

/**
 * A step while somebody is still typing it.
 *
 * The editor needs a shape a form can hold, which is not the shape a step is
 * stored in: a half-filled row is not a step, and switching a row from `click`
 * to `fill` must not throw away the selector that was already typed. So every
 * field is present and every field is a string, and `toAuthoredSteps` is the
 * one place a set of drafts becomes something that could be written.
 *
 * Pure, and in `domain/` for the reason `settledLocation` ended up in
 * `services/`: the rules here are worth testing in the fast suite, and a rule
 * that only runs inside a React component is a rule with no test.
 *
 * **What is deliberately not here: the stored literal value.** `toStepViews`
 * refuses to carry a `value` off a stored row, because rows written before
 * `authoredStepSchema` can hold a real password and a screen is a worse place
 * for one than a database column. Seeding it into an input would undo exactly
 * that, so a row that types a literal comes back with the box empty and
 * `literalWithheld` set, and the editor says the value is not shown and has to
 * be retyped. The cost is real — an operator fixing step 5 retypes the search
 * term in step 2 — and it is the cost of the screen never being a place a
 * stored secret can be read. The alternative, a "keep what is stored" marker
 * merged server-side by position, is wrong the first time a row is reordered.
 */
export type DraftType = '' | 'goto' | 'click' | 'fill' | 'expect';

export type StepDraft = {
  /**
   * A stable identity for a row while it is being edited.
   *
   * React needs one, and the index cannot be it: reordering rows by index as
   * the key makes React reuse the wrong DOM node, so the focus and the caret
   * follow the position rather than the row. Never persisted — a stored step
   * has no id, and giving it one is a schema change nothing has asked for.
   */
  key: string;
  type: DraftType;
  action: string;
  path: string;
  selector: string;
  /** Which of the two `fill` shapes this row is. Ignored for every other type. */
  fillMode: 'value' | 'credential';
  value: string;
  credentialRef: string;
  field: 'user' | 'pass';
  urlIncludes: string;
  /** This row was seeded from a stored step whose literal value was not read. */
  literalWithheld: boolean;
  /** The stored row was not a step the runner recognises, so it had to start blank. */
  unrecognised: boolean;
};

const BLANK = {
  path: '',
  selector: '',
  fillMode: 'value',
  value: '',
  credentialRef: '',
  field: 'user',
  urlIncludes: '',
  literalWithheld: false,
  unrecognised: false,
} as const;

/**
 * A new row, ready to type into.
 *
 * `goto`/`navigate` rather than an unset type: it is the commonest step and
 * the only one a journey cannot do without, so the default costs a dropdown
 * change only when the guess is wrong.
 */
export function emptyDraft(key: string): StepDraft {
  return { ...BLANK, key, type: 'goto', action: 'navigate' };
}

function isAuthorable(action: unknown): action is (typeof AUTHORABLE_ACTIONS)[number] {
  return (
    typeof action === 'string' &&
    (AUTHORABLE_ACTIONS as readonly string[]).includes(action)
  );
}

/**
 * Load stored steps into the form.
 *
 * From `JourneyStepView`, not from the raw row, and that is the point: the
 * view is the projection that already refuses to carry a literal, so the
 * editor cannot become a second path by which one reaches a screen.
 *
 * A row the runner does not recognise seeds with no type — it cannot be
 * guessed, and guessing `goto` would quietly propose rewriting a click as a
 * navigation. Its action survives if it is one an operator could have written,
 * because that much is real and re-typing it is busywork.
 */
export function draftsFromViews(views: readonly JourneyStepView[]): StepDraft[] {
  return views.map((view) => {
    const key = `stored-${view.position}`;

    if (!view.recognised) {
      return {
        ...BLANK,
        key,
        type: '',
        action: isAuthorable(view.action) ? view.action : '',
        literalWithheld: view.hasLiteralValue === true,
        unrecognised: true,
      };
    }

    return {
      ...BLANK,
      key,
      type: view.type as DraftType,
      action: view.action,
      path: view.path ?? '',
      selector: view.selector ?? '',
      urlIncludes: view.urlIncludes ?? '',
      fillMode: view.credentialRef === undefined ? 'value' : 'credential',
      credentialRef: view.credentialRef ?? '',
      field: view.field === 'pass' ? 'pass' : 'user',
      literalWithheld: view.hasLiteralValue === true,
      unrecognised: false,
    };
  });
}

/**
 * One row, as the object it is trying to become.
 *
 * Only the fields that type uses, so a selector typed before the row was
 * switched to `goto` does not travel as an unknown key — `authoredStepSchema`
 * is `.strict()` and would refuse the whole array over a leftover the operator
 * cannot see.
 */
function draftToStep(draft: StepDraft): unknown {
  const action = draft.action;

  switch (draft.type) {
    case 'goto':
      return { action, type: 'goto', path: draft.path };
    case 'click':
      return { action, type: 'click', selector: draft.selector };
    case 'fill':
      return draft.fillMode === 'credential'
        ? {
            action,
            type: 'fill',
            selector: draft.selector,
            credentialRef: draft.credentialRef,
            field: draft.field,
          }
        : { action, type: 'fill', selector: draft.selector, value: draft.value };
    case 'expect':
      return {
        action,
        type: 'expect',
        // Omitted rather than sent empty: `''` fails `STEP_TEXT`'s `min(1)`,
        // so a URL-only expectation would be refused for the selector box
        // nobody filled in.
        ...(draft.urlIncludes === '' ? {} : { urlIncludes: draft.urlIncludes }),
        ...(draft.selector === '' ? {} : { selector: draft.selector }),
      };
    default:
      return null;
  }
}

/**
 * What is wrong with this row, in words an operator can act on.
 *
 * Advisory, not the gate. `authoredStepsSchema` decides whether a save may
 * happen — one rule, the same one the route enforces — and these sentences
 * explain the commonest ways to fail it. Keeping them advisory is what stops
 * them being a second, drifting copy of the schema: if one is ever missing,
 * the save is still refused, just less helpfully.
 */
export function describeDraftProblem(draft: StepDraft): string | null {
  if (draft.type === '') return 'Choose what this step does, or remove it.';
  if (draft.action === '') return 'Choose an action.';

  if (draft.type === 'goto' && draft.path === '') return 'A navigation needs a path.';
  if (draft.type === 'click' && draft.selector === '') return 'A click needs a selector.';

  if (draft.type === 'fill') {
    if (draft.selector === '') return 'A fill needs a selector.';
    if (draft.fillMode === 'credential') {
      if (draft.credentialRef === '') return 'Name the credential this step should use.';
    } else {
      if (draft.literalWithheld && draft.value === '') {
        return 'The stored value is not shown here. Retype it to keep this step, or use a credential instead.';
      }
      if (draft.value === '') return 'Type the value this step should enter.';
      if (draft.action === 'login') {
        return 'A login must use a credential, never a typed-in password.';
      }
    }
  }

  if (draft.type === 'expect' && draft.urlIncludes === '' && draft.selector === '') {
    return 'An arrival check needs a URL fragment, a selector, or both.';
  }

  return null;
}

/**
 * The whole list, as the route would have to accept it.
 *
 * The gate is `authoredStepsSchema` itself rather than a tally of
 * `describeDraftProblem`, so the editor and the route cannot disagree about
 * what is writable. One thing is refused here that the schema is happy with:
 * **no steps at all.** `[]` is a valid array of valid steps, and it leaves a
 * journey `journeyRunRefusal` answers `journey_has_no_steps` to — a save that
 * succeeds and makes the journey unrunnable is this plan's whole subject.
 *
 * An empty typed-in value was the other one, and it belongs in the schema
 * rather than here: the rule is "a fill must type something", which is a fact
 * about a step and not about a form. `authoredStepSchema` carries it now, so
 * the route refuses it too — this editor is not the only way to write one.
 */
export function toAuthoredSteps(
  drafts: readonly StepDraft[],
  environment: Environment,
): { ok: true; steps: unknown[] } | { ok: false } {
  if (drafts.length === 0) return { ok: false };

  // An action this environment forbids, which the schema cannot see: it knows
  // what a step *is*, not where it will run. The write routes refuse the same
  // pair, and they have to agree — an editor that lets a save through for the
  // route to reject is two doors disagreeing about one rule, which is the
  // failure the shared step cap and the shared credential check were both
  // written to end.
  if (drafts.some((draft) => draft.action !== '' && !isActionAllowed(environment, draft.action))) {
    return { ok: false };
  }

  const parsed = authoredStepsSchema.safeParse(drafts.map(draftToStep));
  return parsed.success ? { ok: true, steps: parsed.data } : { ok: false };
}

/**
 * The actions this journey may be written with, given where it runs.
 *
 * Not `AUTHORABLE_ACTIONS` flat, and the difference is the bug that tuple
 * exists to prevent. `submit-safe` is authorable because *some* environment
 * permits it — but production does not, and a journey defaults to production.
 * Offering it there would store a journey that walks steps 1..N-1 against a
 * live site and then aborts at step N with "Action is not allowed", which is
 * the same "found out at the wrong end" that `delete` was removed for.
 *
 * The stored action is always included even when the environment forbids it.
 * A dropdown that silently dropped it would rewrite a step the operator came
 * to this screen to leave alone; the editor warns instead.
 */
export function actionsFor(environment: Environment, keep?: string): string[] {
  const allowed: string[] = AUTHORABLE_ACTIONS.filter((action) =>
    isActionAllowed(environment, action),
  );
  return keep && !allowed.includes(keep) ? [...allowed, keep] : allowed;
}
