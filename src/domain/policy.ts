import type { Environment } from './contracts';

export type ActionClass =
  | 'login'
  | 'navigate'
  | 'inspect'
  | 'search'
  | 'filter'
  | 'paginate'
  | 'open-detail'
  | 'submit-safe'
  | 'mutate-test-data'
  | 'delete'
  | 'forbidden';

const allowedByEnvironment: Record<Environment, Set<ActionClass>> = {
  production: new Set(['login', 'navigate', 'inspect', 'search', 'filter', 'paginate', 'open-detail']),
  preview: new Set([
    'login',
    'navigate',
    'inspect',
    'search',
    'filter',
    'paginate',
    'open-detail',
    'submit-safe',
  ]),
  staging: new Set([
    'login',
    'navigate',
    'inspect',
    'search',
    'filter',
    'paginate',
    'open-detail',
    'submit-safe',
  ]),
  test: new Set([
    'login',
    'navigate',
    'inspect',
    'search',
    'filter',
    'paginate',
    'open-detail',
    'submit-safe',
    'mutate-test-data',
  ]),
};

/**
 * Every action string the policy layer can classify.
 *
 * Exported as a tuple so a write-time schema can refuse an action this cannot
 * classify. Without that, `action` was any 1–512 character string on the way
 * in and a closed allowlist on the way out: a journey with `action:
 * 'frobnicate'` stored cleanly, passed every validation, and died part-way
 * through a run. A typo made at the best possible moment was reported at the
 * worst.
 *
 * `classifiedActions` is typed against it below, so the two cannot drift —
 * adding a class without adding it here is a compile error.
 */
export const KNOWN_ACTIONS = [
  'login',
  'navigate',
  'inspect',
  'search',
  'filter',
  'paginate',
  'open-detail',
  'submit-safe',
  'mutate-test-data',
  'delete',
] as const;

export type KnownAction = (typeof KNOWN_ACTIONS)[number];

/**
 * The actions a *new* journey may be written with.
 *
 * `KNOWN_ACTIONS` is everything the classifier recognises, which is not the
 * same question. `delete` is recognised precisely so it can be refused: it
 * appears in no environment's set, so a step carrying it can never run
 * anywhere. Accepting one at write time would store a journey that is
 * guaranteed to fail part-way through — the exact "found out at the wrong end"
 * this validation exists to stop, left open for one value.
 *
 * A literal tuple because `z.enum` needs one. `policy.test.ts` asserts it
 * equals the union of every environment's set, so it cannot drift from the
 * table above without a test failing.
 */
export const AUTHORABLE_ACTIONS = [
  'login',
  'navigate',
  'inspect',
  'search',
  'filter',
  'paginate',
  'open-detail',
  'submit-safe',
  'mutate-test-data',
] as const;

/** Every action some environment permits. The source of truth for the tuple above. */
export function actionsAllowedSomewhere(): ActionClass[] {
  const allowed = new Set<ActionClass>();
  for (const set of Object.values(allowedByEnvironment)) {
    for (const actionClass of set) allowed.add(actionClass);
  }
  return [...allowed];
}

const classifiedActions: Record<KnownAction, ActionClass> = {
  login: 'login',
  navigate: 'navigate',
  inspect: 'inspect',
  search: 'search',
  filter: 'filter',
  paginate: 'paginate',
  'open-detail': 'open-detail',
  'submit-safe': 'submit-safe',
  'mutate-test-data': 'mutate-test-data',
  delete: 'delete',
};

export function classifyAction(action: string): ActionClass {
  // `Object.hasOwn`, not `??`. The action is a free string off a stored row or
  // a request body, and `classifiedActions.constructor` resolves through the
  // prototype chain to a *function* — so `??` never fired and this returned
  // something that is not an `ActionClass` at all, making the signature a lie.
  // `isActionAllowed` still said no, because `Set.has(Object)` is false, so
  // nothing was exploitable; the same shape rendered by React is a 500, which
  // is why `run-failure-copy.ts` already carries this exact note.
  return Object.hasOwn(classifiedActions, action)
    ? classifiedActions[action as KnownAction]
    : 'forbidden';
}

export function isActionAllowed(environment: Environment, action: string): boolean {
  const actionClass = classifyAction(action);
  return actionClass !== 'forbidden' && allowedByEnvironment[environment].has(actionClass);
}
