import { z } from 'zod';
import { AUTHORABLE_ACTIONS } from './policy';

/**
 * What a journey step is — in one place, in two strengths.
 *
 * There were three definitions and they did not agree. The runner had a zod
 * union, `integrations/browser/types.ts` had a TypeScript union with no
 * bounds, and the route that *writes* journeys had
 * `z.array(z.record(z.string(), z.unknown()))`, which accepts `{banana: 1}`.
 * The write route's comment defended that: duplicating the runner's schema
 * "would give two places to disagree about what a step is."
 *
 * The objection is right and the conclusion was wrong. The answer is one
 * module, not no validation — and the proof that the two schemas here cannot
 * drift is a test, not a promise: every step `authoredStepSchema` accepts must
 * also parse under `journeyStepSchema`. See `tests/domain/journey-step.test.ts`.
 *
 * The cost of having had no write-time shape was not theoretical. Two routes
 * re-validate stored steps before they will schedule or run a journey, and
 * both carry an `invalid_journey_steps` refusal for rows that were accepted at
 * creation and cannot run. An operator found out at the wrong end.
 */

/**
 * The longest a step's path, selector or URL fragment may be.
 *
 * Exported because a screen that *builds* steps has to know it. `DiscoverPages`
 * turns discovered URLs into `goto` paths, and a URL may be up to
 * `MAX_HREF_LENGTH` (2048) — four times this — so without the number the panel
 * could only find out by posting the journey and reading back
 * `invalid_request_body`, which names neither the page nor the reason. A
 * screen that cannot state a rule before the operator breaks it is a screen
 * that reports the rule as a mystery.
 */
export const MAX_STEP_TEXT = 512;

const STEP_TEXT = z.string().min(1).max(MAX_STEP_TEXT);

/**
 * What the *runner* accepts. Lenient on purpose.
 *
 * This governs rows that already exist. A journey stored under the old
 * free-for-all — or one written before an authoring rule was added — has to
 * keep running, because the alternative is a client's scheduled audit
 * breaking on a deploy that changed no behaviour. So nothing may be tightened
 * here to make an authoring rule neater.
 */
export const journeyStepSchema = z.union([
  z.object({ action: STEP_TEXT, type: z.literal('goto'), path: STEP_TEXT }),
  z.object({ action: STEP_TEXT, type: z.literal('click'), selector: STEP_TEXT }),
  // Two `fill` shapes, so these are a plain union rather than a discriminated
  // one — `type` alone does not tell them apart.
  z.object({
    action: STEP_TEXT,
    type: z.literal('fill'),
    selector: STEP_TEXT,
    value: z.string().max(4096),
  }),
  z.object({
    action: STEP_TEXT,
    type: z.literal('fill'),
    selector: STEP_TEXT,
    credentialRef: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    field: z.enum(['user', 'pass']),
  }),
  z
    .object({
      action: STEP_TEXT,
      type: z.literal('expect'),
      urlIncludes: STEP_TEXT.optional(),
      selector: STEP_TEXT.optional(),
    })
    .refine((step) => step.urlIncludes !== undefined || step.selector !== undefined, {
      message: 'An expect step must set urlIncludes, selector, or both.',
    }),
]);

/**
 * An action the policy layer can actually classify.
 *
 * `journeyStepSchema` takes any 1–512 character string, but `classifyAction`
 * is a closed allowlist that answers `forbidden` to everything else — so a
 * journey with `action: 'frobnicate'` was stored, passed every validation, and
 * then died part-way through a run with "Action \"frobnicate\" is not allowed".
 * The operator learned at the worst possible moment about a typo they made at
 * the best possible one.
 *
 * `AUTHORABLE_ACTIONS` rather than `KNOWN_ACTIONS`, and the difference is one
 * value that matters: `delete` is *recognised* by the classifier and permitted
 * by no environment, so writing one stores a journey guaranteed to fail
 * part-way through. Accepting it here would have left the same bug open for
 * the one action most worth stopping.
 */
const authoredAction = z.enum(AUTHORABLE_ACTIONS);

