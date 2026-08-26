import { describe, expect, it } from 'vitest';

import { convertSourceToPdf } from '../../../src/integrations/documents/convert';
import { resolveLibreOffice } from '../../../src/integrations/documents/libreoffice-runtime';
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
});

describe('resolveLibreOffice', () => {
  it('is unavailable with no SOFFICE_PATH and an empty PATH', () => {
    const runtime = resolveLibreOffice({ env: { PATH: '' } });

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
    const runtime = resolveLibreOffice({ env: { SOFFICE_PATH: '/nope/nowhere', PATH: '' } });

    if (!runtime.available) {
      expect(runtime.reason).toMatch(/LibreOffice not found/);
    } else {
      expect(runtime.sofficeBin).not.toBe('/nope/nowhere');
    }
  });
});
