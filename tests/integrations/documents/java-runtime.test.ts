import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { measureContrast } from '../../../src/integrations/documents/contrast';
import { inspectDocument } from '../../../src/integrations/documents/inspect';
import {
  DOCUMENT_CLASSES_DIR,
  JPX_DECODER,
  PDFBOX_JAR,
  resolveJavaRuntime,
  type JavaRuntime,
} from '../../../src/integrations/documents/java-runtime';
import { previewDocument } from '../../../src/integrations/documents/preview';
import type { StageExecutor } from '../../../src/integrations/documents/stage';

/**
 * The toolchain resolver, against fabricated trees, and the render gate the
 * stages apply to what it returns. No JVM runs; what is under test is which
 * files the resolver demands, what classpath it hands back, and which stages
 * refuse a runtime that cannot decode JPEG 2000.
 */

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const CORE = join('vendor', 'imageio', 'jai-imageio-core-1.4.0.jar');
const JPEG2000 = join('vendor', 'imageio', 'jai-imageio-jpeg2000-1.4.0.jar');

async function tree(decoders: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ada-jvm-'));
  dirs.push(root);
  for (const file of [join('jdk', 'bin', 'java'), PDFBOX_JAR, ...decoders]) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), '');
  }
  await mkdir(join(root, DOCUMENT_CLASSES_DIR), { recursive: true });
  return root;
}

function resolve(root: string): JavaRuntime {
  return resolveJavaRuntime({ root, env: { JAVA_HOME: join(root, 'jdk') } });
}

describe('resolveJavaRuntime', () => {
  it('puts the JPEG 2000 decoder on the classpath beside PDFBox and the stages', async () => {
    const root = await tree([CORE, JPEG2000]);

    const runtime = resolve(root);

    expect(runtime.available).toBe(true);
    if (!runtime.available) return;
    expect(runtime.renderGap).toBeUndefined();
    const entries = runtime.classpath.split(delimiter);
    expect(entries).toContain(join(root, 'vendor', 'pdfbox-app-3.0.8.jar'));
    expect(entries).toContain(join(root, 'dist', 'documents', 'classes'));
    expect(entries).toContain(join(root, JPEG2000));
    expect(entries).toContain(join(root, CORE));
  });

  /**
   * Only `Preview` and `Contrast` rasterise. `Inspect`, `Finish`, the archive
   * and veraPDF never decode an image, so a missing decoder leaves the runtime
   * available and says, in `renderGap`, what the rendering stages lack.
   */
  it('stays available without the decoder, and names the build that fetches it', async () => {
    const root = await tree([]);

    const runtime = resolve(root);

    expect(runtime.available).toBe(true);
    if (!runtime.available) return;
    expect(runtime.renderGap).toContain('JPEG 2000');
    expect(runtime.renderGap).toContain('npm run build:documents');
  });

  /**
   * The reader's own dependency. `[V]` Without core, ImageIO's SPI scan throws
   * ServiceConfigurationError and the stage dies before reading a page — so a
   * half-present decoder must not reach the classpath of ANY stage.
   */
  it('keeps a half-present decoder off the classpath', async () => {
    const root = await tree([JPEG2000]);

    const runtime = resolve(root);

    expect(runtime.available).toBe(true);
    if (!runtime.available) return;
    expect(runtime.renderGap).toContain(CORE);
    expect(runtime.classpath).not.toContain('jai-imageio');
  });

  it('pairs every decoder path with its own source', () => {
    for (const { path, url } of JPX_DECODER) {
      expect(url.endsWith(`/${path.split(/[\\/]/).at(-1)}`), path).toBe(true);
    }
  });
});

describe('the render gate', () => {
  // Injected, as the conversion routes inject the runtime they resolved once:
  // the gate has to hold on that path too, not only when a stage resolves.
  const GAPPED: JavaRuntime = {
    available: true,
    javaBin: '/nonexistent/java',
    classpath: '/nonexistent/cp',
    renderGap: 'the JPEG 2000 decoder is missing',
  };

  function recording(): { executor: StageExecutor; calls: string[][] } {
    const calls: string[][] = [];
    return {
      calls,
      executor: async (bin, args) => {
        calls.push([bin, ...args]);
        return { stdout: '{}', stderr: '' };
      },
    };
  }

  it.each([
    ['Preview', (executor: StageExecutor) => previewDocument('a.pdf', 1, { runtime: GAPPED, executor })],
    ['Contrast', (executor: StageExecutor) => measureContrast('a.pdf', { runtime: GAPPED, executor })],
  ] as const)('refuses %s before a JVM starts', async (_, run) => {
    const { executor, calls } = recording();

    const result = await run(executor);

    expect(calls).toEqual([]);
    expect(result).toEqual({ ok: false, failure: { kind: 'unavailable', reason: GAPPED.renderGap } });
  });

  it('still runs a stage that never renders', async () => {
    const { executor, calls } = recording();

    await inspectDocument('a.pdf', { runtime: GAPPED, executor });

    expect(calls.map((call) => call.at(-2))).toEqual(['Inspect']);
  });
});