/**
 * What a *new write* must satisfy. Strictly narrower.
 *
 * Three rules the runner schema does not have, each closing something that was
 * reaching the database:
 *
 * 1. **`.strict()` — no unknown keys.** `{banana: 1}` was accepted and stored.
 *    So was `{action:'fill', selector:'#pw', password:'hunter2'}`, which
 *    `containsInlineCredential` catches by key name; `.strict()` is what
 *    catches the ones nobody thought to name.
 * 2. **A known action**, per the note above.
 * 3. **A login may not carry its own password.** `credentialRef` exists so a
 *    secret is resolved server-side and never written to a row, and
 *    `containsInlineCredential` was supposed to enforce it — but it tests key
 *    *names*, and a literal's value sits under the key `value`, so
 *    `{action:'login', type:'fill', value:'hunter2'}` sailed through. Every
 *    other kind of `fill` keeps its literal, because typing a search term or a
 *    postcode is ordinary and banning it would be absurd.
 *
 *    What that leaves open, said plainly rather than left to be discovered:
 *    `{action:'search', type:'fill', selector:'#password', value:'hunter2'}`
 *    is accepted. The rule closes the *sanctioned* shape — the step an
 *    operator writes when they are doing the normal thing — and it cannot stop
 *    one who mislabels on purpose. No static rule can: a selector is a string,
 *    and nothing here knows what it points at. The remaining protection is
 *    that the step list becomes visible, which is the rest of this phase.
 *
 * **Not here: a general `action`-against-`type` cross-check.** The plan asked
 * for one — `goto → navigate`, `fill → login | search` and so on — to stop
 * `action` being a free-text policy bypass. Built honestly it does not do
 * that. The bypass is labelling a form submission as `navigate` to get it past
 * production's ban on `submit-safe`, and both are `type: 'click'`: no static
 * rule distinguishes clicking a link from clicking Submit. The remaining rules
 * would only catch mislabels in the harmless direction, at the cost of a table
 * of arbitrary pairings to maintain. What actually carries that weight is the
 * step list becoming visible to the operator, which is the rest of this phase.
 */
export const authoredStepSchema = z.union([
  z.object({ action: authoredAction, type: z.literal('goto'), path: STEP_TEXT }).strict(),
  z.object({ action: authoredAction, type: z.literal('click'), selector: STEP_TEXT }).strict(),
  z
    .object({
      action: authoredAction,
      type: z.literal('fill'),
      selector: STEP_TEXT,
      /**
       * `min(1)`, unlike the runner's, and the bound is doing real work.
       *
       * An empty string parses as a value, so a `fill` that types nothing was
       * writable — and the step editor is where that stops being theoretical.
       * A row whose stored literal is deliberately withheld from the screen
       * comes back with the box empty, so a save that accepted `''` would
       * silently blank what was stored: an operator opens the editor to fix
       * step 5 and wipes step 2's search term by not touching it.
       *
       * Only the *authoring* side. A stored row holding `''` keeps running,
       * because a client's scheduled audit must not break on a deploy that
       * changed no behaviour. Clearing a field by filling it with nothing is a
       * thing a browser can do and nothing has asked for.
       */
      value: z.string().min(1).max(4096),
    })
    .strict()
    .refine((step) => step.action !== 'login', {
      message: 'A login step must use credentialRef, never a literal value.',
    }),
  z
    .object({
      action: authoredAction,
      type: z.literal('fill'),
      selector: STEP_TEXT,
      credentialRef: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      field: z.enum(['user', 'pass']),
    })
    .strict(),
  z
    .object({
      action: authoredAction,
      type: z.literal('expect'),
      urlIncludes: STEP_TEXT.optional(),
      selector: STEP_TEXT.optional(),
    })
    .strict()
    .refine((step) => step.urlIncludes !== undefined || step.selector !== undefined, {
      message: 'An expect step must set urlIncludes, selector, or both.',
    }),
]);

/**
 * The most steps a journey may hold, and the most `/api/audit/run` will take.
 *
 * One number because two disagreed, and the disagreement was invisible until
 * it was a recurring production failure. Journeys allowed 200; the run body
 * schema allowed 50. A journey of 51 well-formed steps was therefore storable,
 * schedulable — `journeyRunRefusal` asks only "a non-empty array", and the
 * schedule guard's `z.array(journeyStepSchema)` has no length bound — and then
 * undispatchable: the tick claims it, POSTs, takes a 400 at body parse,
 * releases, and does it again next window, forever. Which is word for word the
 * failure that guard was written to stop.
 *
 * The manual run route calls `startRun` directly and bypasses the body schema,
 * so such a journey ran fine by hand and failed only on the timer.
 *
 * 50 rather than 200: the page cap is 20 and every step costs wall clock
 * against a 300s function ceiling, so the smaller number is the one with a
 * reason behind it. Raising the run endpoint to 200 would only widen what an
 * unauthenticated body-parse has to chew through.
 */
export const MAX_STEPS_PER_JOURNEY = 50;

/**
 * A whole list of steps, as a route must accept it.
 *
 * Here rather than in each route, because there are two of them now — create
 * and edit — and "what a journey's steps may be" is exactly the thing this
 * module exists to stop having two answers to.
 *
 * **Length before shape, and the order is load-bearing.** `.max()` on an array
 * of `authoredStepSchema` is a check that runs *after* every element has been
 * parsed against a five-branch strict union, so a body of junk steps was fully
 * parsed before the cap refused it: measured at 210ms against 1ms for 5,000
 * elements, and at 100,000 the parse-first form throws `RangeError` inside
 * zod's own error builder. Counting first costs nothing.
 *
 * The size bound is a separate question from the shape and survives it — a
 * payload that large is not a journey whatever shape it is in, and this row is
 * written permanently and read on every client screen.
 */
