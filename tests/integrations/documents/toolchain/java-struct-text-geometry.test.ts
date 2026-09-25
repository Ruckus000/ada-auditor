import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveJavaRuntime } from '../../../../src/integrations/documents/java-runtime';

/**
 * `StructText.Box` means what its own contract says: page coordinates.
 *
 * The record promises "top-down page coordinates", and every consumer reads it
 * that way — the spike's `Cards` hands the box to `Mark`, which maps page
 * coordinates onto a rendered raster. But the box was built from PDFBox's
 * *direction-adjusted* glyph accessors (`getXDirAdj` and friends), which are in
 * the frame the text **reads** in, rotated by `TextPosition.getDir()`. For
 * upright text on an unrotated page the two frames coincide, which is why this
 * held for as long as it did. It is not only the vertical labels on a survey
 * plat: a landscape sheet is often authored by drawing a portrait page's
 * content rotated, and then every block on it transposes.
 *
 * Measured on 2026-09-25: 2,331 of cohort 8's 10,989 heading cards (21.2%)
 * carried a transposed box, and 2,044 of those drew a magenta outline around
 * unrelated content — the model was shown one phrase and a box around another.
 * `docs/research/document-remediation/heading-stage2-2026-09-25-rotated-text-geometry.md`.
 *
 * The assertions are metric-free on purpose. Pinning PDFBox's font metrics
 * would make this a change-detector; these pin what was actually wrong — where
 * the run starts, and which way it runs. A vertical run's box came out wider
 * than it is tall, in the wrong half of the page.
 *
 * `boxOf` has no caller in `src/` today, so nothing else in this repository
 * would have caught it.
 */

const execFileAsync = promisify(execFile);
const runtime = resolveJavaRuntime();

const PAGE_W = 400;
const PAGE_H = 500;
/** Text origin, in PDF user space (bottom-up), well clear of every edge. */
const ORIGIN_X = 140;
const ORIGIN_Y = 260;

/** A text matrix that draws the run at `degrees` counter-clockwise. */
function textMatrix(degrees: number): string {
  const m: Record<number, string> = {
    0: '1 0 0 1',
    90: '0 1 -1 0',
    180: '-1 0 0 -1',
    270: '0 -1 1 0',
  };
  return `${m[degrees]} ${ORIGIN_X} ${ORIGIN_Y}`;
}

