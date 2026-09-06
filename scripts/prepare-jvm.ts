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
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUNDLED_JRE_DIR, DOCUMENT_CLASSES_DIR } from '../src/integrations/documents/java-runtime';
import { run } from './run-command';

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

/**
 * External tools this script's children need, which are not this script's
 * children — so nothing on the path below fails with their name on it.
 *
 * `jlink --strip-debug` execs `objcopy` to strip the native libraries it
 * copies into the runtime, and `binutils` is not in a bare `amazonlinux:2023`.
 * `[V]` Without it jlink exits 1 having printed
 * `Cannot run program "objcopy"` to **stdout**, and run 34002062130 therefore
 * failed with no reason at all. The reading half of that is fixed in
 * `run-command.ts`; this is the other half — the tool was never checked for.
 *
 * The `ldd` gate in `prepare-libreoffice.ts` is the model: refuse while
 * something needed is unresolvable, and name the package rather than the
 * symptom. This one costs a second and runs before the 184MB download, rather
 * than three minutes later behind it.
 */
const REQUIRED_TOOLS = [
  {
    program: 'objcopy',
    reason: 'jlink --strip-debug execs objcopy, which is not on PATH.',
    fix: 'Install binutils in the build image (.github/workflows/deploy.yml).',
  },
];

/**
 * Whether a program is on `PATH`, without spawning anything.
 *
 * `which` is itself a tool that can be absent, and a preflight that needs a
 * preflight is not one. `PATH` is the only thing `execvp` consults, so reading
 * it is the same question the loader will ask.
 */
function onPath(program: string): boolean {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, program))) return true;
  }
  return false;
}

function preflight(): void {
  const missing = REQUIRED_TOOLS.filter((tool) => !onPath(tool.program));
  if (missing.length === 0) return;

  throw new Error(missing.map((tool) => `${tool.reason}\n${tool.fix}`).join('\n'));
}

async function main(): Promise<void> {
  const jreDir = join(ROOT, BUNDLED_JRE_DIR);

  if (existsSync(join(jreDir, 'bin', 'java'))) {
    // This early return skips `build-documents.ts` below as well as the JDK
    // download, and that script writes to two places — `vendor/fonts` (which
    // travels with the JRE in the deploy cache) and `dist/documents/classes`
    // (which did not, until the cache was widened to carry both). A restore
    // that brings one without the other is not a usable build: the conversion
    // routes deploy clean and then refuse every request with `document stages
    // are not compiled`, which is a runtime symptom of a build-time fault and
    // took a production probe to find.
    //
    // Refuse here instead. Recompiling is not an option on this path — javac
    // lives in the full JDK, and `vendor/jre` is a jlink'd runtime without it.
    if (!existsSync(join(ROOT, DOCUMENT_CLASSES_DIR))) {
      throw new Error(
        `${BUNDLED_JRE_DIR} was restored without ${DOCUMENT_CLASSES_DIR}. `
        + 'The build cache is carrying half of what build-documents.ts produces. '
        + 'Check the `path:` of the cache step in .github/workflows/deploy.yml — it '
        + 'must list dist/documents alongside vendor.',
      );
    }
    console.log('bundled runtime already present');
    return;
  }

  // Before the download, not after it. Everything below costs minutes.
  preflight();

  const work = await mkdtemp(join(tmpdir(), 'ada-jdk-'));
  try {
    const tarball = join(work, 'jdk.tar.gz');
    await download(JDK.url, tarball, JDK.sha256);

    const jdk = join(work, 'jdk');
    await mkdir(jdk, { recursive: true });
    await run('unpacking the JDK', 'tar', ['-xzf', tarball, '-C', jdk, '--strip-components=1']);

    // Compilation goes through the existing script rather than being repeated
    // here, pointed at the JDK we just unpacked. It also fetches PDFBox, so
    // this stays the one place that knows how to build the stages.
    console.log('compiling document stages');
    // The local binary, not `npx` — `npx` will reach the network for a package
    // it thinks is missing, and a build step that can silently fetch something
    // is not one you can reason about.
    const { stdout } = await run(
      'compiling document stages',
      join(ROOT, 'node_modules', '.bin', 'tsx'),
      [join(ROOT, 'scripts/build-documents.ts')],
      { cwd: ROOT, env: { ...process.env, JAVA_HOME: jdk } },
    );
    console.log(stdout.trim());

    console.log('assembling the minimal runtime');
    await rm(jreDir, { recursive: true, force: true });
    await run('assembling the minimal runtime', join(jdk, 'bin', 'jlink'), [
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
    const { stderr } = await run('the assembled runtime does not run', join(jreDir, 'bin', 'java'), [
      '-version',
    ]);
    const version = stderr.trim().split('\n')[0] ?? '';

    console.log(`bundled runtime ready at ${BUNDLED_JRE_DIR} — ${version}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
