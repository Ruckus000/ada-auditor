import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import {
  BUNDLED_JRE_DIR,
  resolveJavaRuntime,
} from '../../../../integrations/documents/java-runtime';
import { inspectDocument } from '../../../../integrations/documents/inspect';
import { authorizePrincipal } from '../../_lib/authorize';
import { createRequestId } from '../../_lib/request-id';

const execFileAsync = promisify(execFile);

/**
 * TEMPORARY. Delete once the spike has answered its question.
 *
 * Three assumptions hold up the plan to ship the reading half of the document
 * pipeline to Vercel, and **none of them can be checked from a developer
 * machine**:
 *
 * 1. A function can exec a bundled binary. `@sparticuz/chromium` is strong
 *    evidence, but it ships Chromium compressed and unpacks to `/tmp` with an
 *    explicit `chmod` — which hints the executable bit may not survive tracing.
 * 2. Files written during `next build` are visible to the tracer afterwards.
 *    The runtime is assembled by `scripts/prepare-jvm.ts` at build time, so if
 *    the tracer runs first, nothing ships.
 * 3. The build container's architecture matches the function's. The runtime is
 *    `linux/x64` and a mismatch means an exec failure, not a slow path.
 *
 * So this reports what it finds rather than asserting anything, and it runs the
 * real `Inspect` over a real PDF so the answer is "the pipeline works here",
 * not "a binary started".
 *
 * It is authenticated like everything else: a diagnostic that names paths and
 * versions is not something to leave open.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

/** A minimal, valid, untagged PDF. Enough for `Inspect` to have real work. */
const TINY_PDF = [
  '%PDF-1.4',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
  '4 0 obj<</Length 44>>stream',
  'BT /F1 12 Tf 20 100 Td (Probe document) Tj ET',
  'endstream endobj',
  '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  'trailer<</Root 1 0 R>>',
].join('\n');

export async function GET(request: Request) {
  const requestId = createRequestId();
  const startedAt = Date.now();

  if (!(await authorizePrincipal(request))) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const report: Record<string, unknown> = {
    requestId,
    // Assumption 3. If this is not x64/linux the bundled runtime is the wrong
    // build and everything below will fail for that reason alone.
    arch: process.arch,
    platform: process.platform,
    isVercel: Boolean(process.env.VERCEL),
    cwd: process.cwd(),
    // Assumption 2. If the tracer never shipped it, this is false and nothing
    // else matters.
    bundledRuntimeShipped: existsSync(`${process.cwd()}/${BUNDLED_JRE_DIR}/bin/java`),
  };

  const resolved = resolveJavaRuntime();
  report.resolved = resolved.available
    ? { available: true, javaBin: resolved.javaBin }
    : { available: false, reason: resolved.reason };

  if (!resolved.available) {
    return Response.json({ ...report, elapsedMs: Date.now() - startedAt }, { status: 503 });
  }

  // Assumption 1, directly. `java -version` writes to stderr and exits 0.
  try {
    const { stderr } = await execFileAsync(resolved.javaBin, ['-version'], { timeout: 20_000 });
    report.javaVersion = stderr.trim().split('\n')[0];
    report.canExec = true;
  } catch (error) {
    report.canExec = false;
    report.execError = String(error).split('\n')[0];
    return Response.json({ ...report, elapsedMs: Date.now() - startedAt }, { status: 500 });
  }

  // And the thing that actually matters: does the real stage run here?
  const dir = await mkdtemp(`${tmpdir()}/ada-probe-`);
  try {
    const pdf = `${dir}/probe.pdf`;
    await writeFile(pdf, TINY_PDF, 'latin1');

    const inspectStartedAt = Date.now();
    const result = await inspectDocument(pdf);
    report.inspectMs = Date.now() - inspectStartedAt;

    report.inspect = result.ok
      ? {
          ok: true,
          // Counts only. The probe's own document has no private content, but
          // the rule is the rule and this is the shape a real one would take.
          structureElements: result.value.structureElements,
          pages: result.value.pages,
          textChars: result.value.textChars,
        }
      : { ok: false, failure: result.failure };

    return Response.json(
      { ...report, elapsedMs: Date.now() - startedAt },
      { status: result.ok ? 200 : 500 },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