/** One tagged paragraph of five glyphs, drawn at `textRotation` on a page carrying `/Rotate`. */
function fixture(pageRotation: number, textRotation: number): Buffer {
  const content =
    `/P <</MCID 0>> BDC BT /F1 10 Tf ${textMatrix(textRotation)} Tm (HELLO) Tj ET EMC`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 5 0 R /MarkInfo << /Marked true >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Rotate ${pageRotation} /Contents 4 0 R /StructParents 0 /Resources << /Font << /F1 7 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /StructTreeRoot /K [6 0 R] >>',
    '<< /Type /StructElem /S /P /P 5 0 R /Pg 3 0 R /K 0 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  return Buffer.from(
    `${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
}

/**
 * Two pages. Page 1 tags its text as MCID 0; page 2 draws text with no marked
 * content at all, while its structure element still names `/Pg` page 2 and
 * MCID 0. That is the real shape behind 1,550 of cohort 8's 17,088 blocks —
 * an element whose own page has no entry for the id it asks for.
 */
function crossPageFixture(): Buffer {
  const one = `/P <</MCID 0>> BDC BT /F1 10 Tf 1 0 0 1 ${ORIGIN_X} ${ORIGIN_Y} Tm (PAGEONE) Tj ET EMC`;
  const two = `BT /F1 10 Tf 1 0 0 1 ${ORIGIN_X} ${ORIGIN_Y} Tm (PAGETWO) Tj ET`;
  const page = (contents: number, structParents: number) =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${contents} 0 R /StructParents ${structParents} /Resources << /Font << /F1 7 0 R >> >> >>`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 5 0 R /MarkInfo << /Marked true >> >>',
    '<< /Type /Pages /Kids [3 0 R 8 0 R] /Count 2 >>',
    page(4, 0),
    `<< /Length ${one.length} >>\nstream\n${one}\nendstream`,
    '<< /Type /StructTreeRoot /K [6 0 R 9 0 R] >>',
    '<< /Type /StructElem /S /P /P 5 0 R /Pg 3 0 R /K 0 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    page(10, 1),
    '<< /Type /StructElem /S /P /P 5 0 R /Pg 8 0 R /K 0 >>',
    `<< /Length ${two.length} >>\nstream\n${two}\nendstream`,
  ];
  let pdf = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(offset => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  return Buffer.from(
    `${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
  );
}

/**
 * Test scaffolding, not product surface: nothing in `src/` calls `boxOf`, so
 * there is no stage whose output would show the box. Rather than widen a
 * stage's JSON for a test, compile a probe against the built classes.
 */
const PROBE = `import java.io.File;
import java.util.Locale;
import java.util.Set;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureElement;
import org.apache.pdfbox.pdmodel.documentinterchange.logicalstructure.PDStructureTreeRoot;

public final class BoxProbe {
    public static void main(String[] args) throws Exception {
        try (PDDocument doc = Loader.loadPDF(new File(args[0]))) {
            PDStructureTreeRoot root = doc.getDocumentCatalog().getStructureTreeRoot();
            StructText text = new StructText(doc);
            int index = args.length > 1 ? Integer.parseInt(args[1]) : 0;
            PDStructureElement el = StructText.find(root, Set.of("P"), root.getRoleMap()).get(index);
            StructText.Box b = text.boxOf(el);
            if (b == null) {
                System.out.println("{\\"page\\":-1,\\"x0\\":0,\\"y0\\":0,\\"x1\\":0,\\"y1\\":0,\\"text\\":\\"" + text.of(el) + "\\"}");
                return;
            }
            System.out.println(String.format(Locale.ROOT,
                "{\\"page\\":%d,\\"x0\\":%.3f,\\"y0\\":%.3f,\\"x1\\":%.3f,\\"y1\\":%.3f,\\"text\\":\\"%s\\"}",
                b.page(), b.x0(), b.y0(), b.x1(), b.y1(), text.of(el)));
        }
    }
}
`;

type Box = { page: number; x0: number; y0: number; x1: number; y1: number; text: string };

describe.skipIf(!runtime.available)('StructText.Box is page space, not the text reading frame', () => {
  let work: string;
  let probeClasses: string;

  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), 'struct-text-geometry-'));
    const source = join(work, 'BoxProbe.java');
    probeClasses = join(work, 'classes');
    await writeFile(source, PROBE);
    if (!runtime.available) return;
    const javac = join(dirname(runtime.javaBin), 'javac');
    await execFileAsync(javac, ['-cp', runtime.classpath, '-d', probeClasses, source]);
  }, 60_000);

  afterAll(async () => {
    if (work) await rm(work, { recursive: true, force: true });
  });

  async function boxOf(pageRotation: number, textRotation: number): Promise<Box> {
    if (!runtime.available) throw new Error(runtime.reason);
    const path = join(work, `r${pageRotation}-t${textRotation}.pdf`);
    await writeFile(path, fixture(pageRotation, textRotation));
    const { stdout } = await execFileAsync(runtime.javaBin, [
      '-Djava.awt.headless=true',
      '-cp',
      `${runtime.classpath}:${probeClasses}`,
      'BoxProbe',
      path,
    ]);
    return JSON.parse(stdout.trim().split('\n').at(-1)!) as Box;
  }

  /** The probe against an arbitrary file and element. `page` is -1 for no box. */
  async function boxOfElement(pdf: Buffer, index: number, name: string): Promise<Box> {
    if (!runtime.available) throw new Error(runtime.reason);
    const path = join(work, `${name}.pdf`);
    await writeFile(path, pdf);
    const { stdout } = await execFileAsync(runtime.javaBin, [
      '-Djava.awt.headless=true',
      '-cp',
      `${runtime.classpath}:${probeClasses}`,
      'BoxProbe',
      path,
      String(index),
    ]);
    return JSON.parse(stdout.trim().split('\n').at(-1)!) as Box;
  }

  // Marked content ids restart at 0 on every page. `merge` used to fall back to
  // scanning every page when the element's own page had no entry for the id, so
  // an element on page 2 could be located by page 1's geometry — measured at
  // 1,550 of cohort 8's 17,088 blocks, 978 of them in one document. `append`
  // (the text half) and `Inspect.java:427` (figure locations) both already
  // refuse it. Absent beats invented.
  it('refuses a box from another page when the element names its own', async () => {
    const pdf = crossPageFixture();
    const onPageOne = await boxOfElement(pdf, 0, 'cross-page');
    expect(onPageOne.page, 'the page-1 element is located normally').toBe(0);
    expect(onPageOne.x0).toBeLessThanOrEqual(ORIGIN_X + 0.01);

    const onPageTwo = await boxOfElement(pdf, 1, 'cross-page');
    expect(onPageTwo.text.trim(), 'the element is found, and it is the page-2 one').toBe('');
    expect(onPageTwo.page, 'no box, rather than page 1 geometry').toBe(-1);
  }, 60_000);

  it.each([0, 90, 180, 270])('keeps the box inside the page for text drawn at %i degrees', async textRotation => {
    for (const pageRotation of [0, 90, 180, 270]) {
      const box = await boxOf(pageRotation, textRotation);
      expect(box.text, `text ${textRotation}, page ${pageRotation}`).toBe('HELLO');
      expect(box.x0, `x0 (text ${textRotation}, page ${pageRotation})`).toBeGreaterThanOrEqual(0);
      expect(box.y0, `y0 (text ${textRotation}, page ${pageRotation})`).toBeGreaterThanOrEqual(0);
      expect(box.x1, `x1 (text ${textRotation}, page ${pageRotation})`).toBeLessThanOrEqual(PAGE_W);
      expect(box.y1, `y1 (text ${textRotation}, page ${pageRotation})`).toBeLessThanOrEqual(PAGE_H);
    }
  }, 60_000);

  it.each([0, 90, 180, 270])('starts the box at the pen position of the run, at %i degrees', async textRotation => {
    // Whichever way the glyphs run, the box has to touch the point the run is
    // drawn from — `ORIGIN_X` across, and the same height down from the page
    // top. This is what a transposed box misses, by the length of the run.
    const box = await boxOf(0, textRotation);
    const penY = PAGE_H - ORIGIN_Y;
    expect(box.x0, 'left edge').toBeLessThanOrEqual(ORIGIN_X + 0.01);
    expect(box.x1, 'right edge').toBeGreaterThanOrEqual(ORIGIN_X - 0.01);
    expect(box.y0, 'top edge').toBeLessThanOrEqual(penY + 0.01);
    expect(box.y1, 'bottom edge').toBeGreaterThanOrEqual(penY - 0.01);
  }, 60_000);

  // This one held before the fix as well: `PDFMarkedContentExtractor` reports
  // content-stream coordinates and never applies `/Rotate`, which changes how a
  // page is displayed rather than where its glyphs are. Pinned so that nobody
  // "fixes" the frame by folding the page rotation in.
  it.each([0, 90, 180, 270])('puts the same glyphs in the same place whatever the page /Rotate, at %i degrees', async textRotation => {
    const boxes = [];
    for (const pageRotation of [0, 90, 180, 270]) boxes.push(await boxOf(pageRotation, textRotation));
    for (const box of boxes.slice(1)) {
      expect(box.x0).toBeCloseTo(boxes[0]!.x0, 3);
      expect(box.y0).toBeCloseTo(boxes[0]!.y0, 3);
      expect(box.x1).toBeCloseTo(boxes[0]!.x1, 3);
      expect(box.y1).toBeCloseTo(boxes[0]!.y1, 3);
    }
  }, 60_000);

  it('lays the box along the direction the glyphs are drawn in', async () => {
    for (const textRotation of [0, 180]) {
      const box = await boxOf(0, textRotation);
      expect(box.x1 - box.x0, `upright run at ${textRotation}`).toBeGreaterThan(box.y1 - box.y0);
    }
    for (const textRotation of [90, 270]) {
      const box = await boxOf(0, textRotation);
      expect(box.y1 - box.y0, `vertical run at ${textRotation}`).toBeGreaterThan(box.x1 - box.x0);
    }
  }, 60_000);

  it('leaves an upright run on an unrotated page where it always was', async () => {
    // The one case that must not move: the frame is unchanged for `dir == 0`,
    // so the box still starts at the text origin, top-down from the page top.
    const box = await boxOf(0, 0);
    expect(box.x0).toBeCloseTo(ORIGIN_X, 1);
    expect(box.y1).toBeCloseTo(PAGE_H - ORIGIN_Y, 1);
  }, 60_000);
});
