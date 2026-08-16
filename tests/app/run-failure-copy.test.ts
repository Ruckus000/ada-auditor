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

  it('has copy for every code the classifier can actually produce', () => {
    // The map is keyed by `RunFailureCode`, so the compiler already forces an
    // entry per member. What it cannot check is the other direction: that a
    // code the classifier really emits is not left on the generic fallback.
    const produced = [
      classifyRunFailure('Step 1 ("login") could not fill "#a": nope.'),
      classifyRunFailure('Host evil.example is not in the allowed domains for this run.'),
      classifyRunFailure('A run against a target URL must name its own steps.'),
      classifyRunFailure('Journey is not allowed by run contract scope.'),
      classifyRunFailure('Action "delete" is not allowed in production.'),
      classifyRunFailure('stepId must not escape the artifacts directory.'),
    ];

    for (const code of produced) {
      expect(code).not.toBe('audit_run_failed');
      expect(describeRunFailure(code)).not.toMatch(/^The run stopped: /);
    }
  });
});
