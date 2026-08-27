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
 * ## Two things measured the hard way
 *
 * `[V]` **LibreOffice needs the system's NSS and ships none of its own.**
 * `libmergedlo.so` transitively needs `libssl3.so`; no RPM in the TDF tarball
 * carries it, and neither does Vercel's build image — `soffice --version`
 * died at exit 127 on exactly that. So NSS is installed below before the
 * library collection runs, and the collector refuses to finish while `ldd`
 * reports anything `not found`. The first collector silently skipped those
 * lines and reported "collected 52 system libraries" over a broken install.
 *
 * `[V]` **The launcher is a chain, and every link has its own libraries.**
 * `soffice` (script) execs `oosplash`, which execs `soffice.bin` — and the
 * first production conversion died with `oosplash: error while loading shared
 * libraries: libXinerama.so.1` after a collector that read only
 * `soffice.bin`'s dependencies had reported success. Build-image verification
 * cannot catch this class: the build image HAS the X11 libraries system-wide,
 * so the chain runs there resolved from paths the runtime does not have. The
 * collector therefore walks EVERY ELF in the bundle and unions their needs.
 *
 * `[V]` **The archive host's speed varies by an order of magnitude** — the
 * same 250MB fetch took 2.4 minutes on one build and 17.5 on another. A known
 * cost, recorded rather than engineered around: the build fits the platform
 * ceiling either way, and a second download source is complexity this does
 * not need yet.
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
import { copyFile, mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
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
/**
 * The system packages LibreOffice links but neither ships nor finds here.
 *
 * Installed with the image's own package manager so the right builds land in
 * the right places for `ldd` to resolve and the collector to copy. A failure
 * here is logged and not fatal — the collector's not-found check below is the
 * gate, and it produces the better error: the list of what is actually
 * missing, not the name of the tool that failed to install it.
 */
/**
 * What LibreOffice links that Amazon Linux's build image does not carry.
 *
 * `nss` was found by the collector's gate; the X11 set by the first
 * production conversion (`oosplash` links them even for a `--headless` run —
 * see the header). Installed one at a time so a package that stops existing
 * skips rather than failing the whole transaction; the collector's not-found
 * gate is the arbiter of whether anything is actually missing afterwards.
 */
const BUILD_IMAGE_PACKAGES = [
  'nss',
  'libX11',
  'libXext',
  'libXinerama',
  'libXrender',
  'libXrandr',
  'libXi',
  'libXtst',
  'libSM',
  'libICE',
  'cups-libs',
  'dbus-libs',
];

async function installBuildImagePackages(): Promise<void> {
  for (const manager of ['dnf', 'microdnf']) {
    try {
      await execFileAsync(manager, ['--version'], { timeout: 30_000 });
      let installed = 0;
      for (const pkg of BUILD_IMAGE_PACKAGES) {
        try {
          await execFileAsync(manager, ['install', '-y', pkg], {
            maxBuffer: 8 * 1024 * 1024,
            timeout: 180_000,
          });
          installed += 1;
        } catch {
          // Absent from the repo, or already present under another name. The
          // collector's gate is what decides whether that matters.
        }
      }
      console.log(`installed ${installed}/${BUILD_IMAGE_PACKAGES.length} packages via ${manager}`);
      return;
    } catch {
      // No such package manager here; try the next.
    }
  }
  console.log('no package manager found — the library check below will say what is missing');
}

async function collectSystemLibraries(install: string): Promise<number> {
  const target = join(install, SYSTEM_LIBRARY_DIR);
  const program = join(install, 'program');

  // Every ELF in the launch chain and beyond: `soffice` execs `oosplash`
  // execs `soffice.bin`, the UNO libraries dlopen each other, and each link
  // has its own DT_NEEDED. Reading one binary's dependencies is how the first
  // production conversion died on a library nothing had copied. ELF is
  // detected by magic bytes, not by name — `oosplash` has no extension.
  const candidates: string[] = [];
  for (const entry of await readdir(program)) {
    const path = join(program, entry);
    try {
      const header = Buffer.alloc(4);
      const file = await open(path, 'r');
      await file.read(header, 0, 4, 0);
      await file.close();
      if (header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) candidates.push(path);
    } catch {
      // Directories and unreadables are not candidates.
    }
  }

  // Names the bundle can already answer for. `ldd` on a lone library reports
  // its bundled siblings as `not found` — it does not know about the
  // LD_LIBRARY_PATH the runtime will set — so the gate must not count them.
  const bundled = new Set<string>();
  for (const dir of [program, target]) {
    try {
      for (const entry of await readdir(dir)) bundled.add(entry);
    } catch {
      // `target` may not exist yet.
    }
  }

  const resolved = new Map<string, string>();
  const missing = new Set<string>();
  let scanned = 0;
  for (const candidate of candidates) {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync('ldd', [candidate], { maxBuffer: 8 * 1024 * 1024 }));
    } catch {
      continue; // Static, an arch mismatch, or no ldd at all; nothing to read.
    }
    scanned += 1;

    for (const [, soname, path] of stdout.matchAll(/^\s*(\S+)\s+=>\s+(\/\S+)/gm)) {
      if (!soname || !path) continue;
      if (NEVER_COPY.test(soname)) continue;
      if (path.startsWith(install)) continue;
      resolved.set(soname, path);
    }
    for (const [, soname] of stdout.matchAll(/^\s*(\S+)\s+=>\s+not found/gm)) {
      if (soname && !bundled.has(soname)) missing.add(soname);
    }
  }

  if (scanned === 0) {
    console.log('no ldd on this platform — skipping system library collection');
    return 0;
  }

  // The gate. A build that ships with any of these produces a LibreOffice
  // that dies at exec on its first request — and the failure names a library,
  // not a package, so the fix is a BUILD_IMAGE_PACKAGES entry.
  if (missing.size > 0) {
    throw new Error(
      `the build image cannot resolve ${missing.size} of LibreOffice's libraries — ` +
        `nothing shippable can come out of this build.\n  ${[...missing].sort().join('\n  ')}\n` +
        `Install the packages that provide them in BUILD_IMAGE_PACKAGES.`,
    );
  }

  await mkdir(target, { recursive: true });
  let copied = 0;
  for (const [soname, path] of resolved) {
    try {
      await copyFile(path, join(target, soname));
      copied += 1;
    } catch {
      // A library that cannot be read is one the runtime will have to supply.
      // Not fatal here; the preview deployment is what finds out.
    }
  }

  console.log(`scanned ${scanned} binaries`);
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

  // Staged **inside** the repo rather than under `tmpdir()`, because the last
  // step of this script moves 440MB into place and `/tmp` is a different
  // filesystem from the build workspace: `[V]` the first build that got this
  // far died on `EXDEV: cross-device link not permitted`. `prepare-jvm.ts`
  // never meets this because `jlink` writes straight to its output directory.
  //
  // Copying instead would work anywhere and cost an extra 440MB of I/O on
  // every build; staging on the right device costs nothing.
  await mkdir(dirname(install), { recursive: true });
  const work = await mkdtemp(join(dirname(install), '.libreoffice-build-'));
  try {
    const tarball = join(work, 'libreoffice.tar.gz');
    await download(LIBREOFFICE.url, tarball, LIBREOFFICE.sha256);

    const unpacked = join(work, 'tarball');
    await mkdir(unpacked, { recursive: true });
    await execFileAsync('tar', ['-xzf', tarball, '-C', unpacked, '--strip-components=1']);
    // 250MB that nothing reads again. Peak disk here is otherwise the tarball,
    // the RPMs and the installed tree all at once.
    await rm(tarball, { force: true });

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

    await installBuildImagePackages();
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
      // `stderr`, not the first line of the error. `execFile` puts "Command
      // failed: <the command>" in the message and the *reason* — the dynamic
      // loader naming the library it could not find — in `stderr`. The first
      // version of this handler discarded it and cost a deploy cycle that
      // reported only that something had failed, which was already obvious.
      // The same mistake this file's `fetch` handler was fixed for.
      const e = error as { stderr?: string; code?: number | string };
      const reason = (e.stderr ?? '').trim() || String(error).split('\n')[0];
      throw new Error(
        `the installed LibreOffice does not run (exit ${e.code ?? '?'}):\n${reason}`,
      );
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
