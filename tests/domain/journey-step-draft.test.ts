import { describe, expect, it } from 'vitest';
import { toStepViews } from '../../src/domain/journey-step';
import {
  actionsFor,
  describeDraftProblem,
  draftsFromViews,
  emptyDraft,
  toAuthoredSteps,
} from '../../src/domain/journey-step-draft';

/**
 * The form's rules, tested where they are pure.
 *
 * The editor is a client component and none of this can be reached from the
 * fast suite once it is inside one — which is the same reason `settledLocation`
 * moved out of the browser integration. What is being checked here is not the
 * markup: it is that loading a journey and saving it back does not change what
 * the journey does.
 */

const STORED = [
  { action: 'navigate', type: 'goto', path: 'login.html' },
  { action: 'login', type: 'fill', selector: '#u', credentialRef: 'acme', field: 'user' },
  { action: 'login', type: 'click', selector: '#submit' },
  { action: 'inspect', type: 'expect', urlIncludes: '/dashboard', selector: '#menu' },
];

function load(steps: unknown[]) {
  return draftsFromViews(toStepViews(steps));
}

describe('loading a journey into the editor and saving it back', () => {
  /**
   * The property that matters most, and the one an editor is most likely to
   * break quietly: opening a journey, touching nothing, and saving must store
   * the journey that was already there. Anything less means an operator fixing
   * step 5 silently rewrites step 2.
   */
  it('returns exactly the steps it was given', () => {
    const saved = toAuthoredSteps(load(STORED), 'production');

    expect(saved.ok).toBe(true);
    expect(saved.ok && saved.steps).toEqual(STORED);
  });

  it('keeps an expectation that declares only a URL from growing an empty selector', () => {
    // `STEP_TEXT` is `min(1)`, so sending `selector: ''` for the box nobody
    // filled in refuses the whole array — over a field the operator never
    // touched and cannot see is wrong.
    const saved = toAuthoredSteps(
      load([{ action: 'inspect', type: 'expect', urlIncludes: '/x' }]),
      'production',
    );

    expect(saved.ok && saved.steps).toEqual([
      { action: 'inspect', type: 'expect', urlIncludes: '/x' },
    ]);
  });

  it('does not carry a field the row no longer uses', () => {
    // A row loaded as a click, then switched to a navigation, still holds the
    // selector that was typed — deliberately, so switching back does not lose
    // it. `authoredStepSchema` is `.strict()`, so sending it would refuse the
    // save over a leftover nothing on screen explains.
    const [click] = load([{ action: 'login', type: 'click', selector: '#submit' }]);
    const saved = toAuthoredSteps([{ ...click, type: 'goto', action: 'navigate', path: '/home' }], 'production');

    expect(saved.ok && saved.steps).toEqual([{ action: 'navigate', type: 'goto', path: '/home' }]);
  });

  it('refuses to save no steps at all', () => {
    // The schema is happy with `[]` — it is a valid array of valid steps. What
    // it leaves behind is a journey `journeyRunRefusal` answers
    // `journey_has_no_steps` to: a save that succeeds and makes the journey
    // unrunnable is this plan's whole subject.
    expect(toAuthoredSteps([], 'production').ok).toBe(false);
  });
});

describe('a stored literal value', () => {
  const STORED_LITERAL = [{ action: 'search', type: 'fill', selector: '#q', value: 'shoes' }];

  /**
   * The deliberate cost, pinned so it is a decision rather than a bug.
   *
   * `toStepViews` refuses to carry a stored `value`, because rows written
   * before `authoredStepSchema` can hold a real password and a screen is a
   * worse place for one than a database column. The editor inherits that: it
   * cannot put back what it was never given, so the row comes back empty and
   * the save is blocked until somebody retypes it.
   */
  it('is not loaded into the form, and blocks the save until it is retyped', () => {
    const [draft] = load(STORED_LITERAL);

    expect(draft.value).toBe('');
    expect(draft.literalWithheld).toBe(true);
    expect(toAuthoredSteps([draft], 'production').ok).toBe(false);
    expect(describeDraftProblem(draft)).toMatch(/not shown/);

    const retyped = toAuthoredSteps([{ ...draft, value: 'shoes' }], 'production');
    expect(retyped.ok && retyped.steps).toEqual(STORED_LITERAL);
  });

  it('never appears in a draft, whatever the value was', () => {
    // The assertion the leak tests in this repo have twice failed to make
    // honestly: search the whole loaded state, not one field of it.
    const drafts = load([{ action: 'login', type: 'fill', selector: '#p', value: 'hunter2' }]);

    expect(JSON.stringify(drafts)).not.toContain('hunter2');
  });
});

