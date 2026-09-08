import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { previewDocument } from '../../../../src/integrations/documents/preview';
import { resolveJavaRuntime } from '../../../../src/integrations/documents/java-runtime';

function fixture(rotation: number): Buffer {
  const content = '/Figure <</MCID 0>> BDC q 60 0 0 40 80 120 cm /Im0 Do Q EMC';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 5 0 R /MarkInfo << /Marked true >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /CropBox [50 70 350 270] /Rotate ${rotation} /Contents 4 0 R /StructParents 0 /Resources << /XObject << /Im0 7 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /StructTreeRoot /K [6 0 R] >>',
    '<< /Type /StructElem /S /Figure /P 5 0 R /Pg 3 0 R /K 0 >>',
    '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\nff0000>\nendstream',
  ];
  let pdf = '%PDF-1.7\n'; const offsets: number[] = [];
  objects.forEach((object, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(offset => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  return Buffer.from(`${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

describe.skipIf(!resolveJavaRuntime().available)('Preview measured geometry against PDFBox', () => {
  let work: string;
  beforeAll(async () => { work = await mkdtemp(join(tmpdir(), 'preview-test-')); });
  afterAll(async () => { if (work) await rm(work, { recursive: true, force: true }); });
  it.each([
    [0, .1, .55, 600, 400], [90, .25, .1, 400, 600],
    [180, .7, .25, 600, 400], [270, .55, .7, 400, 600],
  ])('places the same marked figure on a cropped page rotated %i degrees', async (rotation, x, y, width, height) => {
    const path = join(work, `r-${rotation}.pdf`); await writeFile(path, fixture(rotation));
    const result = await previewDocument(path, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.width).toBe(width); expect(result.value.height).toBe(height);
    expect(result.value.figures).toHaveLength(1);
    expect(result.value.figures[0]).toMatchObject({ ordinal: 0 });
    expect(result.value.figures[0]!.x).toBeCloseTo(x, 6);
    expect(result.value.figures[0]!.y).toBeCloseTo(y, 6);
    expect(result.value.figures[0]!.w).toBeCloseTo(.2, 6);
    expect(result.value.figures[0]!.h).toBeCloseTo(.2, 6);
    expect(Buffer.from(result.value.png, 'base64').subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
  it('refuses a page outside the real document', async () => {
    const path = join(work, 'outside.pdf'); await writeFile(path, fixture(0));
    expect((await previewDocument(path, 2)).ok).toBe(false);
  });
});
