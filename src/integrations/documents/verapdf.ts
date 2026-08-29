import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { conformanceSchema, type Conformance } from '../../domain/document-remediation';
import { childEnv } from './stage';
import { resolveJavaRuntime, type JavaRuntime } from './java-runtime';
import { logWarn } from '../../services/logger';

const execFileAsync = promisify(execFile);

/**
 * The product's second instrument: veraPDF, validating PDF/UA-1.
 *
 * `Inspect` answers what a document contains; this answers whether the file
 * conforms — from the reference checker, not from our own approximation of
 * it. The distinction is the lesson of three silent-gap incidents in a row:
 * every clause our reading could not see arrived at the client as nothing at
 * all, and each got a hand-built check until AGENTS.md recorded why that had
 * to stop — two definitions of conformance, drifting.
 *
 * ## Absence is an answer, not a pass
 *
 * A host without the jar (a laptop that never ran `prepare-verapdf.ts`) gets
 * `{ checker: 'none' }`, which every surface renders as "conformance not
 * checked" — never as clean. Silence was the defect; a missing checker must
 * not reintroduce it.
 *
 * ## Exit codes are part of the contract
 *
 * veraPDF exits 1 for a non-compliant document WITH a full report on stdout.
 * That is the answer this exists to fetch, not a failure — the same reading
 * `validate.mjs` proved in the research spike and the graders have used
 * since. Anything else non-zero is a stage failure and is reported as
 * `checker: 'none'` with a log line, because a checker that crashed knows
 * nothing about the document.
 */

/** Where `prepare-verapdf.ts` puts the CLI jar, relative to the repo root. */
export const BUNDLED_VERAPDF_JAR = join('vendor', 'verapdf', 'cli.jar');

export type VeraPdfOptions = {
  root?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  /** Injected by tests so the fast suite never starts a JVM. */
  runtime?: JavaRuntime;
  /** Injected by tests to fabricate checker output without a jar. */
  executor?: (
    bin: string,
    args: string[],
    options: { timeout: number; maxBuffer: number; env: Record<string, string | undefined> },
  ) => Promise<{ stdout: string }>;
};

/** The same ceiling the other stages use; a 90-page agenda validates in ~1s. */
const DEFAULT_TIMEOUT_MS = 60_000;

const MAX_HEAP = '-Xmx512m';

type RuleSummary = { clause: string; testNumber: number; failedChecks: number };

/**
 * Validate one PDF against UA-1.
 *
 * Never throws: every path ends in a `Conformance`, because the caller's
 * question — "what may I claim about this file?" — always has an answer, even
 * when that answer is "nothing was checked".
 */
export async function checkUa1(pdfPath: string, options: VeraPdfOptions = {}): Promise<Conformance> {
  const root = options.root ?? process.cwd();
  const jar = join(root, BUNDLED_VERAPDF_JAR);
  const runtime = options.runtime ?? resolveJavaRuntime({ root: options.root, env: options.env });

  if (!runtime.available) {
    return { checker: 'none', reason: 'unavailable' };
  }
  if (options.executor === undefined && !existsSync(jar)) {
    return { checker: 'none', reason: 'unavailable' };
  }

  const execute = options.executor ?? execFileAsync;
  let raw = '';
  try {
    const result = await execute(runtime.javaBin, [MAX_HEAP, '-jar', jar, '-f', 'ua1', '--format', 'json', pdfPath], {
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      env: childEnv(options.env ?? process.env),
    });
    raw = result.stdout;
  } catch (error) {
    const e = error as { code?: number; stdout?: string; killed?: boolean };
    if (e.code === 1 && e.stdout !== undefined && e.stdout.length > 0) {
      // Non-compliant, with the report. The answer, not an error.
      raw = e.stdout;
    } else {
      logWarn('document_conformance_failed', {
        exitCode: typeof e.code === 'number' ? e.code : null,
        timedOut: Boolean(e.killed),
      });
      return { checker: 'none', reason: 'unavailable' };
    }
  }

  try {
    const report = JSON.parse(raw) as {
      report?: { jobs?: Array<{ validationResult?: Array<{ compliant?: boolean; details?: { ruleSummaries?: RuleSummary[] } }> }> };
    };
    const result = report.report?.jobs?.[0]?.validationResult?.[0];
    if (result === undefined) {
      logWarn('document_conformance_unparseable', { bytes: raw.length });
      return { checker: 'none', reason: 'unavailable' };
    }
    if (result.compliant === true) {
      return conformanceSchema.parse({ checker: 'verapdf-ua1', compliant: true });
    }
    const failingClauses = (result.details?.ruleSummaries ?? [])
      .filter((rule) => rule.failedChecks > 0)
      .map((rule) => `${rule.clause}-${rule.testNumber}`)
      .filter((value, index, all) => all.indexOf(value) === index)
      .sort();
    return conformanceSchema.parse({ checker: 'verapdf-ua1', compliant: false, failingClauses });
  } catch {
    logWarn('document_conformance_unparseable', { bytes: raw.length });
    return { checker: 'none', reason: 'unavailable' };
  }
}
