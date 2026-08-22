import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The rule this file enforces: `FirstRunControl` starts a watch from exactly
 * one place.
 *
 * It used to start one from two. `start()` polled with the id from its own
 * 202, and the refresh it fired re-derived the stage and handed the *same*
 * mounted instance a `pollUrl`, so the `[pollUrl]` effect started a second
 * loop for the same run — double the request rate and two refreshes at
 * completion. A `watching` ref arbitrated, which is a guard around a design
 * that permits the defect. #62 recorded that collapsing the callers was the
 * real fix and left it undone; #81 did it, and `start()` now deliberately
 * ignores the `pollUrl` its 202 carries.
 *
 * ## Why this is a source check and not a browser test
 *
 * The hydration suite asserts the same property at runtime and says plainly
 * that it is "armed only when a poll actually fires, which on this journey is
 * seldom" — the wizard's target cannot resolve, so the run reaches its failed
 * row inside the watcher's first 3s sleep and the assertions pass having
 * observed nothing. On CI that is every time.
 *
 * Arming it there is not available. The component only watches when the server
 * renders the `running` stage, which needs a genuinely in-flight run, and the
 * product has no supported way to hold one in that state — `startRun` writes
 * the `running` row and immediately dispatches the work. Waiting on that race
 * would be a timing-dependent test written to defend against timing-dependent
 * tests.
 *
 * So this asserts about the source, the way `log-shape.test.ts` does for
 * logging envelopes and the deployment-config suite does for secrets: the
 * property is structural now, so check the structure. It is cheap, it runs in
 * the fast suite, and unlike the runtime assertions it cannot pass vacuously.
 *
 * What it does not do is prove the watcher works — the hydration walk does
 * that, end to end, every run. This proves only that the second caller has not
 * come back.
 */

const COMPONENT = join(
  'src',
  'app',
  'platform',
  'components',
  'setup',
  'first-run-control.tsx',
);

/** Call sites of `poll(...)`, excluding the declaration itself. */
function pollCallSites(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => /\bpoll\(/.test(line))
    .filter((line) => !/function\s+poll\(/.test(line));
}

describe('FirstRunControl’s watcher', () => {
  it('is started from exactly one place', () => {
    const source = readFileSync(COMPONENT, 'utf8');
    const calls = pollCallSites(source);

    expect(calls.map((line) => line.trim()), `poll() call sites in ${COMPONENT}`).toHaveLength(1);
  });

  it('is not started by the click handler', () => {
    // The specific regression, named rather than inferred from the count
    // above: a second caller could be added anywhere, but the one that was
    // there before — and the one a future edit is most likely to reach for,
    // because the 202 has a `pollUrl` sitting right there — is `start()`.
    //
    // Split on the declaration rather than parsing: everything from
    // `async function start(` to the end of the file is the handler and the
    // render below it, and neither may poll.
    const source = readFileSync(COMPONENT, 'utf8');
    const [beforeStart, afterStart] = source.split('async function start(');

    expect(beforeStart, 'the file no longer declares `start` under that name').toBeDefined();
    expect(afterStart, 'the file no longer declares `start` under that name').toBeDefined();
    expect(pollCallSites(afterStart!), '`poll()` called from `start()` or below').toEqual([]);
  });

  it('cancels the watch it started, from the effect that started it', () => {
    // The other half of one-caller: the loop has to stop when the run it was
    // watching is superseded or the operator leaves. That belongs to the
    // effect's cleanup, because the effect is what began it — a cancellation
    // flag owned by the component instead was the shape that let one path's
    // cancellation silently apply to another path's loop.
    const source = readFileSync(COMPONENT, 'utf8');

    expect(source, 'the effect returns a cleanup').toMatch(/return\s*\(\)\s*=>\s*{/);
    expect(
      source,
      'no component-scoped `useRef` cancellation flag — cancellation is per watch',
    ).not.toMatch(/useRef\(/);
  });
});