export const authoredStepsSchema = z
  .array(z.unknown())
  .max(MAX_STEPS_PER_JOURNEY)
  .pipe(z.array(authoredStepSchema))
  .refine((steps) => JSON.stringify(steps).length <= 64_000, {
    message: 'steps payload is too large',
  });

/**
 * One step, shaped for a screen.
 *
 * A journey's steps were never shown — the UI printed a *count*, so an
 * operator could not see what a journey did without reading the database. That
 * is also the thing carrying the weight no static check could: `{action:
 * 'activate', type:'click', selector:'#delete-account'}` passes every rule in
 * this file, and the only real defence is that somebody can read it.
 */
export type JourneyStepView = {
  /** 1-based, because it is a position in a list a person is reading. */
  position: number;
  action: string;
  type: string;
  /**
   * Where the step acts, in the step's own fields rather than in a sentence.
   *
   * This carried a single `target: string` holding whatever the step pointed
   * at — and, for an `expect`, the rendered phrase "url contains /x and #y
   * visible". That was enough while the only reader was a list to look at. It
   * is not enough for the editor, which has to put each field back in the box
   * it came from, and un-writing that sentence to recover two values is the
   * kind of parse that is wrong the first time somebody's path contains the
   * word "and".
   *
   * So the phrase is composed where it is displayed, and what travels is the
   * step. One projection of a stored step, not one per reader.
   */
  path?: string;
  selector?: string;
  urlIncludes?: string;
  /** The credential's *name*. Never its value; the value is not here to leak. */
  credentialRef?: string;
  /** `user` or `pass`, so a transposed login is visible on the screen. */
  field?: string;
  /**
   * That this step types a literal, without saying what.
   *
   * Load-bearing. `authoredStepSchema` refuses a `login` fill carrying a
   * literal, but only for *new* writes — rows stored before that rule exist
   * and some of them hold a real password. Rendering `value` would take a
   * secret out of a database column and put it on a screen, which is a worse
   * place for it. So the screen says a literal is there and never what it is,
   * and an operator who sees one on a login step knows to replace it with a
   * `credentialRef`.
   */
  hasLiteralValue?: boolean;
  /**
   * Whether the runner would recognise this step at all.
   *
   * `false` for rows the old free-for-all accepted. Those cannot run — both
   * the run and schedule routes refuse them — so the screen has to say so
   * rather than render a plausible-looking row that will never work.
   */
  recognised: boolean;
};

/**
 * Turns stored steps into something a screen can show, safely.
 *
 * Takes `unknown` because that is what `StoredJourney.steps` is: jsonb written
 * before any validation existed, so a row can hold a non-array, and an element
 * can be anything at all.
 */
/** Bounded because an unvalidated row's fields are whatever jsonb was handed. */
function looseText(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 512) : 'unknown';
}

export function toStepViews(steps: unknown): JourneyStepView[] {
  if (!Array.isArray(steps)) return [];

  return steps.map((raw, index) => {
    const position = index + 1;
    const parsed = journeyStepSchema.safeParse(raw);

    if (!parsed.success) {
      // Read what little can be trusted, so the row is identifiable, and mark
      // it unrecognised. `action` and `type` are echoed only when they really
      // are strings — a number or an object rendered raw is how "[object
      // Object]" reaches a screen.
      const loose = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      return {
        position,
        // Echoed only when really strings, and clipped. A number or an object
        // rendered raw is how "[object Object]" reaches a screen, and these
        // are the one path not bounded by `STEP_TEXT` — the row predates it,
        // so its fields are whatever jsonb was handed.
        action: looseText(loose.action),
        type: looseText(loose.type),
        // Flagged here too, and this is the case that matters most.
        //
        // A row that fails the schema can still hold a real password —
        // `{action:'login', type:'fill', value:'hunter2'}` with no selector is
        // exactly that shape. Without this it rendered as "not a runnable
        // step" and nothing else, so the operator review this whole change
        // exists to enable had its blind spot precisely on the rows from the
        // era most likely to carry an inline secret.
        ...(typeof loose.value === 'string' ? { hasLiteralValue: true } : {}),
        recognised: false,
      };
    }

    const step = parsed.data;
    const view: JourneyStepView = {
      position,
      action: step.action,
      type: step.type,
      recognised: true,
    };

    if (step.type === 'goto') view.path = step.path;
    if (step.type === 'click') view.selector = step.selector;
    if (step.type === 'fill') {
      view.selector = step.selector;
      if ('credentialRef' in step) {
        view.credentialRef = step.credentialRef;
        view.field = step.field;
      } else {
        view.hasLiteralValue = true;
      }
    }
    if (step.type === 'expect') {
      // Both halves separately, because an expectation that checks the URL
      // *and* a selector is stronger than either and both readers need to tell
      // them apart — the list to say which were declared, the editor to put
      // each back in its own field.
      if (step.urlIncludes !== undefined) view.urlIncludes = step.urlIncludes;
      if (step.selector !== undefined) view.selector = step.selector;
    }

    return view;
  });
}
