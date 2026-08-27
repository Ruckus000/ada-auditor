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

/**
 * A stage that produces a file rather than a reading.
 *
 * `Inspect` reports and prints JSON; `Finish` writes a PDF and prints nothing.
 * They need different runners, and giving the writing one its own type is not
 * ceremony: a reading stage's output is the value, while a writing stage's
 * output is a file this process never sees, so "it worked" is genuinely all
 * there is to return. Squeezing that into `StageResult<void>` would invite a
 * caller to read a value that does not exist.
 */
export type StageOutcome = { ok: true } | { ok: false; failure: StageFailure };

export type StageExecutor = (
  bin: string,
  args: string[],
  /**
   * Always the filtered environment — see `childEnv`. Optional only because a
   * test may inject an executor that ignores it; nothing in `src` spawns a
   * document tool with the environment it was handed.
   */
  options: { timeout: number; maxBuffer: number; env?: Env },
) => Promise<{ stdout: string; stderr: string }>;

/**
 * `Env` is deliberately looser than Node's `ProcessEnv`, which its own comment
 * in `java-runtime.ts` explains: Next's types make `NODE_ENV` required, so a
 * two-key object cannot be constructed in a test. The cast is where the two
 * meet, and it is safe in this direction — every value is a string or absent,
 * which is all `execFile` reads.
 */
const defaultExecutor: StageExecutor = (bin, args, options) =>
  execFileAsync(bin, args, { ...options, env: options.env as NodeJS.ProcessEnv | undefined });

/**
 * What a spawned document tool is allowed to see of our environment.
 *
 * `execFile` with no `env` hands the child the whole of `process.env`, which on
 * this deployment is `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, and every
 * `AUDIT_CREDENTIAL_<REF>_USER`/`_PASS` — real client website logins. Both
 * children parse bytes we do not control: the by-URL routes fetch documents
 * from third-party servers found by crawling a client's site, so the caller is
 * authenticated and the document is not. A parser bug should not reach a
 * client's password.
 *
 * Deny by default, so a variable added later is private until someone decides
 * otherwise. Each name below is here for a reason:
 *
 * - `PATH` — the `soffice` launcher is a shell script and calls `basename`,
 *   `dirname`, `sed`. Without this nothing runs at all.
 * - `HOME` — LibreOffice's profile and fontconfig cache; `java.util.prefs`.
 * - `LD_LIBRARY_PATH` — the libraries collected beside a bundled install.
 * - `TMPDIR` — both children write temp files, and dropping it would move them
 *   somewhere the caller did not choose.
 * - `LANG`, `LC_ALL`, `LC_CTYPE` — **load-bearing, not housekeeping.** On Java
 *   17 `file.encoding` still follows the platform locale, so dropping these can
 *   flip the JVM's default charset to ASCII and silently mangle non-ASCII text
 *   extracted from a PDF — which is exactly the document titles this pipeline
 *   transcribes. Silent corruption is a worse outcome than the exposure this
 *   function exists to prevent.
 *
 * Notably absent: `JAVA_TOOL_OPTIONS` and `_JAVA_OPTIONS`, which inject JVM
 * flags into any child that reads them.
 *
 * Resolution is unaffected and deliberately so — `resolveJavaRuntime` and
 * `resolveLibreOffice` still read the whole environment, because they need
 * `JAVA_HOME`, `SOFFICE_PATH` and `PATH` to find a toolchain at all. Only what
 * the child *receives* is filtered.
 */
const INHERITED = ['PATH', 'HOME', 'LD_LIBRARY_PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE'];

export function childEnv(base: Env): Env {
  const env: Env = {};
  for (const name of INHERITED) {
    const value = base[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

/** The first line of stderr, which is the part that names the cause. */
function firstLine(text: string): string {
  return text.split('\n')[0]?.trim() ?? '';
}

export type StageOptions = {
  root?: string;
  env?: Env;
  timeoutMs?: number;
  maxBuffer?: number;
  /** Injected by tests so the fast suite never starts a JVM. */
  executor?: StageExecutor;
  /** Injected by tests to exercise failures without a real toolchain. */
  runtime?: JavaRuntime;
};

/**
 * Runs the JVM and hands back stdout, or a typed failure.
 *
 * Shared by both public runners so that resolution, argument construction,
 * timeout handling and error mapping cannot drift between a stage that reads
 * and a stage that writes. The difference between them is only what happens to
 * stdout afterwards.
 *
 * `execFile`, never `exec`. Arguments are passed as an array to a binary, so a
 * document path containing a quote, a space or a semicolon is an argument and
 * can never become shell syntax. `compare.mjs` made the same choice; keeping it
 * here means a file name taken from a client's website cannot reach a shell.
 */
async function spawnStage(
  stage: string,
  args: string[],
  options: StageOptions,
): Promise<{ ok: true; stdout: string } | { ok: false; failure: StageFailure }> {
  const runtime = options.runtime ?? resolveJavaRuntime({ root: options.root, env: options.env });

  if (!runtime.available) {
    return { ok: false, failure: { kind: 'unavailable', reason: runtime.reason } };
  }

  const execute = options.executor ?? defaultExecutor;

  try {
    const result = await execute(
      runtime.javaBin,
      ['-cp', runtime.classpath, stage, ...args],
      {
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        env: childEnv(options.env ?? process.env),
      },
    );
    return { ok: true, stdout: result.stdout };
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
}

/**
 * Runs a stage that reports, and validates what it printed.
 */
export async function runStage<T>(
  stage: string,
  args: string[],
  schema: ZodType<T>,
  options: StageOptions = {},
): Promise<StageResult<T>> {
  const spawned = await spawnStage(stage, args, options);
  if (!spawned.ok) {
    return spawned;
  }
  const stdout = spawned.stdout;

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

/**
 * Runs a stage whose product is a file.
 *
 * Nothing is parsed, because there is nothing to parse — `Finish` writes a PDF
 * and prints nothing at all. A zero exit means the JVM believed it succeeded,
 * and that is the *weakest* of the guarantees this kind of stage needs: it says
 * the process did not crash, not that the document it wrote is sound.
 *
 * **Verifying the output is the caller's job and is not optional.** A repair
 * stage's failure mode is a delivered file carrying a claim that is wrong and
 * invisible — nobody reviewing the PDF can see that a heading was demoted or an
 * image dropped out of the structure tree. `inspectDocument` before and after,
 * compared with `structuralChanges` in `domain/document-structure.ts`, is what
 * turns "exited 0" into "changed only what it said it would".
 */
export async function runWritingStage(
  stage: string,
  args: string[],
  options: StageOptions = {},
): Promise<StageOutcome> {
  const spawned = await spawnStage(stage, args, options);
  return spawned.ok ? { ok: true } : { ok: false, failure: spawned.failure };
}
