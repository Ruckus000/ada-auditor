import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveLibreOffice } from '../../../src/integrations/documents/libreoffice-runtime';

/**
 * The capability check, against fabricated installs.
 *
 * No LibreOffice is involved and none is needed: what is under test is whether
 * a *directory shaped like* a LibreOffice install is read correctly, and CI has
 * no LibreOffice at all — so a test that needed one would be a test that never
 * ran where it matters. The real converter is covered by
 * `tests/integrations/documents/toolchain/soffice-convert.test.ts`, which skips
 * itself when the toolchain is absent.
 *
 * The install this imitates is real: `libreoffice-core` on Ubuntu 24.04 ships
 * `soffice` and `libmergedlo.so` and no Writer module, and on such a machine
 * every conversion fails at exit 0.
 */

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * A LibreOffice install with exactly the modules named.
 *
 * Returns the launcher's path, because that is what `SOFFICE_PATH` names and
 * what the check has to reason outwards from.
 */
async function install(modules: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ada-lo-'));
  dirs.push(root);

  const program = join(root, 'program');
  await mkdir(program, { recursive: true });
  await writeFile(join(program, 'soffice'), '#!/bin/sh\n', 'utf8');
  await Promise.all(modules.map((name) => writeFile(join(program, name), '', 'utf8')));

  return join(program, 'soffice');
}

/**
 * A macOS bundle that cannot exist.
 *
 * Passed everywhere, because `MACOS_BUNDLE` is the one place the resolver looks
 * that no `env` can reach: on a Mac with LibreOffice installed the fallback
 * answers `available: true` for the machine, and a test asking what happens
 * when there is no install anywhere gets the honest answer to a different
 * question. The same move `stage.test.ts` makes with
 * `resolveJavaRuntime({ root: '/definitely/not/a/repo' })`.
 */
const NO_BUNDLE = join(tmpdir(), 'ada-lo-no-such-bundle', 'soffice');

/**
 * A repo root carrying no bundled install, for the same reason `NO_BUNDLE`
 * exists: `vendor/libreoffice` is searched before everything else and defaults
 * to `process.cwd()`, so once anyone runs `npm run vercel-build` the working
 * tree answers for every case below.
 */
const NO_ROOT = join(tmpdir(), 'ada-lo-no-such-root');

/** Nothing else on the machine may answer for the install under test. */
const only = (sofficeBin: string) => ({
  env: { SOFFICE_PATH: sofficeBin, PATH: '' },
  macosBundle: NO_BUNDLE,
  root: NO_ROOT,
});

/**
 * A bundled install as `scripts/prepare-libreoffice.ts` leaves it: under
 * `vendor/libreoffice` inside the repo root, not on PATH and not named by any
 * variable.
 */
async function bundle(modules: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ada-lo-root-'));
  dirs.push(root);

  const program = join(root, 'vendor', 'libreoffice', 'program');
  await mkdir(program, { recursive: true });
  await writeFile(join(program, 'soffice'), '#!/bin/sh\n', 'utf8');
  await Promise.all(modules.map((name) => writeFile(join(program, name), '', 'utf8')));

  return root;
}

