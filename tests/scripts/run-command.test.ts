import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_BUFFER,
  MAX_CHARS,
  MAX_LINES,
  describeExecFailure,
  execFailureStatus,
  run,
  type CommandEnv,
  type CommandExecutor,
} from '../../scripts/run-command';

/**
 * The incident, as an object.
 *
 * `[V]` Vercel run 34002062130. `jlink --strip-debug` execs `objcopy`; the
 * build image had no `binutils`; **jlink wrote the reason to STDOUT** and
 * `promisify(execFile)` built its rejection from the command line alone. The
 * whole of the build log was the two lines this error's `message` carries.
 *
 * Any handler that reads `stderr` only — which is what the good handler in
 * `prepare-libreoffice.ts` did, and what this module generalises — discards
 * this failure just as completely as one that reads neither stream.
 */
const jlinkWithoutObjcopy = () =>
  Object.assign(
    new Error(
      'Command failed: /tmp/ada-jdk-XXXX/jdk/bin/jlink --add-modules java.base,… --output /work/vendor/jre\n',
    ),
    {
      code: 1,
      stdout:
        'Error: java.io.IOException: Cannot run program "objcopy": error=2, No such file or directory\n',
      stderr: '',
    },
  );

/** Records what it was asked to spawn, and optionally refuses. */
function recordingExecutor(failure?: unknown) {
  const calls: Array<{
    bin: string;
    args: string[];
    options: { cwd?: string; env?: CommandEnv; timeout?: number; maxBuffer: number };
  }> = [];

  const executor: CommandExecutor = async (bin, args, options) => {
    calls.push({ bin, args, options });
    if (failure !== undefined) throw failure;
    return { stdout: 'ok', stderr: '' };
  };

  return { calls, executor };
}

