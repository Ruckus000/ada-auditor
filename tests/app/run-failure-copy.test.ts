import { describe, expect, it } from 'vitest';
import { describeRunFailure } from '../../src/app/platform/lib/run-failure-copy';
import { classifyRunFailure } from '../../src/app/api/_lib/run-failure';

/**
 * The copy an operator reads when a run stops.
 *
 * Untested when it shipped, and both defects a review found were in the half
 * nothing exercised — a sentence describing a run configuration that does not
 * exist, and a lookup that turned an unrecognised code into a 500.
 */
describe('describeRunFailure', () => {
  it('says something specific for a stale selector', () => {
    // The likeliest real failure, and the one the whole phase was about
    // stopping from reading as "we do not know".
    const copy = describeRunFailure('journey_step_failed');

    expect(copy).toMatch(/selector/i);
    expect(copy).not.toMatch(/could not categorise/i);
  });

  it('tells an operator what to do about a refused navigation', () => {
    const copy = describeRunFailure('navigation_not_allowed');

    expect(copy).toMatch(/allowed hosts/i);
  });

  it('prints an unknown code rather than inventing a sentence for it', () => {
    expect(describeRunFailure('something_new')).toBe('The run stopped: something_new.');
  });

  it('survives a code that collides with Object.prototype', () => {
    // The column has no CHECK behind it. Looked up with `??`, `__proto__`
    // resolves through the prototype chain to an object, which React renders
    // by throwing — a 500 on the journeys screen instead of the fallback.
    for (const hostile of ['__proto__', 'constructor', 'toString']) {
      expect(typeof describeRunFailure(hostile)).toBe('string');
      expect(describeRunFailure(hostile)).toContain(hostile);
    }
  });

  it('gives an operator something to do where there is something to do', () => {
    // The file's own promise: "each says the one thing that *is* doable from
    // here". Both of these stated a cause and stopped — a run with no steps,
    // and a run the sweep closed out — leaving a screen that explains and then
    // asks nothing.
    for (const code of ['journey_has_no_steps', 'run_timed_out']) {
      expect(describeRunFailure(code), code).toMatch(/again|add /i);
    }
  });

  it('says whose a failure is when it is not the reader\'s, instead of inventing a step', () => {
    // Neither of these is reachable from a screen. `allowedJourneyIds` is
    // populated by no production caller, so the contract check always passes;
    // `stepId` is defaulted by the run handler and rejected at the API
    // boundary when malformed, so no operator ever named the value in it.
    // A draft of this file told the reader to rename that step — an
    // instruction for something they had not authored and could not see,
    // which is the whole defect this pass exists to remove.
    expect(describeRunFailure('invalid_step_id')).toMatch(/api/i);
    expect(describeRunFailure('invalid_step_id')).not.toMatch(/rename/i);
    expect(describeRunFailure('journey_not_in_scope')).toMatch(/contract/i);
  });

  it('does not send anyone to a person or a lever they do not have', () => {
    // Every sentence in the map, against the three instructions a rewrite of
    // this file introduced elsewhere and must never acquire here. There is no
    // administrator role in this product; the page cap is a deployment
    // variable, not a control on any screen; and nothing here is "restored".
    const codes = [
      'journey_step_failed',
      'journey_has_no_steps',
      'journey_not_in_scope',
      'action_not_allowed',
      'invalid_step_id',
      'navigation_not_allowed',
      'run_timed_out',
      'audit_run_failed',
    ];

    for (const code of codes) {
      const copy = describeRunFailure(code);
      expect(copy, code).not.toMatch(/^The run stopped: /);
      expect(copy, code).not.toMatch(/ask your administrator/i);
      expect(copy, code).not.toMatch(/restore it/i);
      expect(copy, code).not.toMatch(/check fewer/i);
    }
  });

  it('says where a journey\'s allowed hosts are set, because no screen shows them', () => {
    // `allowedHosts` is a per-journey column reachable only through the
    // journeys API — `docs/env.md` says it exists for third-party sign-in and
    // nothing else. Told to widen it, an operator goes looking for a field
    // that is not on any screen.
    const copy = describeRunFailure('navigation_not_allowed');

    expect(copy).toMatch(/allowed hosts/i);
    expect(copy).toMatch(/api/i);
  });

  it('has copy for every code the classifier can actually produce', () => {
    // The map is keyed by `RunFailureCode`, so the compiler already forces an
    // entry per member. What it cannot check is the other direction: that a
    // code the classifier really emits is not left on the generic fallback.
    const produced = [
      classifyRunFailure('Step 1 ("login") could not fill "#a": nope.'),
      // The name is what classifies this one, not the words in it.
      classifyRunFailure('Target URL resolves to a private or reserved address.', 'UnsafeTargetError'),
      classifyRunFailure('A run against a target URL must name its own steps.'),
      classifyRunFailure('Journey is not allowed by run contract scope.'),
      classifyRunFailure('Action "delete" is not allowed in production.'),
      classifyRunFailure('stepId must not escape the artifacts directory.'),
    ];

    for (const code of produced) {
      expect(code).not.toBe('audit_run_failed');
      expect(describeRunFailure(code)).not.toMatch(/^The run stopped: /);
    }

    // The two the probe array cannot reach, asserted directly rather than left
    // to the compiler. `run_timed_out` is written by the staleness sweep, never
    // thrown, so `classifyRunFailure` cannot produce it; `audit_run_failed` is
    // the fallback the loop above excludes by construction. Both are real
    // things an operator reads.
    for (const code of ['run_timed_out', 'audit_run_failed']) {
      expect(describeRunFailure(code), code).not.toMatch(/^The run stopped: /);
    }
  });
});
