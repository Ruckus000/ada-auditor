import { describe, expect, it } from 'vitest';
import { journeyStepSchema } from '../../src/app/api/_lib/audit-run-handler';

/**
 * What a step has to look like to be accepted over HTTP.
 *
 * The `expect` variant is the one with a rule a type cannot carry: at least
 * one of `urlIncludes` and `selector`. The runner refuses the empty case too,
 * because it is reached by callers that never came through a route — but this
 * is what stops such a step being *stored*, asserting nothing while looking as
 * though it asserts something.
 */
describe('journeyStepSchema, for an expect step', () => {
  it('accepts a URL expectation', () => {
    const parsed = journeyStepSchema.safeParse({
      action: 'inspect',
      type: 'expect',
      urlIncludes: '/dashboard',
    });

    expect(parsed.success).toBe(true);
  });

  it('accepts a selector expectation', () => {
    const parsed = journeyStepSchema.safeParse({
      action: 'inspect',
      type: 'expect',
      selector: '#account-menu',
    });

    expect(parsed.success).toBe(true);
  });

  it('accepts both together', () => {
    // Both is the strongest form — the URL says the app navigated, the
    // selector says it finished rendering.
    const parsed = journeyStepSchema.safeParse({
      action: 'inspect',
      type: 'expect',
      urlIncludes: '/dashboard',
      selector: '#account-menu',
    });

    expect(parsed.success).toBe(true);
  });

  it('refuses an expectation with neither', () => {
    const parsed = journeyStepSchema.safeParse({ action: 'inspect', type: 'expect' });

    expect(parsed.success).toBe(false);
  });

  it('still accepts the three step types that came before it', () => {
    // The union grew; nothing that used to parse may stop parsing. Journeys
    // are stored rows, and a row written last month has to keep running.
    for (const step of [
      { action: 'navigate', type: 'goto', path: 'login.html' },
      { action: 'login', type: 'click', selector: '#submit' },
      { action: 'login', type: 'fill', selector: '#u', value: 'someone' },
      {
        action: 'login',
        type: 'fill',
        selector: '#p',
        credentialRef: 'acme',
        field: 'pass',
      },
    ]) {
      expect(journeyStepSchema.safeParse(step).success).toBe(true);
    }
  });
});
