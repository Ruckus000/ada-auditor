import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { convertSourceToPdf } from '../../../src/integrations/documents/convert';
import {
  BUNDLED_SOFFICE_DIR,
  resolveLibreOffice,
  SYSTEM_LIBRARY_DIR,
} from '../../../src/integrations/documents/libreoffice-runtime';
import type { StageExecutor } from '../../../src/integrations/documents/stage';

/**
 * The conversion chain's failure handling, without LibreOffice.
 *
 * The success path needs a real binary and lives in
 * `toolchain/soffice-convert.test.ts`. What is covered here is everything that
 * goes wrong — which for this tool is the interesting half, because it reports
 * success in ways that are not success.
 */

/** An executor that runs, writes nothing, and reports success. */
const silentlyProducesNothing: StageExecutor = async () => ({ stdout: '', stderr: '' });

describe('convertSourceToPdf', () => {
  it('reports an absent LibreOffice as unavailable, not as a failure', async () => {
    const result = await convertSourceToPdf('in.docx', 'out.pdf', {
      runtime: { available: false, reason: 'LibreOffice not found' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('unavailable');
      if (result.failure.kind === 'unavailable') {
        expect(result.failure.reason).toMatch(/not found/);
      }
    }
  });

  it('never starts a process when LibreOffice is absent', async () => {
    let calls = 0;
    await convertSourceToPdf('in.docx', 'out.pdf', {
      runtime: { available: false, reason: 'nope' },
      executor: async () => {
        calls += 1;
        return { stdout: '', stderr: '' };
      },
    });

    expect(calls).toBe(0);
  });

  it('catches a zero exit that produced no file', async () => {
    // THE failure mode. `soffice` exits 0 having written nothing, and this
    // project has been caught by it four times. Without the existence check
    // this call would proceed to read a file that is not there.
    const result = await convertSourceToPdf('in.docx', 'out.pdf', {
      runtime: { available: true, sofficeBin: '/nonexistent/soffice' },
      executor: silentlyProducesNothing,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('no-output');
      if (result.failure.kind === 'no-output') {
        // Named so a failure says which of the two conversions died.
        expect(result.failure.step).toBe('source-to-fodt');
      }
    }
  });

  it('runs headless and isolates the user profile', async () => {
    // A shared profile is singly-locked, so two concurrent conversions collide
    // and one silently does nothing — which combines with the exit-0 behaviour
    // into a failure that looks exactly like success.
    const args: string[][] = [];
    await convertSourceToPdf('in.docx', 'out.pdf', {
      runtime: { available: true, sofficeBin: '/nonexistent/soffice' },
      executor: async (_bin, a) => {
        args.push(a);
        return { stdout: '', stderr: '' };
      },
    });

    expect(args[0]?.[0]).toBe('--headless');
    expect(args[0]?.[1]).toMatch(/^-env:UserInstallation=file:\/\//);
  });

  it('maps a converter crash to a named step', async () => {
    const result = await convertSourceToPdf('in.docx', 'out.pdf', {
      runtime: { available: true, sofficeBin: '/nonexistent/soffice' },
      executor: async () => {
        throw Object.assign(new Error('spawn ENOENT'), { stderr: 'spawn ENOENT\n' });
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.failure.kind === 'converter-failed') {
      expect(result.failure.step).toBe('source-to-fodt');
      expect(result.failure.detail).toMatch(/ENOENT/);
    } else {
      expect.unreachable('expected a converter failure');
    }
  });

  it('gives a bundled LibreOffice a writable HOME and appends its library path', async () => {
    // `/var/task` is read-only on a deployed function, and LibreOffice writes a
    // fontconfig cache wherever its profile lives. Both of these are invisible
    // on a developer machine, where HOME is real and the loader finds
    // everything — which is exactly why they are asserted here rather than
    // discovered on a preview.
    let seen: Record<string, string | undefined> | undefined;
    await convertSourceToPdf('in.docx', 'out.pdf', {
      runtime: {
        available: true,
        sofficeBin: '/nonexistent/soffice',
        libraryPath: '/bundle/.syslibs',
      },
      env: { LD_LIBRARY_PATH: '/already/here' },
      executor: async (_bin, _args, options) => {
        seen = options.env;
        return { stdout: '', stderr: '' };
      },
    });

    // Appended, not replaced: a runtime carrying its own copy of a library
    // should keep using it.
    expect(seen?.LD_LIBRARY_PATH).toBe('/already/here:/bundle/.syslibs');
    expect(seen?.HOME).toMatch(/ada-convert-/);
  });

  it('leaves the loader alone for a host install', async () => {
    let seen: Record<string, string | undefined> | undefined;
    await convertSourceToPdf('in.docx', 'out.pdf', {
      runtime: { available: true, sofficeBin: '/usr/bin/soffice' },
      env: { LD_LIBRARY_PATH: '/already/here' },
      executor: async (_bin, _args, options) => {
        seen = options.env;
        return { stdout: '', stderr: '' };
      },
    });

    expect(seen?.LD_LIBRARY_PATH).toBe('/already/here');
    // And HOME is left alone: on a host it is already writable, and its
    // fontconfig cache is worth keeping shared rather than rebuilt per
    // conversion.
    expect(seen).not.toHaveProperty('HOME');
  });
});

/**
 * A root with nothing bundled under it.
 *
 * Passed explicitly rather than leaning on `process.cwd()`, because once
 * anyone runs `npm run vercel-build` the working tree DOES carry a bundled
 * LibreOffice and every case below would resolve to it.
 */
const roots: string[] = [];

function emptyRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ada-root-'));
  roots.push(root);
  return root;
}

/** A root carrying what `prepare-libreoffice.ts` leaves behind. */
function rootWithBundle(): string {
  const root = emptyRoot();
  const program = join(root, BUNDLED_SOFFICE_DIR, 'program');
  mkdirSync(program, { recursive: true });
  writeFileSync(join(program, 'soffice'), '#!/bin/sh\n');
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('resolveLibreOffice', () => {
  it('is unavailable with no SOFFICE_PATH and an empty PATH', () => {
    const runtime = resolveLibreOffice({ env: { PATH: '' }, root: emptyRoot() });

    // The macOS application bundle is checked last and may genuinely exist on
    // this machine, so this asserts the shape rather than the answer.
    if (!runtime.available) {
      expect(runtime.reason).toMatch(/LibreOffice not found/);
    } else {
      expect(runtime.sofficeBin).toMatch(/LibreOffice\.app/);
    }
  });

  it('falls through to PATH when SOFFICE_PATH is set but wrong', () => {
    // A stale export is the common case; refusing to look further would turn a
    // working machine into a broken one. Same rule as `JAVA_HOME`.
    const runtime = resolveLibreOffice({
      env: { SOFFICE_PATH: '/nope/nowhere', PATH: '' },
      root: emptyRoot(),
    });

    if (!runtime.available) {
      expect(runtime.reason).toMatch(/LibreOffice not found/);
    } else {
      expect(runtime.sofficeBin).not.toBe('/nope/nowhere');
    }
  });

  it('prefers the bundled install over a working SOFFICE_PATH', () => {
    // Same rule as `findJavaBinary`: if a bundled runtime is present somebody
    // put it there on purpose — a build assembled it for this deployment, and
    // it is the one whose package selection was verified against these stages.
    const root = rootWithBundle();
    const runtime = resolveLibreOffice({
      env: { SOFFICE_PATH: '/usr/bin/soffice', PATH: '/usr/bin' },
      root,
    });

    expect(runtime.available).toBe(true);
    if (runtime.available) {
      expect(runtime.sofficeBin).toBe(join(root, BUNDLED_SOFFICE_DIR, 'program', 'soffice'));
    }
  });

  it('carries a library path for the bundled install and none for a host one', () => {
    // The deployed function may lack libraries LibreOffice links; a host
    // install was put there by a package manager that already resolved them,
    // and telling the dynamic loader otherwise could only break it.
    const bundled = resolveLibreOffice({ env: { PATH: '' }, root: rootWithBundle() });
    expect(bundled.available && bundled.libraryPath).toMatch(
      new RegExp(`${SYSTEM_LIBRARY_DIR}$`),
    );

    const host = resolveLibreOffice({
      env: { SOFFICE_PATH: '/usr/bin/soffice', PATH: '' },
      root: emptyRoot(),
    });
    if (host.available) {
      expect(host.libraryPath).toBeUndefined();
    }
  });
});
