/**
 * What a failed child process actually said — both streams, never just one.
 *
 * ## Why this file exists
 *
 * Every runner here formatted its own failures as
 *
 *     (e.stderr?.toString() || String(e)).split('\n')[0]
 *
 * which is wrong twice. It reads only `stderr`, and it keeps only the first
 * line.
 *
 * `[V]` The stderr half is the same defect that cost a deploy cycle in
 * `scripts/run-command.ts` (#212): `jlink --strip-debug` could not exec
 * `objcopy` and printed `Cannot run program "objcopy"` to **stdout**, so a
 * handler reading `stderr` reported a blank reason. A Java stage that dies
 * while writing its JSON report to stdout fails here in exactly that shape.
 *
 * The first-line half is its own bug: `execFileSync` puts
 * `Command failed: <argv>` in `error.message`, so when a child says nothing on
 * either stream the "reason" recorded is the command line the reader already
 * has.
 *
 * ## Why this is not `scripts/run-command.ts`
 *
 * It is a deliberate second copy, not an oversight — do not "fix" it by
 * deleting one.
 *
 * `run-command.ts` is TypeScript. `[V]` A `.mjs` importing a `.ts` fails under
 * plain `node` with `ERR_UNKNOWN_FILE_EXTENSION` (v20.20.2) and needs `tsx`,
 * and every runner in this spike documents itself as `node <script>.mjs`.
 * Reaching across would also make throwaway spike code depend on `scripts/`,
 * where `CLAUDE.md` permits this directory to depend on `src/` only.
 *
 * The layering rule this repo states is `YAGNI → KISS → SRP → DRY`, and DRY is
 * last for cases like this one. If any of this graduates into `src/`, it gets
 * `run-command.ts` and this file goes away.
 *
 * The two must agree on behaviour; `run-command.ts` is the original and wins
 * any disagreement.
 *
 * The environment is never read or printed here, matching that file's rule.
 */

/**
 * Head and tail, because a stack and a summary sit at opposite ends: a Java
 * exception names its cause on line 1 and then unwinds, while a tool that
 * counts its complaints puts the total last.
 */
export const MAX_LINES = 60;
const HEAD_LINES = 40;
const TAIL_LINES = 20;

/** The second cut. Sixty lines of minified stack trace is not a few kilobytes. */
export const MAX_CHARS = 8_000;

/** A console table gets one line per document, so the summary has to fit one. */
export const SUMMARY_CHARS = 200;

/**
 * A stream off an unknown value, as trimmed text, without trusting it.
 *
 * `String(value)` rather than a type check because `execFileSync` hands back
 * **Buffers**, not strings, and a Buffer's text is exactly what is wanted. A
 * getter that throws is not a reason to lose the rest of the report.
 */
function readStream(source, key) {
  if (typeof source !== 'object' || source === null) return '';
  try {
    const value = source[key];
    if (value === undefined || value === null) return '';
    return String(value).trim();
  } catch {
    return '';
  }
}

/** Head + tail by line, then a hard character cut. Per stream. */
function truncate(text) {
  const lines = text.split('\n');
  let out = text;

  if (lines.length > MAX_LINES) {
    const omitted = lines.length - HEAD_LINES - TAIL_LINES;
    out = [
      ...lines.slice(0, HEAD_LINES),
      `… ${omitted} lines omitted …`,
      ...lines.slice(lines.length - TAIL_LINES),
    ].join('\n');
  }

  if (out.length > MAX_CHARS) {
    out = `${out.slice(0, MAX_CHARS)}\n… truncated at ${MAX_CHARS} characters …`;
  }

  return out;
}

function indent(text) {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

/** `.message`, then the value itself — what carries `spawn X ENOENT`. */
function readFallback(error) {
  if (typeof error === 'object' && error !== null) {
    try {
      const message = error.message;
      if (typeof message === 'string' && message.trim()) return message.trim();
    } catch {
      // A throwing getter is not a reason to skip the fallback below.
    }
  }

  if (error !== undefined && error !== null) {
    try {
      const text = String(error).trim();
      if (text) return text;
    } catch {
      // Symbols and objects with a hostile `toString` land here.
    }
  }

  return '';
}

/**
 * Everything the failed child said, and never nothing.
 *
 * Both streams when both spoke — labelled, because a reader who cannot tell
 * which stream said what cannot tell a diagnostic from a progress line, and
 * jlink is the proof that the interesting one is not always `stderr`. Exactly
 * one stream is returned bare, so the common case reads plainly.
 *
 * Takes anything and never throws: it runs on the error path, where a second
 * failure on top of the first helps nobody. A `JSON.parse` SyntaxError from a
 * child that *succeeded* also arrives here, and falls through to its message.
 */
export function describeExecFailure(error) {
  const stdout = truncate(readStream(error, 'stdout'));
  const stderr = truncate(readStream(error, 'stderr'));

  if (stdout && stderr) {
    return `stdout:\n${indent(stdout)}\nstderr:\n${indent(stderr)}`;
  }
  if (stdout) return stdout;
  if (stderr) return stderr;

  const fallback = readFallback(error);
  if (fallback) return truncate(fallback);

  return 'the command failed and produced no output, message or value.';
}

/**
 * One line, for a console table or a report entry that has room for one.
 *
 * Drawn from BOTH streams — stdout first, as `describeExecFailure` orders them
 * — so a summary never silently prefers the stream that happened to be empty.
 *
 * `prefer: 'last'` for tools whose useful line is the final one. curl is the
 * case in hand: it narrates redirects and retries and names the actual failure
 * last, which is why `harvest.mjs` asked for `.pop()` before this existed.
 */
export function summariseExecFailure(error, { prefer = 'first' } = {}) {
  const split = (text) =>
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

  // The fallback is consulted only when BOTH streams are silent. Concatenating
  // it unconditionally let `String(error)` — `[object Object]` for the plain
  // objects execFileSync throws — become the last line and outrank the real
  // reason under `prefer: 'last'`.
  const fromStreams = [readStream(error, 'stdout'), readStream(error, 'stderr')].flatMap(split);
  const lines = fromStreams.length > 0 ? fromStreams : split(readFallback(error));

  const line = prefer === 'last' ? lines.at(-1) : lines[0];
  if (!line) return 'no output';

  return line.length > SUMMARY_CHARS ? `${line.slice(0, SUMMARY_CHARS)}…` : line;
}
