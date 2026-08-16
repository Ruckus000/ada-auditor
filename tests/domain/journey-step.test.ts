import { describe, expect, it } from 'vitest';
import {
  authoredStepSchema,
  authoredStepsSchema,
  journeyStepSchema,
  MAX_STEPS_PER_JOURNEY,
  toStepViews,
} from '../../src/domain/journey-step';
import { auditRunBodySchema } from '../../src/app/api/_lib/audit-run-handler';
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

describe('toStepViews', () => {
  it('says where each step acts, in reading order', () => {
    const views = toStepViews([
      { action: 'navigate', type: 'goto', path: 'login.html' },
      { action: 'login', type: 'click', selector: '#submit' },
      { action: 'inspect', type: 'expect', urlIncludes: '/dashboard', selector: '#menu' },
    ]);

    expect(views.map((v) => v.position)).toEqual([1, 2, 3]);
    expect(views[0].target).toBe('login.html');
    expect(views[1].target).toBe('#submit');
    // Both halves, so the screen shows which checks were declared.
    expect(views[2].target).toBe('url contains /dashboard and #menu visible');
  });

  it('names a credential and shows which field it fills', () => {
    // The *name* is not a secret — it is the whole point of `credentialRef`.
    // Showing the field is what makes a transposed login visible to a reader.
    const [view] = toStepViews([
      { action: 'login', type: 'fill', selector: '#u', credentialRef: 'acme', field: 'user' },
    ]);

    expect(view.credentialRef).toBe('acme');
    expect(view.field).toBe('user');
    expect(view.hasLiteralValue).toBeUndefined();
  });

  /**
   * The security rule of this view model.
   *
   * `authoredStepSchema` refuses a `login` fill with a literal, but only for
   * *new* writes. Rows stored before that rule exist and some hold a real
   * password. Rendering `value` would move a secret from a database column to
   * a screen — a worse place for it. The screen says a literal is present and
   * never what it is.
   */
  it('never carries a literal value out, only that there is one', () => {
    const views = toStepViews([
      { action: 'login', type: 'fill', selector: '#p', value: 'hunter2' },
      { action: 'search', type: 'fill', selector: '#q', value: 'shoes' },
    ]);

    expect(views[0].hasLiteralValue).toBe(true);
    expect(JSON.stringify(views)).not.toContain('hunter2');
    // Not even the harmless ones — the model cannot tell a search term from a
    // password, so it carries neither.
    expect(JSON.stringify(views)).not.toContain('shoes');
  });

  /**
   * A step carrying both, which the runner schema tolerates.
   *
   * `journeyStepSchema` is a plain union and the literal variant comes first,
   * so a step with both matches it and zod strips the reference. The result
   * reports a literal and drops the ref — the safe direction, and the one
   * worth flagging: an operator seeing "types a literal value" on a login goes
   * and looks, which is exactly what should happen to a row like this.
   */
  it('reports the literal when a fill somehow carries both', () => {
    const [view] = toStepViews([
      {
        action: 'login',
        type: 'fill',
        selector: '#p',
        credentialRef: 'acme',
        field: 'pass',
        value: 'hunter2',
      },
    ]);

    expect(view.hasLiteralValue).toBe(true);
    expect(JSON.stringify(view)).not.toContain('hunter2');
  });

  it('marks a step the runner would not recognise, rather than hiding it', () => {
    // These exist: the write route accepted anything until `authoredStepSchema`.
    // They cannot run, so the screen has to say so rather than render a
    // plausible row that will never work.
    const views = toStepViews([{ banana: 1 }, { action: 'login', selector: '#u' }]);

    expect(views[0].recognised).toBe(false);
    expect(views[0].action).toBe('unknown');
    expect(views[1].recognised).toBe(false);
    // What can be trusted is still shown, so the row is identifiable.
    expect(views[1].action).toBe('login');
  });

  /**
   * The blind spot the review found, and the rows it matters most for.
   *
   * A step that fails the schema can still hold a real password — this exact
   * shape, missing only a selector. It used to render "not a runnable step"
   * and nothing else, so the operator review this change exists to enable was
   * silent on precisely the era of rows most likely to carry an inline secret.
   */
  it('flags a literal on a step it could not recognise', () => {
    const [view] = toStepViews([{ action: 'login', type: 'fill', value: 'hunter2' }]);

    expect(view.recognised).toBe(false);
    expect(view.hasLiteralValue).toBe(true);
    expect(JSON.stringify(view)).not.toContain('hunter2');
  });

  it('bounds the text it echoes off an unvalidated row', () => {
    // `STEP_TEXT` caps recognised fields at 512, but this row predates it, so
    // its fields are whatever jsonb was handed. Worst case is a wrecked
    // operator page rather than disclosure — still not a page worth wrecking.
    const [view] = toStepViews([{ action: 'x'.repeat(5_000), type: 'goto' }]);

    expect(view.action.length).toBe(512);
  });

  it('does not render a non-string action as one', () => {
    // `[object Object]` reaches a screen exactly this way.
    const [view] = toStepViews([{ action: { nested: true }, type: 42 }]);

    expect(view.action).toBe('unknown');
    expect(view.type).toBe('unknown');
  });

  it('survives steps that are not an array at all', () => {
    // `steps` is jsonb written before validation existed; a row can hold
    // anything. This is the guard the old `stepCount` field used to carry, and
    // it moved here when that field was removed as a duplicate of
    // `steps.length`.
    for (const notAnArray of [null, undefined, {}, 'steps', 7]) {
      expect(toStepViews(notAnArray)).toEqual([]);
    }
  });
});

describe('MAX_STEPS_PER_JOURNEY', () => {
  /**
   * The list-level half of the subset proof.
   *
   * `authoredStepSchema ⊂ journeyStepSchema` is proven per step, and that said
   * nothing about how many steps a list may hold. The two caps disagreed — 200
   * for a stored journey, 50 at `/api/audit/run` — so a journey between them
   * stored, scheduled, and then failed at body parse once a window forever.
   */
  it('is the ceiling the steps array actually enforces', () => {
    const step = { action: 'navigate', type: 'goto', path: '/' };
    const atCap = Array.from({ length: MAX_STEPS_PER_JOURNEY }, () => step);
    const overCap = [...atCap, step];

    expect(authoredStepsSchema.safeParse(atCap).success).toBe(true);
    expect(authoredStepsSchema.safeParse(overCap).success).toBe(false);
  });

  it('is the same ceiling the run body schema uses', () => {
    // One number in one place is the only thing that keeps these from drifting
    // apart again — and the drift is invisible until it is a recurring
    // production failure on a timer.
    const step = { action: 'navigate', type: 'goto', path: '/' };
    const overCap = Array.from({ length: MAX_STEPS_PER_JOURNEY + 1 }, () => step);

    const body = { journeyId: 'j', environment: 'staging' as const };

    expect(auditRunBodySchema.safeParse({ ...body, steps: overCap }).success).toBe(false);
    expect(
      auditRunBodySchema.safeParse({
        ...body,
        steps: overCap.slice(0, MAX_STEPS_PER_JOURNEY),
      }).success,
    ).toBe(true);
  });
});
