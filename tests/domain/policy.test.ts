import { describe, expect, it } from 'vitest';
import { classifyAction, isActionAllowed, AUTHORABLE_ACTIONS, actionsAllowedSomewhere } from '../../src/domain/policy';

describe('isActionAllowed', () => {
  it('blocks destructive actions in production', () => {
    expect(isActionAllowed('production', 'delete')).toBe(false);
  });

  it('allows safe submissions in staging', () => {
    expect(isActionAllowed('staging', 'submit-safe')).toBe(true);
  });
});

describe('classifyAction', () => {
  it('classifies unknown actions as forbidden', () => {
    expect(classifyAction('launch-missiles')).toBe('forbidden');
  });
});

describe('AUTHORABLE_ACTIONS', () => {
  /**
   * The tuple is a literal because `z.enum` needs one, so nothing stops it
   * drifting from the table it claims to summarise. This is what stops it:
   * add an action to an environment and forget the tuple, and this fails.
   */
  it('is exactly the set of actions some environment permits', () => {
    expect([...AUTHORABLE_ACTIONS].sort()).toEqual([...actionsAllowedSomewhere()].sort());
  });

  it('excludes delete, which no environment permits', () => {
    // Recognised so it can be refused, never so it can be written.
    expect(actionsAllowedSomewhere()).not.toContain('delete');
    expect([...AUTHORABLE_ACTIONS]).not.toContain('delete');
  });
});

describe('classifyAction, against keys that are not actions', () => {
  /**
   * `??` does not fire for a key that exists on `Object.prototype`, so this
   * used to return a *function* for `constructor` and `{}` for `__proto__` —
   * making the `ActionClass` return type a lie. Nothing was exploitable
   * (`Set.has(Object)` is false, so `isActionAllowed` still said no), but the
   * same shape rendered by React is a 500, which is why `run-failure-copy.ts`
   * already carries this exact note. The runner schema is deliberately lenient
   * about `action`, so a legacy row can still reach here with any string.
   */
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'])(
    'answers forbidden for %s rather than something off the prototype',
    (key) => {
      expect(classifyAction(key)).toBe('forbidden');
    },
  );

  it('still classifies a real action', () => {
    expect(classifyAction('login')).toBe('login');
  });

  it('refuses those keys in every environment', () => {
    for (const environment of ['production', 'preview', 'staging', 'test'] as const) {
      expect(isActionAllowed(environment, 'constructor')).toBe(false);
    }
  });
});
