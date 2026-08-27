/**
 * Builds a headless LibreOffice for the deployed function.
 *
 * `npm run vercel-build` calls this beside `prepare-jvm.ts`; `npm run build`
 * does not, for the reason that script gives at greater length — this
 * downloads ~250MB, and a local build must not start pulling a toolchain down.
 *
 * ## Why this exists at all
 *
 * The reading half of the document pipeline has been deployable since
 * `prepare-jvm.ts` landed. The *converting* half — a Word source to a tagged
 * PDF, the only path in this product that reaches a finished document with no
 * human input — ran on a laptop and nowhere else, because LibreOffice did not
 * fit inside a 250MB function. Vercel's large functions raise that to 5GB, so
 * it does now.
 *
 * ## What it produces, and why it is 440MB rather than 1GB
 *
 * The official tarball holds 42 RPMs. Installing all of them would ship Calc,
 * Impress, Draw, Base, Firebird, three dictionaries, a PDF *import* extension
 * and a MediaWiki publisher to run one `--convert-to`. `PACKAGES` below is the
 * subset `convert.ts` actually walks, and `PRUNE` removes what survives
 * selection but cannot matter to a headless conversion — help, clip art,
 * wizards.
 *
 * `libobasis-images` is deliberately **absent**: 54MB of toolbar icon themes
 * for a process that never draws a toolbar. If a conversion ever fails looking
 * for `images_*.zip`, that is the package to add back, and this comment is why
 * it is not there already.
 *
 * ## Pinned, checksummed, and verified
 *
 * Same standard as the JDK. The version is pinned because a measurement
 * against whatever shipped today cannot be compared with itself next week, and
 * because `src/integrations/documents/README.md` records the whole research
 * record as verified against the 26.2 series. The checksum is verified because
 * this executes in production and is therefore ours to reason about.
 *
 * The Document Foundation publishes a GPG signature but no `.sha256`, so the
 * hash below is one **we** computed from the pinned release file rather than
 * one they published. It detects corruption and substitution exactly as the
 * JDK's does; it is not an assertion that TDF told us this number.
 *
 * ## What the verification at the end does and does not prove
 *
 * `soffice --version` must succeed here or the build fails loudly, the same
 * gate `prepare-jvm.ts` applies with `java -version`. But **the build image and
 * the function runtime are different images.** A binary that runs here is not
 * thereby proven to run there, which is what `collectSystemLibraries` is for
 * and why only a preview deployment closes the question.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  BUNDLED_SOFFICE_DIR,
  SYSTEM_LIBRARY_DIR,
} from '../src/integrations/documents/libreoffice-runtime';

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * LibreOffice 26.2.5, official Document Foundation build, linux x86-64.
 *
 * Fetched from the **archive** host rather than `download.documentfoundation.org`,
 * and that is a deliberate correction rather than a workaround. `[V]` The
 * download host answers 302 to a randomly chosen third-party mirror —
 * `southfront.mm.fcix.net` on the attempt that produced this comment — which
 * is both unreachable from Vercel's build machine (the first build died on it
 * in 500ms) and the wrong provenance for an artifact this file pins by hash.
 * The archive serves the same bytes from TDF itself: `[V]` byte-identical
 * sha256, verified against a mirror copy before switching.
 *
 * Note the four-part version in the archive's own paths.
 */
const LIBREOFFICE = {
  release: '26.2.5',
  url: 'https://downloadarchive.documentfoundation.org/libreoffice/old/26.2.5.2/rpm/x86_64/LibreOffice_26.2.5.2_Linux_x86-64_rpm.tar.gz',
  sha256: 'f62611c441ff1faa5cadb499abdbab119f5a9013eb6c0e32fc9aa65f6ff8b53d',
  /** The directory the RPMs unpack into, under `opt/`. */
  installDir: 'libreoffice26.2',
};

/**
 * `[V]` The subset that converts a `.docx` to a tagged PDF, measured at 440MB
 * installed against 1GB+ for the full set.
 *
 * Listed by exact package prefix rather than a pattern, for the reason
 * `prepare-jvm.ts` lists JVM modules explicitly: the point is what is left
 * out, and a missing piece should fail loudly at build verification rather
 * than quietly enlarge the artifact.
 */
