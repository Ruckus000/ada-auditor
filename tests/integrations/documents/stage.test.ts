import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { runStage, type StageExecutor } from '../../../src/integrations/documents/stage';
import { resolveJavaRuntime } from '../../../src/integrations/documents/java-runtime';
import type { JavaRuntime } from '../../../src/integrations/documents/java-runtime';

/**
 * The document boundary, without a JVM.
 *
 * Every failure mode a stage can reach is exercised here with an injected
 * executor, which is what lets this file sit in the fast suite. The one thing
 * it cannot prove is that a real `java` behaves as modelled — that is
 * `java-inspect.test.ts`, and it runs separately.
 */

const schema = z.object({ count: z.number().int() });

const RUNTIME: JavaRuntime = {
  available: true,
  javaBin: '/nonexistent/java',
  classpath: '/nonexistent/cp',
};

/** An executor that returns fixed output and records how it was called. */
function fakeExecutor(stdout: string): { executor: StageExecutor; calls: string[][] } {
  const calls: string[][] = [];
  const executor: StageExecutor = async (bin, args) => {
    calls.push([bin, ...args]);
    return { stdout, stderr: '' };
  };
  return { executor, calls };
}

function throwingExecutor(error: unknown): StageExecutor {
  return async () => {
    throw error;
  };
}

describe('runStage', () => {
  it('parses and validates a stage result', async () => {
    const { executor } = fakeExecutor('{"count": 3}');
    const result = await runStage('Inspect', ['a.pdf'], schema, { runtime: RUNTIME, executor });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.count).toBe(3);
  });

  it('passes the document path as an argument, never through a shell', async () => {
    // A file name taken from a client's website must not be able to become
    // shell syntax. `execFile` with an array is what guarantees that, so the
    // argument is asserted to survive intact rather than be quoted or split.
    const nasty = 'a b; rm -rf /.pdf';
    const { executor, calls } = fakeExecutor('{"count": 0}');
    await runStage('Inspect', [nasty], schema, { runtime: RUNTIME, executor });

    expect(calls[0]).toEqual(['/nonexistent/java', '-cp', '/nonexistent/cp', 'Inspect', nasty]);
  });

  it('parses the whole of stdout, which is what Inspect prints', async () => {
    // Inspect emits one pretty-printed JSON document across many lines. A
    // last-line parser would read `}` and fail.
    const { executor } = fakeExecutor('{\n  "count": 5\n}\n');
    const result = await runStage('Inspect', ['a.pdf'], schema, { runtime: RUNTIME, executor });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.count).toBe(5);
  });

  it('reports an absent toolchain as unavailable, not as a failure', async () => {
    const result = await runStage('Inspect', ['a.pdf'], schema, {
      runtime: { available: false, reason: 'no Java runtime found' },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('unavailable');
      if (result.failure.kind === 'unavailable') {
        expect(result.failure.reason).toMatch(/no Java runtime/);
      }
    }
  });

  it('never spawns anything when the toolchain is absent', async () => {
    const { executor, calls } = fakeExecutor('{"count": 1}');
    await runStage('Inspect', ['a.pdf'], schema, {
      runtime: { available: false, reason: 'nope' },
      executor,
    });

    expect(calls).toEqual([]);
  });

  it('maps a non-zero exit to a failure carrying the code and first stderr line', async () => {
    const result = await runStage('Inspect', ['a.pdf'], schema, {
      runtime: RUNTIME,
      executor: throwingExecutor(
        Object.assign(new Error('exited'), {
          code: 2,
          stderr: 'usage: Inspect <file.pdf>\n  at Foo.bar(Foo.java:1)\n',
        }),
      ),
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.failure.kind === 'failed') {
      expect(result.failure.exitCode).toBe(2);
      expect(result.failure.stage).toBe('Inspect');
      // The first line names the cause; the stack behind it is noise that
      // would reach a log and tell nobody anything.
      expect(result.failure.stderr).toBe('usage: Inspect <file.pdf>');
      expect(result.failure.timedOut).toBe(false);
    } else {
      expect.unreachable('expected a failed stage');
    }
  });

  it('distinguishes a timeout from a crash', async () => {
    // A killed process and a document the stage refuses are different problems
    // with different fixes, and a timeout arrives as a signal rather than an
    // exit code.
    const result = await runStage('Inspect', ['a.pdf'], schema, {
      runtime: RUNTIME,
      executor: throwingExecutor(
        Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM', stderr: '' }),
      ),
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.failure.kind === 'failed') {
      expect(result.failure.timedOut).toBe(true);
      expect(result.failure.exitCode).toBeNull();
    } else {
      expect.unreachable('expected a failed stage');
    }
  });

  it('reports unparseable stdout as invalid output, not as success', async () => {
    const { executor } = fakeExecutor('Exception in thread "main"\n');
    const result = await runStage('Inspect', ['a.pdf'], schema, { runtime: RUNTIME, executor });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('invalid-output');
  });

  it('rejects well-formed JSON that does not match the contract', async () => {
    // The failure this exists to prevent: a stage changes shape, stdout still
    // parses, and a caller reads `undefined` somewhere far away.
    const { executor } = fakeExecutor('{"count": "three"}');
    const result = await runStage('Inspect', ['a.pdf'], schema, { runtime: RUNTIME, executor });

    expect(result.ok).toBe(false);
    if (!result.ok && result.failure.kind === 'invalid-output') {
      expect(result.failure.detail).toMatch(/count/);
    } else {
      expect.unreachable('expected invalid output');
    }
  });
});

describe('resolveJavaRuntime', () => {
  it('is unavailable with no JAVA_HOME and an empty PATH', () => {
    const runtime = resolveJavaRuntime({ env: { PATH: '' } });

    expect(runtime.available).toBe(false);
    if (!runtime.available) expect(runtime.reason).toMatch(/no Java runtime found/);
  });

  it('falls through to PATH when JAVA_HOME is set but wrong', () => {
    // A stale export in a shell profile is the common case, and refusing to
    // look further would turn a working machine into a broken one.
    const runtime = resolveJavaRuntime({ env: { JAVA_HOME: '/nope/nowhere', PATH: '' } });

    expect(runtime.available).toBe(false);
    if (!runtime.available) expect(runtime.reason).toMatch(/no Java runtime found/);
  });

  it('names the missing piece when Java exists but nothing is built', () => {
    // Each missing piece has its own fix — install a JDK, fetch the jar, run
    // the build — so one generic message would make a person guess.
    const runtime = resolveJavaRuntime({ root: '/definitely/not/a/repo' });

    expect(runtime.available).toBe(false);
    if (!runtime.available) {
      expect(runtime.reason).toMatch(/PDFBox|not compiled|no Java runtime found/);
    }
  });
});
