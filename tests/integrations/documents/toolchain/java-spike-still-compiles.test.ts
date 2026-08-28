import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

import {
  DOCUMENT_JAVA_DIR,
  PDFBOX_JAR,
  resolveJavaRuntime,
} from '../../../../src/integrations/documents/java-runtime';

const execFileAsync = promisify(execFile);

/**
 * The graduated Java sources still satisfy the consumers they left behind.
 *
 * `Inspect.java` and `StructText.java` were **moved** into
 * `src/integrations/documents/java/` rather than copied, because `StructText`
 * is also used by `Headings.java` and `Tables.java`, which have not graduated —
 * and two copies of a shared file drift.
 *
 * That leaves an edge nothing was watching. `experiments/**` is outside the
 * production `tsconfig` and inside eslint's `ignores`, so it is typechecked and
 * linted by nothing; a change to `StructText`'s signature would break the spike
 * and every gate in this repository would stay green. The move created that
 * exposure, so the move owes it a check.
 *
 * This is not a test *of* the spike. It asserts one property of the graduated
 * sources: that they still compile against their remaining callers. A test may
 * read `experiments/` for that; production code may not, and does not.
 */

const runtime = resolveJavaRuntime();
const SPIKE = join(process.cwd(), 'experiments', 'document-remediation');
const JAVA_SRC = join(process.cwd(), DOCUMENT_JAVA_DIR);

/**
 * `javac`, which is not implied by `java` — a JRE-only host has one and not the
 * other, and skipping is better than failing on a machine that was never asked
 * to compile anything.
 */
function javacBinary(): string | null {
  const home = process.env.JAVA_HOME?.trim();
  if (home) {
    const candidate = join(home, 'bin', 'javac');
    if (existsSync(candidate)) return candidate;
  }
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (dir && existsSync(join(dir, 'javac'))) return join(dir, 'javac');
  }
  return null;
}

const javac = javacBinary();
const skip = !runtime.available || javac === null || !existsSync(SPIKE);

describe.skipIf(skip)('the spike still compiles against the graduated sources', () => {
  let out: string;

  afterAll(async () => {
    if (out) await rm(out, { recursive: true, force: true });
  });

  it('compiles every stage, moved and remaining, in one pass', async () => {
    out = await mkdtemp(join(tmpdir(), 'ada-spike-javac-'));

    // The command the spike's own README documents. If this drifts from that
    // README, the README is what a person will follow and this test is what
    // will notice.
    await execFileAsync(
      javac as string,
      [
        '-cp',
        join(process.cwd(), PDFBOX_JAR),
        '-d',
        out,
        // Matches the real build, and for the reason a deploy taught us:
        // `javac` falls back to the platform default encoding, which is
        // US-ASCII on a Linux CI box, and every em-dash in a comment becomes
        // `unmappable character`. Without this the test would pass here and
        // fail on any host that is not UTF-8.
        '-encoding',
        'UTF-8',
        ...(await readdir(SPIKE))
          .filter((n) => n.endsWith('.java'))
          .map((n) => join(SPIKE, n)),
        ...(await readdir(JAVA_SRC))
          .filter((n) => n.endsWith('.java'))
          .map((n) => join(JAVA_SRC, n)),
      ],
      { maxBuffer: 8 * 1024 * 1024 },
    );

    const classes = (await readdir(out)).filter((n) => n.endsWith('.class'));

    // The two that moved, and the two that still depend on the one that moved.
    // Naming them individually is the point: a bare "it compiled" would pass if
    // `Headings` and `Tables` had quietly stopped being built.
    // `Finish` has graduated too, and `run-finishing.mjs` still runs it from
    // `out/classes`, so it has to come out of this pass like the rest.
    for (const required of ['Inspect', 'StructText', 'Finish', 'Headings', 'Tables']) {
      expect(classes, `${required}.class missing`).toContain(`${required}.class`);
    }
  });
});