async function messageFrom(failure: unknown, options: Parameters<typeof run>[3] = {}) {
  const { executor } = recordingExecutor(failure);
  try {
    await run('assembling the minimal runtime', 'jlink', ['--add-modules', 'java.base'], {
      ...options,
      executor,
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('run() resolved where it should have thrown');
}

describe('describeExecFailure', () => {
  it('reports a failure the child wrote to stdout — the jlink incident', async () => {
    const message = await messageFrom(jlinkWithoutObjcopy());

    expect(message).toContain('objcopy');
    expect(message).toContain('Cannot run program');
    // The whole of the old build log was this sentence. If it is all that
    // survives, nothing has been fixed.
    expect(message).not.toContain('Command failed:');
    expect(message).toContain('assembling the minimal runtime (exit 1)');
  });

  it('reports a failure the child wrote to stderr, unlabelled', () => {
    // The case the good handler in prepare-libreoffice.ts already covered.
    // Generalising it must not have changed what it says.
    const detail = describeExecFailure({
      code: 127,
      stdout: '',
      stderr: 'oosplash: error while loading shared libraries: libXinerama.so.1',
    });

    expect(detail).toBe('oosplash: error while loading shared libraries: libXinerama.so.1');
    expect(detail).not.toContain('stderr:');
  });

  it('reports both streams when both spoke, stdout first and each labelled', () => {
    const detail = describeExecFailure({
      code: 1,
      stdout: 'progress\nCannot run program "objcopy"',
      stderr: 'a warning',
    });

    expect(detail.indexOf('stdout:')).toBe(0);
    expect(detail.indexOf('stdout:')).toBeLessThan(detail.indexOf('stderr:'));
    expect(detail).toContain('  Cannot run program "objcopy"');
    expect(detail).toContain('  a warning');
  });

  it('falls back to the message when neither stream spoke', () => {
    // ENOENT and maxBuffer are both invented by Node, not by the child: the
    // reason exists only on `message`.
    expect(
      describeExecFailure(Object.assign(new Error('spawn jlink ENOENT'), { stdout: '', stderr: '' })),
    ).toBe('spawn jlink ENOENT');
  });

  it('never returns empty and never throws, whatever it is handed', () => {
    for (const thrown of ['boom', undefined, null, new Error(''), 42, Symbol('s')]) {
      const detail = describeExecFailure(thrown);
      expect(typeof detail).toBe('string');
      expect(detail.length).toBeGreaterThan(0);
    }

    expect(describeExecFailure('boom')).toBe('boom');
  });

  it('survives an object whose stdout getter throws', () => {
    const hostile = {
      code: 1,
      get stdout(): string {
        throw new Error('nope');
      },
      stderr: 'the real reason',
    };

    expect(describeExecFailure(hostile)).toBe('the real reason');
  });

  it('keeps the head and the tail of a long stream', () => {
    // Head because a Java exception names its cause on line 1; tail because
    // `javac` puts `42 errors` last.
    const stdout = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join('\n');
    const lines = describeExecFailure({ stdout, stderr: '' }).split('\n');

    expect(lines.length).toBeLessThanOrEqual(MAX_LINES + 1);
    expect(lines).toContain('line 1');
    expect(lines).toContain('line 500');
    expect(lines.join('\n')).toContain('lines omitted');
  });

  it('cuts a single enormous line by characters, which a line budget cannot', () => {
    const detail = describeExecFailure({ stdout: 'x'.repeat(20_000), stderr: '' });

    expect(detail.length).toBeLessThan(20_000);
    expect(detail).toContain(`truncated at ${MAX_CHARS} characters`);
  });

  it('truncates each stream separately', () => {
    const detail = describeExecFailure({
      stdout: 'x'.repeat(20_000),
      stderr: 'y'.repeat(20_000),
    });

    expect(detail).toContain('stdout:');
    expect(detail).toContain('stderr:');
    // Both were cut; neither swallowed the other's budget.
    expect(detail.split(`truncated at ${MAX_CHARS} characters`).length - 1).toBe(2);
  });
});

describe('execFailureStatus', () => {
  it('says a missing program differently from a program that ran and refused', () => {
    const absent = execFailureStatus({ code: 'ENOENT', stdout: '', stderr: '' });
    const refused = execFailureStatus({ code: 1, stdout: '', stderr: '' });

    // Different fixes: one is a package for the build image, the other is the
    // input. A status that reads the same for both sends the reader to the
    // wrong file.
    expect(absent).not.toBe(refused);
    expect(absent).toContain('PATH');
    expect(refused).toBe('exit 1');
  });

  it('names the buffer, not the tool, when maxBuffer overflows', () => {
    // Node KILLS the child to enforce maxBuffer, so this arrives carrying
    // `killed: true` and looking exactly like a timeout.
    const status = execFailureStatus(
      Object.assign(new Error('stdout maxBuffer length exceeded'), {
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        killed: true,
        signal: 'SIGTERM',
      }),
      60_000,
    );

    expect(status).toContain('maxBuffer');
    expect(status).not.toContain('timed out');
  });
});

describe('run', () => {
  it('says a program is not on PATH rather than blaming the tool', async () => {
    const message = await messageFrom(
      Object.assign(new Error('spawn jlink ENOENT'), { code: 'ENOENT', stdout: '', stderr: '' }),
    );

    expect(message).toContain('not on PATH');
    expect(message).toContain('spawn jlink ENOENT');
    expect(message).not.toContain('exit ');
  });

  it('says it timed out and still carries whatever the child managed to print', async () => {
    const message = await messageFrom(
      Object.assign(new Error('Command failed: soffice --version'), {
        code: null,
        signal: 'SIGTERM',
        killed: true,
        stdout: 'LibreOffice 26.2.5.2 <partial>',
        stderr: '',
      }),
      { timeout: 120_000 },
    );

    expect(message).toContain('timed out after 120000ms');
    expect(message).toContain('<partial>');
  });

  it('reports a maxBuffer overflow as a buffer problem', async () => {
    const message = await messageFrom(
      Object.assign(new Error('stdout maxBuffer length exceeded'), {
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        killed: true,
        stdout: '',
        stderr: '',
      }),
    );

    expect(message).toContain('maxBuffer');
    expect(message).toContain('stdout maxBuffer length exceeded');
  });

  it('prints the argv so the reader can run it, and never the environment', async () => {
    const message = await messageFrom(jlinkWithoutObjcopy(), {
      env: { PATH: '/usr/bin', VERCEL_TOKEN: 'sekrit-do-not-log' },
    });

    expect(message).toContain('$ jlink --add-modules java.base');
    // On the deploy runner the environment holds VERCEL_TOKEN. A build log is
    // not where anyone should find that out.
    expect(message).not.toContain('sekrit-do-not-log');
    expect(message).not.toContain('VERCEL_TOKEN');
  });

  it('passes arguments as an array, so nothing reaches a shell', async () => {
    const { calls, executor } = recordingExecutor();
    const hostile = 'a b; rm -rf /.pdf';

    await run('reading a document', 'qpdf', ['--json=2', hostile], { executor });

    expect(calls[0]?.bin).toBe('qpdf');
    // One element, still. `execFile` with an array is what guarantees a file
    // name taken off a client's website cannot become shell syntax.
    expect(calls[0]?.args).toEqual(['--json=2', hostile]);
    expect(calls[0]?.args[1]).toBe(hostile);
  });

  it('defaults maxBuffer above the 1MB Node uses, and lets a chatty tool raise it', async () => {
    const { calls, executor } = recordingExecutor();

    await run('unpacking the JDK', 'tar', ['-xzf', 'jdk.tar.gz'], { executor });
    await run('extract with cpio', 'sh', ['-c', 'rpm2cpio x | cpio -idmu'], {
      executor,
      maxBuffer: 16 * 1024 * 1024,
    });

    // Node's own default is 1MB, and overflowing it destroys exactly the
    // output this module exists to preserve.
    expect(calls[0]?.options.maxBuffer).toBe(DEFAULT_MAX_BUFFER);
    expect(DEFAULT_MAX_BUFFER).toBeGreaterThan(1024 * 1024);
    expect(calls[1]?.options.maxBuffer).toBe(16 * 1024 * 1024);
  });

  it('leaves an unset option unset rather than passing an explicit undefined', async () => {
    const { calls, executor } = recordingExecutor();

    await run('java -version', 'java', ['-version'], { executor });

    expect('timeout' in (calls[0]?.options ?? {})).toBe(false);
    expect('cwd' in (calls[0]?.options ?? {})).toBe(false);
    expect('env' in (calls[0]?.options ?? {})).toBe(false);
  });

  it('returns both streams on success', async () => {
    const executor: CommandExecutor = async () => ({ stdout: 'out', stderr: 'err' });

    await expect(run('anything', 'tool', [], { executor })).resolves.toEqual({
      stdout: 'out',
      stderr: 'err',
    });
  });

  it('does not become a second failure when something throws a bare string', async () => {
    const message = await messageFrom('boom');

    expect(message).toContain('assembling the minimal runtime');
    expect(message).toContain('boom');
  });
});
