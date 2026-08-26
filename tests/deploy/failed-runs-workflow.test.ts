import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEDULED_RUN_NOT_STARTED } from '../../src/domain/platform';

/**
 * The workflow and the code agree on one string, and nothing else can say so.
 *
 * `activity_events.action` is free text, and this change makes one value of it
 * load-bearing for a machine: the tick writes `SCHEDULED_RUN_NOT_STARTED`,
 * `/api/platform/activity` filters on whatever it is sent, and the workflow
 * counts what comes back. A copy-edit to the constant would leave the workflow
 * matching a string nothing writes any more — it would report zero every
 * night, which is exactly what a working night looks like.
 *
 * A `kind` column and a backfill is the real answer, and it is the right call
 * at the third machine reader rather than the first. Until then this test is
 * the mitigation, and it is honest about being one.
 *
 * Reads the file rather than running it, the idiom
 * `tests/services/log-shape.test.ts` established: no socket, no browser.
 */

const WORKFLOW = join('.github', 'workflows', 'failed-runs.yml');

function workflow(): string {
  return readFileSync(WORKFLOW, 'utf8');
}

describe('failed-runs workflow', () => {
  it('pins the exact action the scheduler writes', () => {
    expect(workflow()).toContain(SCHEDULED_RUN_NOT_STARTED);
  });

  /**
   * The file's own "what this does not cover" section said a dispatch that
   * never landed leaves nothing for any query to find. That is no longer true,
   * and a stale caveat is worse than none: it tells the next reader not to
   * bother looking for the thing that is now there.
   */
  it('no longer claims a dispatch that never landed leaves nothing to find', () => {
    const text = workflow();

    expect(text).not.toContain('Those leave nothing for any query to find');
    expect(text).not.toContain('is not counted above');
  });

  // The counterpart to the truncation guard on the failed-run scan: a count
  // read from a response that hit its limit does not cover its window.
  it('guards the new check against truncation too', () => {
    expect(workflow()).toContain('EVENT_LIMIT');
  });
});
