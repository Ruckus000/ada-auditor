import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { previewDocument } from '../../../../src/integrations/documents/preview';
import { resolveJavaRuntime } from '../../../../src/integrations/documents/java-runtime';
import { IMAGE_CODECS, codecImagePdf, darkPixelShare } from '../../../support/codec-image-pdf';
import { pdfFromObjects } from '../../../support/pdf-objects';

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
  return pdfFromObjects(objects);
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
  /**
   * A page whose only content is a JBIG2 or JPX image — the scanned pages of
   * c8-0033/c8-0034, whose judging sheets and model images came out blank.
   * Without the ImageIO decoders PDFBox paints nothing where the image was,
   * exits 0, and the "preview" is a white rectangle of the right size.
   */
  it.each(IMAGE_CODECS)('renders a page whose only content is a %s image', async (codec) => {
    const path = join(work, `${IMAGE_CODECS.indexOf(codec)}.pdf`); await writeFile(path, codecImagePdf(codec));
    const result = await previewDocument(path, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.width).toBe(400); expect(result.value.height).toBe(400);
    // The image is solid black and covers the whole page.
    expect(darkPixelShare(Buffer.from(result.value.png, 'base64'))).toBeGreaterThan(0.95);
  });
  it('refuses a page outside the real document', async () => {
    const path = join(work, 'outside.pdf'); await writeFile(path, fixture(0));
    expect((await previewDocument(path, 2)).ok).toBe(false);
  });
});
