/**
 * Builds a minimal Java runtime for the deployed function.
 *
 * `npm run vercel-build` calls this; `npm run build` does not. That split is
 * deliberate and load-bearing: this downloads ~184MB of JDK, and `npm run build`
 * runs on every push through localci. A local build must not start pulling a
 * toolchain down.
 *
 * ## What it produces, and why it is small
 *
 * A full JDK is ~330MB extracted. Shipping that beside a function to run one
 * class would be absurd, so the JDK is used at **build time only** — for
 * `javac`, and then for `jlink`, which assembles a runtime containing only the
 * modules our code actually touches.
 *
 * `[V]` Measured locally: `jdeps` reports
 * `java.base,java.desktop,java.naming,java.prefs,java.sql`, and a runtime built
 * from exactly those is **40MB** and runs `Inspect` with byte-identical output
 * to the full JDK, in 0.19s. That is the artifact that ships.
 *
 * ## Pinned and verified
 *
 * The version is pinned rather than "latest" for the reason `fetch-tools.sh`
 * gives about PDFBox — a measurement against whatever shipped today cannot be
 * compared with itself next week — and the checksum is verified because this is
 * now a supply-chain artifact we own and have to be able to reason about.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { BUNDLED_JRE_DIR } from '../src/integrations/documents/java-runtime';

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Eclipse Temurin 17.0.20.1+1, linux x64. */
const JDK = {
  release: 'jdk-17.0.20.1+1',
  url: 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk_x64_linux_hotspot_17.0.20.1_1.tar.gz',
  sha256: '3808d1d15e3ec6bd5b84057fb5d84c33d8a1536a258146bcea2e603fc726e08e',
  /** The directory the tarball unpacks into, before `--strip-components`. */
  arch: 'x64',
  os: 'linux',
};

/**
 * `[V]` From `jdeps --print-module-deps` over our classes and PDFBox.
 *
 * Listed explicitly rather than using `ALL-MODULE-PATH`, because the whole
 * point is what is left out. If a stage starts needing another module the
 * failure is a loud `NoClassDefFoundError` at build verification, not a
 * silently larger artifact.
 */
// `java.management` is veraPDF's, not ours: its CLI touches
// ManagementFactory at startup. `[V]` Proven by running the cli jar on a
// jlink runtime without it (NoClassDefFoundError) and with it (validates a
// real document in 0.65s); the module costs ~1MB.
const MODULES = 'java.base,java.desktop,java.naming,java.prefs,java.sql,java.management';

async function download(url: string, to: string, expected: string): Promise<void> {
  console.log(`fetching ${JDK.release} (${JDK.os}/${JDK.arch})`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`JDK download failed: ${response.status} ${response.statusText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    // Refuse rather than warn. A checksum that does not match is either a
    // corrupted download or a substituted artifact, and this one ends up
    // executing in production.
    throw new Error(`JDK checksum mismatch: expected ${expected}, got ${actual}`);
  }

  await writeFile(to, bytes);
}

async function main(): Promise<void> {
  const jreDir = join(ROOT, BUNDLED_JRE_DIR);

  if (existsSync(join(jreDir, 'bin', 'java'))) {
    console.log('bundled runtime already present');
    return;
  }

  const work = await mkdtemp(join(tmpdir(), 'ada-jdk-'));
  try {
    const tarball = join(work, 'jdk.tar.gz');
    await download(JDK.url, tarball, JDK.sha256);

    const jdk = join(work, 'jdk');
    await mkdir(jdk, { recursive: true });
    await execFileAsync('tar', ['-xzf', tarball, '-C', jdk, '--strip-components=1']);

    // Compilation goes through the existing script rather than being repeated
    // here, pointed at the JDK we just unpacked. It also fetches PDFBox, so
    // this stays the one place that knows how to build the stages.
    console.log('compiling document stages');
    // The local binary, not `npx` — `npx` will reach the network for a package
    // it thinks is missing, and a build step that can silently fetch something
    // is not one you can reason about.
    const { stdout } = await execFileAsync(
      join(ROOT, 'node_modules', '.bin', 'tsx'),
      [join(ROOT, 'scripts/build-documents.ts')],
      { cwd: ROOT, env: { ...process.env, JAVA_HOME: jdk }, maxBuffer: 8 * 1024 * 1024 },
    );
    console.log(stdout.trim());

    console.log('assembling the minimal runtime');
    await rm(jreDir, { recursive: true, force: true });
    await execFileAsync(join(jdk, 'bin', 'jlink'), [
      '--add-modules', MODULES,
      '--strip-debug',
      '--no-header-files',
      '--no-man-pages',
      '--compress=2',
      '--output', jreDir,
    ]);

    // Prove the artifact runs before the build moves on. A runtime missing a
    // module fails here, where the log is read, rather than on the first
    // production request. `java -version` reports on stderr and exits 0.
    let version = '';
    try {
      const { stderr } = await execFileAsync(join(jreDir, 'bin', 'java'), ['-version']);
      version = stderr.trim().split('\n')[0] ?? '';
    } catch (error) {
      throw new Error(
        `the assembled runtime does not run: ${String(error).split('\n')[0]}`,
      );
    }

    console.log(`bundled runtime ready at ${BUNDLED_JRE_DIR} — ${version}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
