/**
 * One line naming why a child process failed, read from BOTH of its streams.
 *
 * ## Why this is not an import of `../exec-failure.mjs`
 *
 * This directory may import only `node:` builtins and its own siblings, and
 * that is enforced, not promised — `tests/scripts/blind-corpus-keys-are-independent.test.ts`
 * fails on anything reaching further. The guarantee it protects is that the
 * answer keys are derived by instruments with no stake in the answer, never by
 * the product grading itself. A formatter for error text has no stake in any
 * key, but the rule is deliberately a bright line, and a bright line is worth
 * more than the few lines duplicated here.
 *
 * `../exec-failure.mjs` is the same rule for the runners outside this
 * directory, and `scripts/run-command.ts` is the production original that both
 * follow. Behaviour disagreements are resolved in that file's favour.
 *
 * ## Why both streams
 *
 * `[V]` Reading only `stderr` is how a `jlink` failure reached a deploy log as
 * a blank reason (scripts/run-command.ts, #212): it printed
 * `Cannot run program "objcopy"` to **stdout**. qpdf and curl are no different
 * — whichever stream carries the reason is the one that matters.
 *
 * The message is consulted only when both streams are silent, so
 * `String(error)` — `[object Object]` for what `execFileSync` throws — can
 * never outrank something the child actually said.
 */

/**
 * `prefer: 'last'` for a tool that narrates and then names the failure at the
 * end. curl is the case in hand: it reports redirects and retries first.
 */
export function failureLine(error, { prefer = 'first' } = {}) {
  const lines = (value) =>
    String(value ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

  const fromStreams = [...lines(error?.stdout), ...lines(error?.stderr)];
  const chosen = fromStreams.length > 0 ? fromStreams : lines(error?.message ?? error);

  const line = prefer === 'last' ? chosen.at(-1) : chosen[0];
  if (!line) return 'no output';

  return line.length > 200 ? `${line.slice(0, 200)}…` : line;
}
