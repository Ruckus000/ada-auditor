import { describe, expect, it } from 'vitest';
import { authoredStepSchema, journeyStepSchema } from '../../src/domain/journey-step';
import { AUTHORABLE_ACTIONS } from '../../src/domain/policy';

/**
 * Every step a new write may create, one of each shape.
 *
 * The subset proof below is only as good as this list, so it has to cover
 * every variant of `authoredStepSchema`. A variant added there without a case
 * here would be unproven — which is why the last test counts them.
 */
const AUTHORED = [
  { action: 'navigate', type: 'goto', path: '/login' },
  { action: 'login', type: 'click', selector: '#submit' },
  { action: 'search', type: 'fill', selector: '#q', value: 'shoes' },
  {
    action: 'login',
    type: 'fill',
    selector: '#password',
    credentialRef: 'acme-staging',
    field: 'pass',
  },
  { action: 'inspect', type: 'expect', urlIncludes: '/dashboard' },
  { action: 'inspect', type: 'expect', selector: '#account-menu' },
  { action: 'inspect', type: 'expect', urlIncludes: '/dashboard', selector: '#account-menu' },
];

describe('the two step schemas', () => {
  /**
   * The test that permits two schemas to exist.
   *
   * The write route's objection to validating steps was that a second schema
   * gives two places to disagree about what a step is. That objection is
   * right, and this is the answer to it: `authoredStepSchema` is not a second
   * opinion, it is a *subset*. Anything a new write may create, the runner
   * already accepts — so tightening authoring can never produce a journey that
   * cannot run, which is the only way two schemas could actually hurt.
   *
   * If this fails, the schemas have drifted and one of them is wrong.
   */
  it('accepts nothing at write time that the runner would refuse', () => {
    for (const step of AUTHORED) {
      expect(authoredStepSchema.safeParse(step).success).toBe(true);
      expect(journeyStepSchema.safeParse(step).success).toBe(true);
    }
  });

  it('covers every authored variant, so the proof above is not partial', () => {
    // `z.union` exposes its members, so this counts rather than trusting that
    // somebody added a case when they added a variant.
    const variants = authoredStepSchema.options.length;

    // Three `expect` cases exercise one variant; the other four are one each.
    expect(new Set(AUTHORED.map((step) => `${step.type}:${'credentialRef' in step}`)).size).toBe(
      variants,
    );
  });
});

describe('authoredStepSchema, stricter than the runner on purpose', () => {
  it('refuses a step with keys nobody recognises', () => {
    // `{banana: 1}` was accepted and stored. So was anything else.
    expect(authoredStepSchema.safeParse({ banana: 1 }).success).toBe(false);
    expect(
      authoredStepSchema.safeParse({
        action: 'navigate',
        type: 'goto',
        path: '/x',
        banana: 1,
      }).success,
    ).toBe(false);
  });

  /**
   * The hole `containsInlineCredential` never closed.
   *
   * It tests key *names* against `password|pass|secret|token`, and a literal's
   * value sits under the key `value` — so this exact step passed every check
   * in the system and wrote a password into a database column.
   */
  it('refuses a login that carries its own password', () => {
    const parsed = authoredStepSchema.safeParse({
      action: 'login',
      type: 'fill',
      selector: '#password',
      value: 'hunter2',
    });

    expect(parsed.success).toBe(false);
    // And the runner still accepts it, which is the point of the split: rows
    // stored before this rule keep running.
    expect(
      journeyStepSchema.safeParse({
        action: 'login',
        type: 'fill',
        selector: '#password',
        value: 'hunter2',
      }).success,
    ).toBe(true);
  });

  it('keeps a literal value for every other kind of fill', () => {
    // Typing a search term is ordinary. Banning literals outright to catch
    // passwords would break the common case to stop the rare one.
    expect(
      authoredStepSchema.safeParse({
        action: 'search',
        type: 'fill',
        selector: '#q',
        value: 'shoes',
      }).success,
    ).toBe(true);
  });

  /**
   * The limit of the login rule, pinned so it is not mistaken for a control.
   *
   * Refusing a literal on a `login` fill closes the shape an operator writes
   * when doing the normal thing. It cannot stop one who mislabels on purpose,
   * and no static rule can — a selector is a string and nothing here knows
   * what it points at. If this ever starts failing, someone has added a
   * heuristic on selector names; check it was worth the false positives.
   */
  it('cannot stop a literal secret hidden behind a mislabelled action', () => {
    expect(
      authoredStepSchema.safeParse({
        action: 'search',
        type: 'fill',
        selector: '#password',
        value: 'hunter2',
      }).success,
    ).toBe(true);
  });

  it('refuses an action the policy layer cannot classify', () => {
    // Stored fine before this, passed every validation, and died mid-run with
    // `Action "frobnicate" is not allowed`.
    expect(
      authoredStepSchema.safeParse({ action: 'frobnicate', type: 'goto', path: '/x' }).success,
    ).toBe(false);
  });

  it('accepts every action some environment permits', () => {
    // The write schema must not be narrower than the policy it defers to, or
    // it would refuse steps that really are legal somewhere.
    for (const action of AUTHORABLE_ACTIONS) {
      expect(authoredStepSchema.safeParse({ action, type: 'goto', path: '/x' }).success).toBe(
        true,
      );
    }
  });

  /**
   * Recognised is not the same as runnable.
   *
   * An earlier version of this used `KNOWN_ACTIONS` and asserted every one was
   * accepted, with a comment claiming each was "perfectly legal in some
   * environment". That was false for exactly one: `delete` appears in no
   * environment's set — it is recognised so it can be *refused*. Accepting it
   * stored a journey guaranteed to fail part-way through, which is the failure
   * this whole schema exists to move to write time.
   */
  it('refuses an action no environment permits, however well recognised', () => {
    expect(
      authoredStepSchema.safeParse({ action: 'delete', type: 'click', selector: '#x' }).success,
    ).toBe(false);
  });

  it('refuses an expectation with nothing to expect', () => {
    expect(authoredStepSchema.safeParse({ action: 'inspect', type: 'expect' }).success).toBe(
      false,
    );
  });
});

describe('journeyStepSchema, lenient for rows that already exist', () => {
  it('still accepts a step with no known action', () => {
    // A journey stored under the old free-for-all has to keep running. The
    // environment gate refuses the action at run time; refusing it here would
    // break a client's scheduled audit on a deploy that changed no behaviour.
    expect(
      journeyStepSchema.safeParse({ action: 'frobnicate', type: 'goto', path: '/x' }).success,
    ).toBe(true);
  });
});
