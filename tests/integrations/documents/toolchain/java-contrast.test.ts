import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { measureContrast } from '../../../../src/integrations/documents/contrast';
import { resolveJavaRuntime } from '../../../../src/integrations/documents/java-runtime';

/**
 * The contrast stage against a real JVM, on documents built here.
 *
 * Hand-assembled rather than rendered, for the reason `java-inspect.test.ts`
 * gives about malformed documents: a renderer will not emit the exact colour
 * operators this stage exists to read, and pure `#FF0000` on white is 4.00:1 —
 * a fraction under the 4.5:1 minimum, which is precisely the failure a real fee
 * schedule turned out to carry and the reason this stage was built.
 */

const runtime = resolveJavaRuntime();
const skip = !runtime.available;
if (skip) {
  // A skip that says nothing is a skip nobody fixes.
  console.warn('skipping contrast toolchain tests: no compiled stages or no JVM');
}

/** A one-page PDF whose only content is a line of text in one colour. */
function onePage(colourOperator: string, size = 12, extra = ''): Uint8Array {
  const content = `${extra}${colourOperator} BT /F1 ${size} Tf 20 40 Td (Sample text here) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R'
      + ' /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}

describe.skipIf(skip)('Contrast, against a real JVM', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ada-contrast-'));
  });
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function measure(bytes: Uint8Array, name: string) {
    const path = join(dir, `${name}.pdf`);
    await writeFile(path, bytes);
    return measureContrast(path);
  }

  it('finds pure red on white, which is 4.00:1 against a 4.5:1 minimum', async () => {
    const result = await measure(onePage('1 0 0 rg'), 'red');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.failing).toBeGreaterThan(0);
    const finding = result.value.findings[0];
    expect(finding.fg).toBe('#FF0000');
    expect(finding.bg).toBe('#FFFFFF');
    expect(finding.ratio).toBeCloseTo(4.0, 1);
    expect(finding.required).toBe(4.5);
    expect(finding.page).toBe(1);
  }, 120_000);

  /**
   * The one float in this stage's output, under a locale that writes decimals
   * with a comma.
   *
   * Run against the compiled class directly rather than through `measureContrast`,
   * because the JVM's default locale cannot be set from the environment this
   * stage is allowed to pass: `childEnv` forwards LANG/LC_ALL, but macOS JVMs
   * take their locale from OS preferences and ignore both, so an env-based
   * version of this test passes on a developer's machine whether the bug is
   * present or not. `-Duser.language` reproduces it everywhere.
   *
   * `[V]` Without `Locale.ROOT`, this JVM formats 4.5 as `4,50` under de_DE and
   * emits `"ratio":4,50` — not valid JSON. The stage then reads as unparseable
   * and contrast is dropped from the whole delivery, on those hosts only. The
   * ratio is emitted for FAILING pairs only, so such a host could process clean
   * documents indefinitely before anything went wrong.
   */
  it('emits locale-independent JSON, so a comma-decimal host still parses', async () => {
    if (!runtime.available) return expect.unreachable('the suite runs only with a runtime');
    const path = join(dir, 'comma-locale.pdf');
    await writeFile(path, onePage('1 0 0 rg'));

    const { stdout } = await promisify(execFile)(
      runtime.javaBin,
      ['-Duser.language=de', '-Duser.country=DE', '-cp', runtime.classpath, 'Contrast', path],
      { maxBuffer: 32 * 1024 * 1024 },
    );

    // The assertion is that this parses at all.
    const reading = JSON.parse(stdout) as { failing: number; findings: Array<{ ratio: number }> };
    expect(reading.failing).toBeGreaterThan(0);
    expect(reading.findings[0].ratio).toBeCloseTo(4.0, 1);
  }, 120_000);

  it('passes black on white and reports no failure', async () => {
    const result = await measure(onePage('0 0 0 rg'), 'black');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.failing).toBe(0);
    expect(result.value.passing).toBeGreaterThan(0);
  }, 120_000);

  it('never carries the text it measured', async () => {
    // The spike emitted 30 glyphs of the measured run, and the summary this
    // feeds renders on a client's public report.
    const result = await measure(onePage('1 0 0 rg'), 'no-sample');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(result.value)).not.toContain('Sample text');
    expect(JSON.stringify(result.value)).not.toContain('sample');
  }, 120_000);

  it('counts text the document marks as decoration in its own bucket', async () => {
    // `/Artifact` is the format's word for "not content", but it also covers
    // running heads and page numbers, which WCAG does not exempt. So it is
    // counted and named rather than dropped — dropping it silenced a real
    // 4.0:1 failure across 82 glyphs of a running header.
    const artifact = onePage('1 0 0 rg', 12, '/Artifact BMC ');
    const result = await measure(
      new Uint8Array(Buffer.from(Buffer.from(artifact).toString('latin1').replace(
        'Tj ET', 'Tj ET EMC',
      ), 'latin1')),
      'artifact',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.failing).toBe(0);
    expect(result.value.decorative).toBeGreaterThan(0);
    expect(result.value.decorativeGlyphs).toBeGreaterThan(0);
  }, 120_000);

  it('ignores invisible text, which is the OCR layer on every scan', async () => {
    // Rendering mode 3 paints nothing. Measuring it invents a failure no reader
    // could ever see, on the highest-volume PDF category there is.
    const invisible = onePage('1 0 0 rg', 12, '');
    const withMode = new Uint8Array(Buffer.from(
      Buffer.from(invisible).toString('latin1').replace('BT /F1', 'BT 3 Tr /F1'),
      'latin1',
    ));
    const result = await measure(withMode, 'invisible');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.failing).toBe(0);
    expect(result.value.pairs).toBe(0);
  }, 120_000);
});
