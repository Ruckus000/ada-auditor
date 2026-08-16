import { describe, expect, it } from 'vitest';
import { toStoredRunRecord } from '../../src/services/run-persistence';

/**
 * The wiring, not the function.
 *
 * `redactIntent` has its own tests in `regression.test.ts` and they all pass
 * with the call in `toStoredRunRecord` deleted — 782 tests green against a
 * record that stores a password. That is the third time on this line of work
 * that a guard was written, tested in isolation, and left unattached: the
 * page-title bound and the step-timeout scope both shipped the same way and
 * were caught by review rather than by a suite.
 *
 * So this drives the boundary itself. Every stored run passes through
 * `toStoredRunRecord`, which is what makes redaction there a property of the
 * system rather than something each caller has to remember.
 */

const BASE = {
  requestId: 'req-1',
  journeyId: 'demo-login',
  environment: 'staging' as const,
  platform: 'generic',
  evidenceStatus: 'complete',
  ciStatus: 'pass' as const,
  findings: [],
  durationMs: 10,
};

describe('toStoredRunRecord, for a run whose steps carry a typed value', () => {
  it('records the path and not the password', () => {
    const record = toStoredRunRecord({
      ...BASE,
      intent: {
        steps: [
          { action: 'navigate', type: 'goto', path: '/login' },
          { action: 'login', type: 'fill', selector: '#password', value: 'hunter2' },
        ],
      },
    });

    expect(JSON.stringify(record.intent)).not.toContain('hunter2');
    expect(record.intent?.steps).toEqual([
      { action: 'navigate', type: 'goto', path: '/login' },
      { action: 'login', type: 'fill', selector: '#password' },
    ]);
  });

  it('keeps a run that recorded no intent absent, rather than empty', () => {
    // `compareToBaseline` reads absent as "not recorded" and withholds the
    // diff. An `{steps: []}` here would claim the run walked nothing, and two
    // of those compare as equal.
    expect(toStoredRunRecord(BASE)).not.toHaveProperty('intent');
  });
});
