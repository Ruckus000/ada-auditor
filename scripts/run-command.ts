/**
 * Spawns a child process, and says what happened when it fails.
 *
 * Side-effect free on purpose — no `main()`, nothing run at import — so a test
 * can import it. `split-statements.ts` and `load-env.ts` have the same shape,
 * and for the same reason: every `scripts/*` entry point calls `main()` at
 * import, so anything a test needs to reach has to live outside one.
 *
 * ## Why this module exists
 *
 * This paragraph was a comment on one `catch` in `prepare-libreoffice.ts`. It
 * is here because it turned out to be the reasoning for a module, not for a
 * call site:
 *
 * > `stderr`, not the first line of the error. `execFile` puts "Command
 * > failed: <the command>" in the message and the *reason* — the dynamic
 * > loader naming the library it could not find — in `stderr`. The first
 * > version of this handler discarded it and cost a deploy cycle that
 * > reported only that something had failed, which was already obvious.
 * > The same mistake this file's `fetch` handler was fixed for.
 *
 * That comment was right about the mistake and wrong about the fix, and the
 * sentence it was missing is this one: **it read `stderr` but not `stdout`.**
 *
 * `[V]` Vercel run 34002062130 died on
 *
 *     assembling the minimal runtime
 *     Command failed: /tmp/ada-jdk-XXXX/jdk/bin/jlink --add-modules … --output …
 *
 * and nothing else. Reproduced in `amazonlinux:2023`, the cause was
 *
 *     Error: java.io.IOException: Cannot run program "objcopy": error=2, No such file or directory
 *
 * — `jlink --strip-debug` execs `objcopy`, the bare image has no `binutils`,
 * and **jlink wrote that line to STDOUT**. `promisify(execFile)` builds its
 * rejection message from the command line alone; `stdout` and `stderr` ride
 * along as properties nobody was reading. A handler that reads only `stderr`
 * discards a jlink failure just as completely as one that reads neither.
 *
 * So: both streams, stdout first, and the child's argv printed so the reader
 * can run the thing themselves. Never the environment — on the deploy runner
 * that holds `VERCEL_TOKEN`.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Head and tail, because a stack and a summary sit at opposite ends.
 *
 * A Java exception names its cause on line 1 and then unwinds for 200 frames;
 * `javac` prints one line per error and puts `42 errors` last. Keeping only
 * the head loses the count, keeping only the tail loses the cause, and keeping
 * the whole thing puts a megabyte of ELF warnings in a build log.
 */
export const MAX_LINES = 60;
const HEAD_LINES = 40;
const TAIL_LINES = 20;

/**
 * The second cut, after the line cut. Sixty lines of ordinary output is a few
 * kilobytes; sixty lines of a minified stack trace or a single unwrapped
 * 20MB line is not, and a line budget alone cannot tell them apart.
 */
export const MAX_CHARS = 8_000;

/**
 * These are batch tools reading whole documents, not request handlers. Node's
 * own default is 1MB, which `veraPDF --version` fits and a `javac -Xlint:all`
 * over a large tree does not — and overflowing it destroys exactly the output
 * this module exists to preserve.
 */
export const DEFAULT_MAX_BUFFER = 8 * 1024 * 1024;

/**
 * The slice of the environment a child is given.
 *
 * Deliberately looser than `NodeJS.ProcessEnv`, for the reason `Env` in
 * `src/integrations/documents/java-runtime.ts` gives at length: Next's types
 * make `NODE_ENV` required, so a test that cares about two keys cannot
 * construct one. `[V]` Typing this as `ProcessEnv` failed typecheck on exactly
 * that — `Property 'NODE_ENV' is missing`, in the test asserting that
 * `VERCEL_TOKEN` never reaches a build log.
 */
export type CommandEnv = Record<string, string | undefined>;

/**
 * The seam a test injects, following `StageExecutor` in
 * `src/integrations/documents/stage.ts`: same idea, so the unit tests never
 * spawn anything and can still assert what the argv would have been.
 */
