import { describe, expect, it } from 'vitest';
import { redactIntent, toStoredRunRecord } from '../../src/services/run-persistence';
import {
  PartialAuditError,
  PartialJourneyError,
} from '../../src/integrations/browser/partial-run';

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

describe('redactIntent', () => {
  /**
   * `runs.intent` is durable and nothing prunes it — `prune-artifacts` clears
   * evidence blobs and never touches this column — so anything written here is
   * permanent, in the table and in every backup cut from it.
   *
   * A literal `value` reaches it: `journeyStepSchema` still accepts
   * `{type:'fill', value}`, and `containsInlineCredential` rejects a key
   * *named* `password` and does not run on the `/api/audit/run` path at all.
   * `buildDefaultDemoJourneySteps` alone would have written `value:
   * 'demo-pass'` into production on the first console run.
   */
  it('strips what was typed, and keeps everything that says where', () => {
    const redacted = redactIntent({
      steps: [
        { action: 'navigate', type: 'goto', path: '/login' },
        { action: 'login', type: 'fill', selector: '#password', value: 'hunter2' },
        { action: 'login', type: 'fill', selector: '#user', credentialRef: 'acme', field: 'user' },
      ],
    });

    expect(JSON.stringify(redacted)).not.toContain('hunter2');
    // The shape survives: the step types are what a later phase derives an
    // expected page count from, which is why this strips rather than hashes.
    expect(redacted.steps[1]).toEqual({ action: 'login', type: 'fill', selector: '#password' });
    expect(redacted.steps[0]).toEqual({ action: 'navigate', type: 'goto', path: '/login' });
    // A reference is not a secret and is the sanctioned shape.
    expect(redacted.steps[2]).toHaveProperty('credentialRef', 'acme');
  });

  it('leaves two runs comparable across a password rotation', () => {
    // Stripping is not only safer, it is more correct: the same journey walked
    // either side of a credential change is the same path.
    const before = redactIntent({
      steps: [{ action: 'login', type: 'fill', selector: '#p', value: 'old' }],
    });
    const after = redactIntent({
      steps: [{ action: 'login', type: 'fill', selector: '#p', value: 'new' }],
    });

    expect(JSON.stringify(before.steps)).toBe(JSON.stringify(after.steps));
  });

  it('passes a step that is not an object through untouched', () => {
    // `steps` is `unknown[]` off a jsonb column. Nothing guarantees objects.
    expect(redactIntent({ steps: ['odd', 42, null] }).steps).toEqual(['odd', 42, null]);
  });
});

describe('redactIntent, on a step shape it has never seen', () => {
  /**
   * An allowlist, so schema growth fails closed.
   *
   * Removing a key called `value` is exhaustive for today's `JourneyStep` and
   * only for today's. A step type that later carries a `token`, an `otp` or an
   * `answer` would sail past a rule written against one word, into a column
   * nothing prunes and no retention policy touches. Keeping only the keys that
   * say *where* means the new field is dropped until someone decides it
   * belongs — the direction to be wrong in.
   */
  it('drops a field it does not recognise, rather than passing it through', () => {
    const redacted = redactIntent({
      steps: [
        { action: 'login', type: 'fill', selector: '#otp', oneTimeCode: '445566' },
      ],
    });

    expect(JSON.stringify(redacted)).not.toContain('445566');
    expect(redacted.steps[0]).toEqual({ action: 'login', type: 'fill', selector: '#otp' });
  });
});

describe('the partial-run errors, as data', () => {
  /**
   * A class field is an own enumerable property, so these carried a captured
   * DOM into `JSON.stringify(error)` where a plain `Error` yields `{}` — and
   * `logger.ts`'s redaction walks five levels looking for keys it knows, so an
   * authenticated page's HTML was five levels from a log line. Nothing
   * serialises an error today. This is so nothing can start to.
   */
  it('does not put a captured page into JSON.stringify', () => {
    const captured = {
      pages: [{ page: { url: 'https://acme.test/', route: '/', title: 'A' }, html: '<b>secret-markup</b>' }],
      truncatedPages: 0,
    };

    const journey = new PartialJourneyError(new Error('boom'), captured as never);
    const audit = new PartialAuditError(new Error('boom'), [] as never, 0);

    // The payload is what is hidden, not the whole object: `name` and a page
    // count still serialise, and neither is anyone's data.
    expect(JSON.stringify(journey)).not.toContain('secret-markup');
    expect(JSON.parse(JSON.stringify(journey))).not.toHaveProperty('captured');
    expect(JSON.parse(JSON.stringify(audit))).not.toHaveProperty('auditedPages');

    // Still reachable for the code that needs it.
    expect(journey.captured.pages).toHaveLength(1);
  });
});