describe('a step the runner does not recognise', () => {
  it('starts with no type rather than a guessed one, and cannot be saved as is', () => {
    // Rows the old free-for-all accepted. Guessing `goto` would propose
    // rewriting whatever it was as a navigation, under the operator's name.
    const [draft] = load([{ banana: 1 }]);

    expect(draft.type).toBe('');
    expect(draft.unrecognised).toBe(true);
    expect(toAuthoredSteps([draft], 'production').ok).toBe(false);
    expect(describeDraftProblem(draft)).toMatch(/Choose what this step does/);
  });

  it('keeps an action an operator could have written', () => {
    const [draft] = load([{ action: 'login', type: 'fill' }]);

    expect(draft.action).toBe('login');
  });
});

describe('the actions a row may be given', () => {
  /**
   * The bug `AUTHORABLE_ACTIONS` closed for `delete`, left open for two more.
   *
   * `submit-safe` is authorable because staging and preview permit it.
   * Production does not, and a journey with no stored environment runs as
   * production — so offering it here stores a journey that walks steps 1..N-1
   * against a live site and then aborts at step N.
   */
  it('excludes what the journey’s environment forbids', () => {
    expect(actionsFor('production')).not.toContain('submit-safe');
    expect(actionsFor('staging')).toContain('submit-safe');
    expect(actionsFor('production')).toContain('login');
  });

  it('keeps a stored action the environment forbids, rather than silently dropping it', () => {
    // Dropping it from the list would change the step to whichever option the
    // browser selected instead — rewriting a row the operator came to leave
    // alone. The editor warns about it on screen; it does not edit it.
    expect(actionsFor('production', 'submit-safe')).toContain('submit-safe');
  });
});

describe('what the form says is wrong', () => {
  it('names the missing field for each type', () => {
    const blank = emptyDraft('k');

    expect(describeDraftProblem(blank)).toMatch(/needs a path/);
    expect(describeDraftProblem({ ...blank, type: 'click' })).toMatch(/needs a selector/);
    expect(describeDraftProblem({ ...blank, type: 'expect', action: 'inspect' })).toMatch(
      /URL fragment, a selector, or both/,
    );
  });

  it('refuses a login that types its own password, and says why', () => {
    // The whole point of `credentialRef`: a secret is resolved server-side and
    // never written to a row. `authoredStepSchema` enforces it; this is the
    // sentence that stops an operator meeting that rule as a 400.
    const draft = {
      ...emptyDraft('k'),
      type: 'fill' as const,
      action: 'login',
      selector: '#p',
      value: 'hunter2',
    };

    expect(toAuthoredSteps([draft], 'production').ok).toBe(false);
    expect(describeDraftProblem(draft)).toMatch(/must use a credential/);
  });

  it('says nothing about a row that is fine', () => {
    expect(describeDraftProblem({ ...emptyDraft('k'), path: '/home' })).toBeNull();
  });
});

describe('an action the journey’s environment forbids', () => {
  const submit = {
    ...emptyDraft('k'),
    type: 'click' as const,
    action: 'submit-safe',
    selector: '#pay',
  };

  /**
   * The editor and the write routes have to answer the same way.
   *
   * This warned and let the save through once, on the reasoning that the
   * action was already stored and blocking would trap the operator. It does
   * not trap them — the dropdown offers every allowed action and the row can
   * be removed — and what the softer version produced was a save the route
   * then rejected with a 422. Two doors disagreeing about one rule is the
   * failure the shared step cap and the shared credential check both exist to
   * end.
   */
  it('is refused where the environment forbids it', () => {
    expect(toAuthoredSteps([submit], 'production').ok).toBe(false);
  });

  it('is accepted where the environment permits it', () => {
    // The same step, the same list, a different journey. Nothing about the
    // shape of a step decides this.
    expect(toAuthoredSteps([submit], 'staging').ok).toBe(true);
  });
});
