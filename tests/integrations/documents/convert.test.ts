import { describe, expect, it } from 'vitest';

import { convertSourceToPdf } from '../../../src/integrations/documents/convert';
import type { StageExecutor } from '../../../src/integrations/documents/stage';
import { credentialEnvKey } from '../../../src/domain/credential-ref';

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

  it('hands LibreOffice no database URL, blob token or client credential', async () => {
    // LibreOffice parses a document fetched from a third-party server: the
    // caller is authenticated, the bytes are not. Asserted on the bundled
    // branch because that is the deployed one, where these variables are real.
    let seen: Record<string, string | undefined> | undefined;
    await convertSourceToPdf('in.docx', 'out.pdf', {
      runtime: {
        available: true,
        sofficeBin: '/nonexistent/soffice',
        libraryPath: '/bundle/.syslibs',
      },
      env: {
        PATH: '/usr/bin',
        DATABASE_URL: 'postgres://user:hunter2@db.example/main',
        BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_XXXX',
        [credentialEnvKey('acme', 'pass')]: 'the-client-website-password',
      },
      executor: async (_bin, _args, options) => {
        seen = options.env;
        return { stdout: '', stderr: '' };
      },
    });

    expect(seen).not.toHaveProperty('DATABASE_URL');
    expect(seen).not.toHaveProperty('BLOB_READ_WRITE_TOKEN');
    expect(seen).not.toHaveProperty(credentialEnvKey('acme', 'pass'));
    expect(JSON.stringify(seen)).not.toContain('hunter2');
    // …while what it needs survives.
    expect(seen?.PATH).toBe('/usr/bin');
  });
});