export type CommandExecutor = (
  bin: string,
  args: string[],
  options: { cwd?: string; env?: CommandEnv; timeout?: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

export type RunOptions = {
  cwd?: string;
  env?: CommandEnv;
  /** No default. A build step that should not hang forever asks for one. */
  timeout?: number;
  maxBuffer?: number;
  /** Injected by tests. Nothing in a script passes this. */
  executor?: CommandExecutor;
};

/**
 * A property off an unknown value, as a trimmed string, without trusting it.
 *
 * `String(v)` rather than a type check because `execFile` hands back a Buffer
 * when `encoding` is not utf8, and a Buffer's text is exactly what is wanted.
 * A getter that throws, or a value whose `toString` throws, is not a reason to
 * lose the rest of the report.
 */
function readStream(source: unknown, key: 'stdout' | 'stderr'): string {
  if (typeof source !== 'object' || source === null) return '';
  try {
    const value = (source as Record<string, unknown>)[key];
    if (value === undefined || value === null) return '';
    return String(value).trim();
  } catch {
    return '';
  }
}

/** Head + tail by line, then a hard character cut. Per stream. */
function truncate(text: string): string {
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

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

/**
 * Everything the failed child said, and never nothing.
 *
 * Both streams when both spoke — labelled, because a reader who cannot tell
 * which stream said what cannot tell a diagnostic from a progress line, and
 * jlink is the proof that the interesting one is not always `stderr`. Exactly
 * one stream is returned bare, so the common case reads the way the good
 * handler this generalises always did.
 *
 * When neither spoke, `error.message`: that is what carries `spawn X ENOENT`
 * and `stdout maxBuffer length exceeded`, neither of which the child is
 * around to explain.
 *
 * Takes `unknown` and never throws, because it runs on the error path. A
 * `throw 'string'` somewhere below must not become a second, worse failure on
 * top of the first.
 */
export function describeExecFailure(error: unknown): string {
  const stdout = truncate(readStream(error, 'stdout'));
  const stderr = truncate(readStream(error, 'stderr'));

  if (stdout && stderr) {
    return `stdout:\n${indent(stdout)}\nstderr:\n${indent(stderr)}`;
  }
  if (stdout) return stdout;
  if (stderr) return stderr;

  if (typeof error === 'object' && error !== null) {
    try {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) return truncate(message.trim());
    } catch {
      // A throwing getter is not a reason to give up on the fallbacks below.
    }
  }

  if (error !== undefined && error !== null) {
    try {
      const text = String(error).trim();
      if (text) return truncate(text);
    } catch {
      // Symbols and objects with a hostile `toString` land here.
    }
  }

  return 'the command failed and produced no output, message or value.';
}

/**
 * The parenthesised half of the headline: what kind of failure this was.
 *
 * Kept apart from the detail because the *fix* differs by kind and the detail
 * often cannot say which. A missing binary and a tool that ran and refused are
 * one exit status apart and nothing alike: one is a package to install in the
 * build image, the other is the input.
 *
 * `timeoutMs` is the caller's own budget, which the error does not carry.
 */
export function execFailureStatus(error: unknown, timeoutMs?: number): string {
  const e =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown; signal?: unknown; killed?: unknown })
      : {};

  // Before the killed/signal check below: Node kills the child to enforce
  // maxBuffer, so an overflow arrives looking like a timeout.
  if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
    return 'output exceeded maxBuffer';
  }
  if (e.code === 'ENOENT') return 'the program is not on PATH';
  if (e.code === 'EACCES') return 'the program is not executable';

  const signal = typeof e.signal === 'string' ? e.signal : undefined;
  if (e.killed === true || signal === 'SIGTERM') {
    return timeoutMs === undefined ? 'timed out' : `timed out after ${timeoutMs}ms`;
  }

  if (typeof e.code === 'number') return `exit ${e.code}`;
  if (signal) return `killed by ${signal}`;
  if (typeof e.code === 'string' && e.code) return e.code;
  return 'failed';
}

/**
 * Runs `bin` with `args`, or throws a message somebody can act on.
 *
 * `what` is the thing being attempted, in the words the build log already
 * uses — "assembling the minimal runtime", not "jlink". The thrown message is
 *
 *     <what> (<status>)
 *     $ <bin> <args>
 *     <everything the child said>
 *
 * `execFile`, never `exec`: `args` is an array handed to a binary, so a path
 * containing a space, a quote or a semicolon is one argument and can never
 * become shell syntax.
 *
 * The environment is never printed. On the deploy runner it holds
 * `VERCEL_TOKEN`, and a build log is not a place to find that out.
 */
export async function run(
  what: string,
  bin: string,
  args: string[],
  options: RunOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const { cwd, env, timeout, maxBuffer = DEFAULT_MAX_BUFFER, executor } = options;
  const execute = executor ?? defaultExecutor;

  // Assembled rather than spread, so an absent option stays absent instead of
  // becoming an explicit `undefined` that overrides a downstream default.
  const spawnOptions: { cwd?: string; env?: CommandEnv; timeout?: number; maxBuffer: number } = {
    maxBuffer,
  };
  if (cwd !== undefined) spawnOptions.cwd = cwd;
  if (env !== undefined) spawnOptions.env = env;
  if (timeout !== undefined) spawnOptions.timeout = timeout;

  try {
    return await execute(bin, args, spawnOptions);
  } catch (error) {
    throw new Error(
      `${what} (${execFailureStatus(error, timeout)})\n` +
        `$ ${[bin, ...args].join(' ')}\n` +
        describeExecFailure(error),
    );
  }
}

/**
 * The cast is where `CommandEnv` and `ProcessEnv` meet, and it is safe in this
 * direction: every value is a string or absent, which is all `execFile` reads.
 * `stage.ts` makes the same one for the same reason.
 */
const defaultExecutor: CommandExecutor = (bin, args, options) =>
  execFileAsync(bin, args, { ...options, env: options.env as NodeJS.ProcessEnv | undefined });
