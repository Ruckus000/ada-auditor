import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ZodType } from 'zod';

import { logWarn } from '../../services/logger';
import { resolveJavaRuntime, type Env, type JavaRuntime } from './java-runtime';

/**
 * Runs one Java document stage and validates what it printed.
 *
 * This is the whole boundary. A stage is a class on a classpath that reads a
 * file, prints JSON to stdout and exits; nothing above this module knows a JVM
 * exists, and nothing below it knows what the data means. That is the same seam
 * `services/deterministic-audit.ts` holds against axe-core — plain data crosses,
 * the engine does not — and it is what keeps the layers testable apart.
 *
 * ## Output convention
 *
 * `Inspect` prints one JSON document as the whole of stdout, so that is what is
 * parsed. Some *other* stages in the spike print human progress lines first and
 * put their JSON on the last line, which is why `run-headings.mjs` reads
 * `.split('\n').at(-1)`. Nothing here supports that yet, deliberately: no such
 * stage has graduated, and a parser that guesses which convention it is looking
 * at would eventually guess wrong on a document whose text happens to end in a
 * brace. When one graduates, give it an explicit mode.
 *
 * ## Why validation is not optional
 *
 * The input is another process's stdout. `JSON.parse` alone would hand a
 * caller `undefined` fields from a stage that changed, failing somewhere far
 * from the cause, so every result is parsed against a schema at the point it
 * crosses.
 */

const execFileAsync = promisify(execFile);

/**
 * A stage is not a request handler; it is a batch tool run against a document
 * that may be hundreds of pages. `compare.mjs` already needs 32MB of buffer for
 * `Inspect` against a real municipal PDF, so the ceiling here is set well above
 * the largest thing measured rather than at it.
 */
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * A hung JVM must not run out the caller's own budget. Sixty seconds is far
 * more than any measured stage run and far less than the platform's 300s
 * function ceiling, so a stuck process surfaces as a stage failure rather than
 * as a dead request with nothing to show for it.
 */
const DEFAULT_TIMEOUT_MS = 60_000;

export type StageFailure =
  /** No toolchain here. Expected in production; never an error. */
  | { kind: 'unavailable'; reason: string }
  /** The JVM ran and the stage refused, crashed, or was killed on timeout. */
  | { kind: 'failed'; stage: string; exitCode: number | null; stderr: string; timedOut: boolean }
  /** The stage exited 0 and printed something this contract does not accept. */
  | { kind: 'invalid-output'; stage: string; detail: string };

export type StageResult<T> = { ok: true; value: T } | { ok: false; failure: StageFailure };

export type StageExecutor = (
  bin: string,
  args: string[],
  options: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

const defaultExecutor: StageExecutor = (bin, args, options) => execFileAsync(bin, args, options);

/** The first line of stderr, which is the part that names the cause. */
function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}

/**
 * `execFile`, never `exec`.
 *
 * Arguments are passed as an array to a binary, so a document path containing a
 * quote, a space or a semicolon is an argument and can never become shell
 * syntax. `compare.mjs` made the same choice; keeping it here means a file name
 * taken from a client's website cannot reach a shell.
 */
export async function runStage<T>(
  stage: string,
  args: string[],
  schema: ZodType<T>,
  options: {
    root?: string;
    env?: Env;
    timeoutMs?: number;
    maxBuffer?: number;
    /** Injected by tests so the fast suite never starts a JVM. */
    executor?: StageExecutor;
    /** Injected by tests to exercise failures without a real toolchain. */
    runtime?: JavaRuntime;
  } = {},
): Promise<StageResult<T>> {
  const runtime = options.runtime ?? resolveJavaRuntime({ root: options.root, env: options.env });

  if (!runtime.available) {
    return { ok: false, failure: { kind: 'unavailable', reason: runtime.reason } };
  }

  const execute = options.executor ?? defaultExecutor;

  let stdout: string;
  try {
    const result = await execute(
      runtime.javaBin,
      ['-cp', runtime.classpath, stage, ...args],
      {
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
      },
    );
    stdout = result.stdout;
  } catch (error) {
    // `execFile` rejects with the exit code, the signal, and whatever the
    // process managed to write. A timeout arrives as a kill signal rather than
    // a code, and the two need telling apart: one is a broken document, the
    // other is a stage that never finishes.
    const e = error as { code?: number; killed?: boolean; signal?: string; stderr?: string };
    const timedOut = Boolean(e.killed) || e.signal === 'SIGTERM';

    const failure: StageFailure = {
      kind: 'failed',
      stage,
      exitCode: typeof e.code === 'number' ? e.code : null,
      stderr: firstLine(e.stderr ?? String(error)),
      timedOut,
    };

    // Structured, through the shared logger — never a hand-built envelope.
    // `tests/services/log-shape.test.ts` greps the tree for those, because five
    // call sites had already drifted apart before it existed.
    logWarn('document_stage_failed', {
      stage,
      exitCode: failure.exitCode,
      timedOut,
      stderr: failure.stderr,
    });

    return { ok: false, failure };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    logWarn('document_stage_unparseable', { stage, bytes: stdout.length });
    return {
      ok: false,
      failure: {
        kind: 'invalid-output',
        stage,
        detail: `stage exited 0 but stdout was not JSON (${stdout.length} bytes)`,
      },
    };
  }

  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    const detail = validated.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');

    logWarn('document_stage_invalid_output', { stage, detail });
    return { ok: false, failure: { kind: 'invalid-output', stage, detail } };
  }

  return { ok: true, value: validated.data };
}