const PACKAGES = [
  // The UNO runtime and the launcher that finds it.
  'libreoffice26.2-ure',
  'libreoffice26.2-26.2',
  // Writer, which is the only application in the chain.
  'libreoffice26.2-writer',
  'libobasis26.2-writer',
  // Everything both of those rest on.
  'libobasis26.2-core',
  // The fonts. Liberation is metric-compatible with Arial, Times New Roman and
  // Courier New, so a municipal .docx lays out as its author wrote it instead
  // of reflowing into whatever the runtime image happens to carry.
  'libobasis26.2-ooofonts',
  // Image import/export, for a document that contains figures — which is most
  // of them, and the ones whose alt text we report on.
  'libobasis26.2-graphicfilter',
  // UI resources and configuration. Headless still reads them.
  'libreoffice26.2-en-US',
  'libobasis26.2-en-US',
];

/** Survives package selection, cannot matter to a headless conversion. */
const PRUNE = [
  'help',
  'readmes',
  'share/gallery',
  'share/wizards',
  'CREDITS.fodt',
  'LICENSE',
  'LICENSE.html',
  'NOTICE',
];

/**
 * Never copied out of the build image, however `ldd` resolves them.
 *
 * These are glibc's own pieces. Carrying a copy of one alongside a runtime
 * whose loader expects another is the classic way to break every binary in the
 * image at once, and the runtime is guaranteed to have them anyway — it runs
 * Node.
 */
const NEVER_COPY = /^(ld-linux|libc|libm|libdl|libpthread|librt|libresolv|libnsl|libutil)[.-]/;