describe('resolveLibreOffice', () => {
  it('accepts an install that carries the Writer module', async () => {
    const sofficeBin = await install(['libmergedlo.so', 'libswlo.so', 'libswuilo.so']);

    expect(resolveLibreOffice(only(sofficeBin))).toEqual({ available: true, sofficeBin });
  });

  /**
   * The defect this check exists for. `libreoffice-core` alone passes every
   * test the old resolver ran — the binary is there, `--version` prints — and
   * cannot open a document of any kind.
   */
  it('refuses a core-only install, and names the package to install', async () => {
    const sofficeBin = await install(['libmergedlo.so', 'libacclo.so']);

    const runtime = resolveLibreOffice(only(sofficeBin));

    expect(runtime.available).toBe(false);
    if (runtime.available) return;
    expect(runtime.reason).toContain('Writer module');
    expect(runtime.reason).toContain('libreoffice-writer');
    // The path, so an operator with two installs knows which one was judged.
    expect(runtime.reason).toContain(sofficeBin);
  });

  /**
   * Absence of evidence is not evidence of absence. An unfamiliar layout —
   * a snap, a flatpak, a build that keeps its modules somewhere else — must
   * not turn a working host into a broken one, because the cost of a false
   * negative here is a converter that refuses work it could have done, and
   * `convert.ts` verifies its own output either way.
   */
  it('reports available when it cannot recognise the layout at all', async () => {
    const sofficeBin = await install([]);

    expect(resolveLibreOffice(only(sofficeBin))).toEqual({ available: true, sofficeBin });
  });

  it('finds Writer in a macOS bundle, where modules sit beside MacOS rather than in it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ada-lo-app-'));
    dirs.push(root);

    const contents = join(root, 'LibreOffice.app', 'Contents');
    await mkdir(join(contents, 'MacOS'), { recursive: true });
    await mkdir(join(contents, 'Frameworks'), { recursive: true });
    await writeFile(join(contents, 'MacOS', 'soffice'), '', 'utf8');
    await writeFile(join(contents, 'Frameworks', 'libmergedlo.dylib'), '', 'utf8');
    await writeFile(join(contents, 'Frameworks', 'libswlo.dylib'), '', 'utf8');

    const sofficeBin = join(contents, 'MacOS', 'soffice');
    expect(resolveLibreOffice(only(sofficeBin))).toEqual({ available: true, sofficeBin });
  });

  it('refuses a core-only macOS bundle too', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ada-lo-app-'));
    dirs.push(root);

    const contents = join(root, 'LibreOffice.app', 'Contents');
    await mkdir(join(contents, 'MacOS'), { recursive: true });
    await mkdir(join(contents, 'Frameworks'), { recursive: true });
    await writeFile(join(contents, 'MacOS', 'soffice'), '', 'utf8');
    await writeFile(join(contents, 'Frameworks', 'libmergedlo.dylib'), '', 'utf8');

    expect(resolveLibreOffice(only(join(contents, 'MacOS', 'soffice'))).available).toBe(false);
  });

  /**
   * A broken install earlier on PATH must not hide a working one later. The
   * first *working* LibreOffice wins, not the first LibreOffice.
   */
  it('keeps looking along PATH past a core-only install', async () => {
    const broken = await install(['libmergedlo.so']);
    const working = await install(['libmergedlo.so', 'libswlo.so']);

    const runtime = resolveLibreOffice({
      env: { PATH: [broken, working].map((bin) => bin.replace(/\/soffice$/, '')).join(':') },
      macosBundle: NO_BUNDLE,
    });

    expect(runtime).toEqual({ available: true, sofficeBin: working });
  });

  it('reports the core-only reason when PATH holds nothing better', async () => {
    const broken = await install(['libmergedlo.so']);

    const runtime = resolveLibreOffice({
      env: { PATH: broken.replace(/\/soffice$/, '') },
      macosBundle: NO_BUNDLE,
    });

    expect(runtime.available).toBe(false);
    if (runtime.available) return;
    expect(runtime.reason).toContain('Writer module');
  });

  /**
   * `SOFFICE_PATH` is an operator naming one install. A core-only one is
   * reported as such rather than silently swapped for another on PATH —
   * converting with a LibreOffice nobody chose is the worse outcome.
   */
  it('does not fall through from a configured core-only install to a working one', async () => {
    const configured = await install(['libmergedlo.so']);
    const working = await install(['libmergedlo.so', 'libswlo.so']);

    const runtime = resolveLibreOffice({
      env: {
        SOFFICE_PATH: configured,
        PATH: working.replace(/\/soffice$/, ''),
      },
      macosBundle: NO_BUNDLE,
    });

    expect(runtime.available).toBe(false);
  });

  it('still falls through when SOFFICE_PATH points at nothing, which is a stale export', async () => {
    const working = await install(['libmergedlo.so', 'libswlo.so']);

    const runtime = resolveLibreOffice({
      env: {
        SOFFICE_PATH: join(tmpdir(), 'ada-lo-does-not-exist', 'soffice'),
        PATH: working.replace(/\/soffice$/, ''),
      },
      macosBundle: NO_BUNDLE,
    });

    expect(runtime).toEqual({ available: true, sofficeBin: working });
  });

  /**
   * The ordinary Linux shape, and a trap worth a test: `/usr/bin/soffice` is a
   * symlink into `/usr/lib/libreoffice/program`, so the modules sit beside the
   * link's *target* and not beside the link. A first attempt at reproducing a
   * core-only install got this backwards — the fake launcher was a symlink to
   * the real one, `realpath` followed it home, and the check cheerfully read
   * the working install's modules.
   */
  it('looks beside the launcher it resolves to, not beside the symlink', async () => {
    const real = await install(['libmergedlo.so', 'libswlo.so']);
    const linkRoot = await mkdtemp(join(tmpdir(), 'ada-lo-bin-'));
    dirs.push(linkRoot);

    const link = join(linkRoot, 'soffice');
    await symlink(real, link);

    expect(resolveLibreOffice(only(link))).toEqual({ available: true, sofficeBin: link });
  });

  it('refuses through a symlink when the target is core-only', async () => {
    const real = await install(['libmergedlo.so']);
    const linkRoot = await mkdtemp(join(tmpdir(), 'ada-lo-bin-'));
    dirs.push(linkRoot);

    const link = join(linkRoot, 'soffice');
    await symlink(real, link);

    expect(resolveLibreOffice(only(link)).available).toBe(false);
  });

  it('says LibreOffice is missing when there is no install anywhere', () => {
    const runtime = resolveLibreOffice({
      env: { PATH: join(tmpdir(), 'ada-lo-empty') },
      macosBundle: NO_BUNDLE,
      root: NO_ROOT,
    });

    expect(runtime.available).toBe(false);
    if (runtime.available) return;
    expect(runtime.reason).toContain('LibreOffice not found');
  });

  it('prefers the bundled install over a working SOFFICE_PATH', async () => {
    // Same rule as `findJavaBinary`: if a bundled runtime is present somebody
    // put it there on purpose — a build assembled it for this deployment, and
    // it is the one whose package selection was verified against these stages.
    const root = await bundle(['libmergedlo.so', 'libswlo.so']);
    const host = await install(['libmergedlo.so', 'libswlo.so']);

    const runtime = resolveLibreOffice({
      env: { SOFFICE_PATH: host, PATH: '' },
      macosBundle: NO_BUNDLE,
      root,
    });

    expect(runtime.available && runtime.sofficeBin).toBe(
      join(root, 'vendor', 'libreoffice', 'program', 'soffice'),
    );
    // The loader hint rides with it, so a bundled install cannot be reported
    // available without the libraries collected beside it.
    expect(runtime.available && runtime.libraryPath).toBe(
      join(root, 'vendor', 'libreoffice', '.syslibs'),
    );
  });

  it('refuses a bundled install with no Writer, rather than falling through', async () => {
    // What makes the RPM selection in `prepare-libreoffice.ts` self-verifying.
    // Falling through would trade "the bundle has no Writer module" for
    // "LibreOffice not found", which names neither the cause nor the fix — and
    // on a function there is nothing to fall through to anyway.
    const root = await bundle(['libmergedlo.so']);
    const host = await install(['libmergedlo.so', 'libswlo.so']);

    const runtime = resolveLibreOffice({
      env: { SOFFICE_PATH: host, PATH: '' },
      macosBundle: NO_BUNDLE,
      root,
    });

    expect(runtime.available).toBe(false);
    if (!runtime.available) {
      expect(runtime.reason).toMatch(/no Writer module/);
      expect(runtime.reason).toContain('vendor');
    }
  });

  it('carries no library path for a host install', async () => {
    // A host LibreOffice was put there by a package manager that already
    // resolved its libraries; telling the dynamic loader otherwise could only
    // break it.
    const sofficeBin = await install(['libmergedlo.so', 'libswlo.so']);
    const runtime = resolveLibreOffice(only(sofficeBin));

    expect(runtime.available && 'libraryPath' in runtime).toBe(false);
  });
});
