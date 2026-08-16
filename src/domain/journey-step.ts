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

const STEP_TEXT = z.string().min(1).max(512);

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
      value: z.string().max(4096),
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