async function download(url: string, to: string, expected: string): Promise<void> {
  console.log(`fetching LibreOffice ${LIBREOFFICE.release} (linux/x86-64)`);

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    // `fetch` reports every network-level failure as the same three words and
    // hides the actual reason — DNS, TLS, refused connection — on `cause`. The
    // first build failure here read only "fetch failed", which named neither
    // the host nor the problem.
    const cause = error instanceof Error && error.cause ? `: ${String(error.cause)}` : '';
    throw new Error(`LibreOffice download could not reach ${new URL(url).host}${cause}`);
  }

  if (!response.ok) {
    throw new Error(`LibreOffice download failed: ${response.status} ${response.statusText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    throw new Error(`LibreOffice checksum mismatch: expected ${expected}, got ${actual}`);
  }

  await writeFile(to, bytes);
}

/**
 * One RPM's payload into `dest`, by whichever tool this image has.
 *
 * An RPM is a header followed by a compressed cpio archive, and there is no
 * single extractor present everywhere: `rpm2cpio` ships with rpm on the
 * Amazon Linux build image, while libarchive's `bsdtar` reads the format
 * directly and is what makes this script testable on a developer's macOS
 * machine, where `/usr/bin/tar` *is* bsdtar.
 *
 * Ordered rather than chosen, and the failure names what was missing — a build
 * that cannot extract should say so, not guess.
 */
async function extractRpm(rpm: string, dest: string): Promise<void> {
  const attempts: Array<{ bin: string; args: string[] }> = [
    // `sh -c` because this one is a pipe. `cpio -idmu` preserves directories
    // and overwrites, which matters: the packages share paths by design.
    { bin: 'sh', args: ['-c', `rpm2cpio ${JSON.stringify(rpm)} | cpio -idmu --quiet`] },
    { bin: 'bsdtar', args: ['-xf', rpm] },
    { bin: 'tar', args: ['-xf', rpm] },
  ];

  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      await execFileAsync(attempt.bin, attempt.args, { cwd: dest, maxBuffer: 16 * 1024 * 1024 });
      return;
    } catch (error) {
      failures.push(`${attempt.bin}: ${String(error).split('\n')[0]}`);
    }
  }

  throw new Error(
    `cannot extract ${rpm} — no working extractor on this image.\n  ${failures.join('\n  ')}`,
  );
}

/**
 * The shared libraries LibreOffice needs that its own tree does not carry.
 *
 * This is the `@sparticuz/chromium` move, and it is what makes the artifact
 * survive the trip from the build image to the function runtime. Both are
 * Amazon Linux 2023, so a library copied from one is ABI-compatible with the
 * other — but "both are Amazon Linux" is not "both have libXinerama", and a
 * headless LibreOffice still links X11, fontconfig, cups and dbus.
 *
 * Copied to a directory that goes on `LD_LIBRARY_PATH` **after** the system's
 * own, so a runtime that has these uses its own and ours only fill gaps.
 *
 * Returns the count. On macOS there is no `ldd` and nothing to collect, which
 * is correct: a developer machine runs its own LibreOffice.
 */
async function collectSystemLibraries(install: string): Promise<number> {
  const target = join(install, SYSTEM_LIBRARY_DIR);
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('ldd', [join(install, 'program', 'soffice.bin')], {
      maxBuffer: 8 * 1024 * 1024,
    }));
  } catch {
    console.log('no ldd on this platform — skipping system library collection');
    return 0;
  }

  await mkdir(target, { recursive: true });
  let copied = 0;
  for (const line of stdout.split('\n')) {
    // `libfoo.so.1 => /usr/lib64/libfoo.so.1 (0x00007f…)`. Anything without a
    // `=>` is the vdso or the loader itself.
    const match = /^\s*(\S+)\s+=>\s+(\/\S+)/.exec(line);
    if (!match) continue;

    const [, soname, path] = match;
    if (!soname || !path) continue;
    if (NEVER_COPY.test(soname)) continue;
    // Already ours: `program/` is where LibreOffice keeps its own.
    if (path.startsWith(install)) continue;

    try {
      await copyFile(path, join(target, soname));
      copied += 1;
    } catch {
      // A library that cannot be read is one the runtime will have to supply.
      // Not fatal here; the preview deployment is what finds out.
    }
  }

  return copied;
}

async function main(): Promise<void> {
  const install = join(ROOT, BUNDLED_SOFFICE_DIR);

  // The artifact is linux/x86-64, and the bundled install *wins* resolution by
  // design. Unpacking it on a developer's machine would therefore put a
  // binary that cannot execute ahead of the working host LibreOffice, and
  // `npm run test:documents` would start failing for a reason nothing on
  // screen explains. Refusing here is cheaper than that afternoon.
  if (process.platform !== 'linux') {
    console.log(`skipping LibreOffice: the bundled build is linux-only, this is ${process.platform}`);
    return;
  }

  if (existsSync(join(install, 'program', 'soffice'))) {
    console.log('bundled LibreOffice already present');
    return;
  }

  const work = await mkdtemp(join(tmpdir(), 'ada-libreoffice-'));
  try {
    const tarball = join(work, 'libreoffice.tar.gz');
    await download(LIBREOFFICE.url, tarball, LIBREOFFICE.sha256);

    const unpacked = join(work, 'tarball');
    await mkdir(unpacked, { recursive: true });
    await execFileAsync('tar', ['-xzf', tarball, '-C', unpacked, '--strip-components=1']);

    const rpmDir = join(unpacked, 'RPMS');
    const available = await readdir(rpmDir);

    console.log(`installing ${PACKAGES.length} of ${available.length} packages`);
    const staged = join(work, 'staged');
    await mkdir(staged, { recursive: true });

    for (const pkg of PACKAGES) {
      const file = available.find((name) => name.startsWith(`${pkg}`));
      if (!file) {
        // Loudly, because the selection is version-sensitive: a renamed
        // package must not silently produce a LibreOffice missing Writer.
        throw new Error(`package ${pkg} is not in this tarball — the selection needs updating`);
      }
      await extractRpm(join(rpmDir, file), staged);
    }

    const payload = join(staged, 'opt', LIBREOFFICE.installDir);
    if (!existsSync(join(payload, 'program', 'soffice'))) {
      throw new Error(`extraction produced no soffice at ${payload}`);
    }

    for (const path of PRUNE) {
      await rm(join(payload, path), { recursive: true, force: true });
    }

    // LibreOffice computes its own install path from argv0, so it runs from
    // any prefix — which is what lets this live under `vendor/` beside the JRE
    // rather than at the `/opt` path the RPMs assume.
    await rm(install, { recursive: true, force: true });
    await mkdir(dirname(install), { recursive: true });
    await rename(payload, install);

    const libraries = await collectSystemLibraries(install);
    if (libraries > 0) {
      console.log(`collected ${libraries} system libraries`);
    }

    // Prove the artifact runs before the build moves on. This is the build
    // image, not the runtime — see the header.
    let version = '';
    try {
      const { stdout } = await execFileAsync(join(install, 'program', 'soffice'), ['--version'], {
        timeout: 120_000,
        env: {
          ...process.env,
          HOME: work,
          LD_LIBRARY_PATH: [process.env.LD_LIBRARY_PATH, join(install, SYSTEM_LIBRARY_DIR)]
            .filter(Boolean)
            .join(':'),
        },
      });
      version = stdout.trim().split('\n')[0] ?? '';
    } catch (error) {
      throw new Error(`the installed LibreOffice does not run: ${String(error).split('\n')[0]}`);
    }

    console.log(`bundled LibreOffice ready at ${BUNDLED_SOFFICE_DIR} — ${version}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
