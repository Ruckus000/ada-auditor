import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { inspectDocument } from '../../../../src/integrations/documents/inspect';
import { PDFBOX_JAR, resolveJavaRuntime } from '../../../../src/integrations/documents/java-runtime';
import { documentStructureSchema } from '../../../../src/domain/document-structure';
import { renderPdf } from '../../../../src/integrations/browser/render-pdf';

/**
 * The document boundary against a real JVM.
 *
 * `stage.test.ts` models every failure with an injected executor and runs in
 * the fast suite; this is the half that cannot be modelled — that a real
 * `java`, a real PDFBox and the compiled `Inspect` agree with the schema the
 * rest of the system is written against.
 *
 * ## The fixture is generated, never committed
 *
 * This repository tracks zero binaries and that is worth keeping, so the PDF is
 * rendered at test time by `renderPdf` — the same function that produces the
 * report a client is sent. It costs a Chromium launch and buys a genuinely real
 * PDF rather than a hand-assembled one that only resembles the shape under
 * test.
 */

const runtime = resolveJavaRuntime();

// Skipped rather than failed: a JDK, a fetched jar and `npm run
// build:documents` are all preconditions, and a contributor nowhere near this
// code should not be blocked by them. The reason names which piece is missing.
const skip = !runtime.available;
if (skip && !runtime.available) {
  console.warn(`document stages skipped — ${runtime.reason}`);
}

describe.skipIf(skip)('Inspect against a real JVM', () => {
  let dir: string;
  let pdfPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ada-documents-'));
    pdfPath = join(dir, 'generated.pdf');

    const pdf = await renderPdf(
      '<title>Committee Agenda</title><h1>Committee Agenda</h1>' +
        '<p>Apologies for absence were received.</p>',
    );
    await writeFile(pdfPath, pdf);
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  /**
   * A minimal PDF carrying a real signature dictionary.
   *
   * Hand-built rather than actually signed: producing a genuine signature
   * needs a certificate and a keystore, and none of that changes what is
   * under test, which is whether `Inspect` SEES a signature. There is no
   * Node PDF writer in this project, so the bytes are written directly.
   *
   * `unsigned: true` gives the other shape that matters — a signature FIELD
   * with no value, which is a placeholder waiting for somebody to sign and
   * must NOT read as signed. That distinction is the whole reason this uses
   * PDFBox's `getSignatureDictionaries()` rather than searching for
   * `/ByteRange`.
   */
  function signaturePdf({ unsigned = false } = {}): Buffer {
    const value = unsigned ? '' : ' /V 6 0 R';
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] /SigFlags 3 >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Annots [5 0 R] >>',
      '<< /Length 36 >>\nstream\nBT /F1 12 Tf 20 100 Td (notice) Tj ET\nendstream',
      `<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /Rect [0 0 0 0]${value} /P 3 0 R >>`,
      '<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached'
        + ' /ByteRange [0 100 200 300] /Contents <00112233> /M (D:20260101000000Z) >>',
    ];

    let out = '%PDF-1.7\n';
    const offsets: number[] = [];
    objs.forEach((body, index) => {
      offsets.push(out.length);
      out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }

  it('sees a digital signature, so repair can refuse to destroy it', async () => {
    // Repair rewrites the catalog, which invalidates a signature — and an
    // incremental save does not rescue it. The product can only refuse if it
    // can see the signature, and until now it could not see one at all.
    const signed = join(dir, 'signed.pdf');
    await writeFile(signed, signaturePdf());

    const result = await inspectDocument(signed);
    if (!result.ok) expect.unreachable(`could not read the signed fixture: ${JSON.stringify(result.failure)}`);
    else expect(result.value.signed).toBe(true);
  });

  it('does not call an unsigned signature field a signature', async () => {
    // A placeholder waiting for somebody to sign. Refusing to repair this
    // would block work for no reason, which is why the check reads signature
    // dictionaries rather than searching the bytes for /ByteRange — this
    // fixture contains that string and is still unsigned.
    const placeholder = join(dir, 'placeholder.pdf');
    await writeFile(placeholder, signaturePdf({ unsigned: true }));

    const result = await inspectDocument(placeholder);
    if (!result.ok) expect.unreachable('could not read the placeholder fixture');
    else expect(result.value.signed).toBe(false);
  });

  it('reports an ordinary document as unsigned', async () => {
    const result = await inspectDocument(pdfPath);
    if (!result.ok) expect.unreachable('could not read the generated document');
    else expect(result.value.signed).toBe(false);
  });

  /**
   * Encryption, from the tool that is already a precondition of this suite.
   *
   * PDFBox's own CLI ships in the same jar `Inspect` runs against, so the
   * fixture costs no new dependency and no committed binary — and the
   * encryption is produced by a third party rather than by the code under
   * test.
   *
   * An EMPTY user password with an owner password is the shape that matters:
   * the document opens and inspects completely without anyone supplying
   * anything, so every other field in the reading looks ordinary. It is the
   * municipal case — restricting printing, not reading.
   */
  it('sees an encryption dictionary, so repair can refuse by name', async () => {
    const encrypted = join(dir, 'encrypted.pdf');
    // Narrowing, not a second skip: `describe.skipIf` already guarantees this.
    if (!runtime.available) return expect.unreachable('the suite runs only with a runtime');
    await promisify(execFile)(runtime.javaBin, [
      '-jar', join(process.cwd(), PDFBOX_JAR),
      'encrypt', '-i', pdfPath, '-o', encrypted, '-O=owner', '-U=', '-canPrint=false',
    ]);

    const result = await inspectDocument(encrypted);
    if (!result.ok) expect.unreachable(`could not read the encrypted fixture: ${JSON.stringify(result.failure)}`);
    else {
      expect(result.value.encrypted).toBe(true);
      // The point of the field: nothing ELSE in the reading says it is locked.
      // No password was supplied and the document read completely — pages,
      // text and all — so every other signal looks like an ordinary document
      // right up until `Finish` cannot write it back.
      expect(result.value.signed).toBe(false);
      expect(result.value.pages).toBeGreaterThan(0);
      expect(result.value.textChars).toBeGreaterThan(0);
    }
  });

  it('reports an ordinary document as unencrypted', async () => {
    const result = await inspectDocument(pdfPath);
    if (!result.ok) expect.unreachable('could not read the generated document');
    else expect(result.value.encrypted).toBe(false);
  });

  /**
   * Two Widget annotations: one indexed into the structure tree by
   * `/StructParent`, one not.
   *
   * The distinction is the whole check. A form field with no StructParent
   * exists on the page and nowhere in the reading order, and veraPDF fails it
   * (7.18.1) — but a document is not defective merely for HAVING annotations,
   * so counting all of them would report work nobody has to do.
   */
  function annotationPdf(): Buffer {
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 7 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R'
        + ' /Annots [5 0 R 6 0 R] >>',
      '<< /Length 10 >>\nstream\n% content\nendstream',
      // Nested: carries the key that indexes it into the structure tree.
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (nested) /Rect [0 0 10 10]'
        + ' /StructParent 0 /P 3 0 R >>',
      // Not nested: no StructParent at all.
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (orphan) /Rect [0 20 10 30]'
        + ' /P 3 0 R >>',
      '<< /Type /StructTreeRoot >>',
    ];

    let out = '%PDF-1.7\n';
    const offsets: number[] = [];
    objs.forEach((body, index) => {
      offsets.push(out.length);
      out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }

  it('counts an annotation outside the structure tree, and not one inside it', async () => {
    const path = join(dir, 'annotations.pdf');
    await writeFile(path, annotationPdf());

    const result = await inspectDocument(path);
    if (!result.ok) expect.unreachable(`could not read the fixture: ${JSON.stringify(result.failure)}`);
    // Two Widgets, one of them indexed. Exactly one is unreachable.
    else expect(result.value.annotationsNotInStructure).toBe(1);
  });

  it('reports an ordinary document as having no orphaned annotations', async () => {
    const result = await inspectDocument(pdfPath);
    if (!result.ok) expect.unreachable('could not read the generated document');
    else expect(result.value.annotationsNotInStructure).toBe(0);
  });

  /**
   * Four widgets covering each way a form field can and cannot be named.
   *
   * The accessible name is `/TU`. `/T` is the internal field name a form
   * processor uses and assistive technology never speaks, so a widget carrying
   * only `/T` is unnamed however descriptive that string looks — which is the
   * case this fixture exists to pin, because it is the one a reasonable reader
   * of the bytes gets wrong.
   *
   * `acroForm: false` drops the `/AcroForm` entry while leaving the widgets on
   * the page. A first implementation walked PDFBox's field tree and reported
   * ZERO fields for exactly that document — a planted corpus row with two
   * unlabelled fields, read as a document with no form at all.
   */
  function formPdf({ acroForm = true } = {}): Buffer {
    const fields = acroForm ? ' /AcroForm << /Fields [5 0 R 6 0 R 8 0 R 9 0 R] >>' : '';
    const objs = [
      `<< /Type /Catalog /Pages 2 0 R${fields} >>`,
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R'
        + ' /Annots [5 0 R 6 0 R 7 0 R 8 0 R] >>',
      '<< /Length 10 >>\nstream\n% content\nendstream',
      // Named outright.
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (surname) /TU (Applicant surname)'
        + ' /Rect [0 0 10 10] /P 3 0 R >>',
      // /T only — an internal field name, not a label.
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (Text12)'
        + ' /Rect [0 20 10 30] /P 3 0 R >>',
      // Named through the field it belongs to, which is a separate object.
      '<< /Type /Annot /Subtype /Widget /FT /Tx /Parent 9 0 R'
        + ' /Rect [0 40 10 50] /P 3 0 R >>',
      // The rule's second limb: an alternative description on the widget.
      '<< /Type /Annot /Subtype /Widget /FT /Tx /T (dob) /Contents (Date of birth)'
        + ' /Rect [0 60 10 70] /P 3 0 R >>',
      '<< /FT /Tx /T (parentfield) /TU (Parent label) /Kids [7 0 R] >>',
    ];

    let out = '%PDF-1.7\n';
    const offsets: number[] = [];
    objs.forEach((body, index) => {
      offsets.push(out.length);
      out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }

  it('counts only the form field that carries no accessible name', async () => {
    const path = join(dir, 'form.pdf');
    await writeFile(path, formPdf());

    const result = await inspectDocument(path);
    if (!result.ok) expect.unreachable(`could not read the form fixture: ${JSON.stringify(result.failure)}`);
    else {
      expect(result.value.formFields).toBe(4);
      // Only the /T-only widget. /TU, an inherited /TU and /Contents all name.
      expect(result.value.formFieldsWithoutName).toBe(1);
    }
  });

  it('sees widgets that no AcroForm registers', async () => {
    // The silent gap: a first implementation walked the field tree and read
    // this document as having no form fields at all.
    const path = join(dir, 'form-no-acroform.pdf');
    await writeFile(path, formPdf({ acroForm: false }));

    const result = await inspectDocument(path);
    if (!result.ok) expect.unreachable('could not read the AcroForm-less fixture');
    else {
      expect(result.value.formFields).toBe(4);
      expect(result.value.formFieldsWithoutName).toBe(1);
    }
  });

  it('reports an ordinary document as carrying no form fields', async () => {
    const result = await inspectDocument(pdfPath);
    if (!result.ok) expect.unreachable('could not read the generated document');
    else {
      expect(result.value.formFields).toBe(0);
      expect(result.value.formFieldsWithoutName).toBe(0);
    }
  });

  /**
   * Two tagged figures on different pages, and one that declares no page.
   *
   * The page a figure reports is printed on a client's public report, and no
   * answer key in the blind corpus checks it — so this is the only thing that
   * would catch it being wrong. A wrong page is worse than no page: it sends a
   * person to the wrong part of their own document.
   *
   * It also pins the bug that made the first implementation report NOTHING.
   * `el.getPage()` builds a fresh `PDPage` wrapper around the page's
   * dictionary, and `PDPage` does not override `equals`, so a map keyed on the
   * wrapper missed every time — all 101 of r05's figures came back with no page
   * while qpdf showed every one carrying `/Pg`. Two pages here, so a map that
   * regressed to identity would fail rather than accidentally pass.
   */
  function figurePdf(): Buffer {
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 8 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 5 0 R >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 6 0 R >>',
      '<< /Length 10 >>\nstream\n% page 1\nendstream',
      '<< /Length 10 >>\nstream\n% page 2\nendstream',
      // Unused, kept so object numbering stays readable against /K below.
      '<< /Type /StructElem /S /Document /K [9 0 R 10 0 R 11 0 R] /P 8 0 R >>',
      '<< /Type /StructTreeRoot /K 7 0 R >>',
      // On page 1.
      '<< /Type /StructElem /S /Figure /P 7 0 R /Pg 3 0 R >>',
      // On page 2 — a different page, so an identity-keyed map cannot pass.
      '<< /Type /StructElem /S /Figure /P 7 0 R /Pg 4 0 R >>',
      // Declares no page at all.
      '<< /Type /StructElem /S /Figure /P 7 0 R >>',
    ];

    let out = '%PDF-1.7\n';
    const offsets: number[] = [];
    objs.forEach((body, index) => {
      offsets.push(out.length);
      out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }

  it('reports the page each figure declares, 1-based, and null for none', async () => {
    const path = join(dir, 'figures.pdf');
    await writeFile(path, figurePdf());

    const result = await inspectDocument(path);
    if (!result.ok) expect.unreachable(`could not read the figure fixture: ${JSON.stringify(result.failure)}`);
    else {
      expect(result.value.figures.map((f) => f.page)).toEqual([1, 2, null]);
    }
  });

  /**
   * Two figures drawing ONE image XObject at two places on the page, and a
   * third figure that draws nothing. The shape page furniture takes: a logo
   * placed on every page is one XObject drawn many times, and the reading has
   * to say so — same bytes, same digest — so a person can describe it once.
   */
  function drawnFiguresPdf(): Buffer {
    const image = 'PDF!';
    const stream = [
      '/Figure <</MCID 0>> BDC q 50 0 0 30 20 100 cm /Im1 Do Q EMC',
      '/Figure <</MCID 1>> BDC q 50 0 0 30 120 40 cm /Im1 Do Q EMC',
      '/Figure <</MCID 2>> BDC EMC',
    ].join('\n');
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 6 0 R /MarkInfo << /Marked true >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R'
        + ' /Resources << /XObject << /Im1 5 0 R >> >> /StructParents 0 >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${image.length} >>\nstream\n${image}\nendstream`,
      '<< /Type /StructTreeRoot /K [7 0 R 8 0 R 9 0 R] >>',
      '<< /Type /StructElem /S /Figure /P 6 0 R /Pg 3 0 R /K 0 >>',
      '<< /Type /StructElem /S /Figure /P 6 0 R /Pg 3 0 R /K 1 >>',
      '<< /Type /StructElem /S /Figure /P 6 0 R /Pg 3 0 R /K 2 >>',
    ];

    let out = '%PDF-1.7\n';
    const offsets: number[] = [];
    objs.forEach((body, index) => {
      offsets.push(out.length);
      out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }

  it('reports where each figure is drawn and what image it draws, so repeats can be answered once', async () => {
    const path = join(dir, 'drawn-figures.pdf');
    await writeFile(path, drawnFiguresPdf());

    const result = await inspectDocument(path);
    if (!result.ok) expect.unreachable(`could not read the drawn-figure fixture: ${JSON.stringify(result.failure)}`);
    else {
      const [first, second, empty] = result.value.figures;
      // One XObject, two placements: the same digest, different boxes — in
      // top-down page points, the way `StructText` reports text.
      expect(first.imageDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(second.imageDigest).toBe(first.imageDigest);
      expect(first.box).toEqual({ page: 1, x: 20, y: 70, w: 50, h: 30 });
      expect(second.box).toEqual({ page: 1, x: 120, y: 130, w: 50, h: 30 });
      expect(first.imageFilter).toBeNull();
      // A figure that draws nothing has no place and no image — absent, never
      // invented.
      expect(empty.box).toBeNull();
      expect(empty.imageDigest).toBeNull();
    }
  });

  /**
   * Figures drawn as PATHS — the rules, charts and boxes that made up the
   * unlocated 56 % of the real corpus's open figures — plus the two shapes
   * that would produce a wrong box rather than none.
   *
   * The second figure sits under `2 0 0 2 0 0 cm`: PDFBox hands the path
   * methods coordinates already transformed by the CTM, so a pass that
   * applied the matrix again would report it at four times its size. The
   * third paints nothing — `W n` sets a clip and ends the path — and a pass
   * that recorded every path point would make the clip rectangle the figure's
   * box. The fifth draws a path AND an image, in that order: the box is the
   * union, and the identity is the image's.
   *
   * The last two are the marked-content shapes real producers use. `[V]`
   * InDesign nests a `/PlacedPDF /MC0 BDC` sequence — a named property list
   * with no MCID of its own — inside the figure's, and 22 of r11's 36 figures
   * were hidden behind it; the content belongs to the enclosing element. And
   * an id may arrive through `/Resources /Properties` rather than inline,
   * which is the same statement spelled differently.
   */
  function pathFiguresPdf(): Buffer {
    const image = 'PDF!';
    const stream = [
      '/Figure <</MCID 0>> BDC 20 100 50 30 re f EMC',
      '/Figure <</MCID 1>> BDC q 2 0 0 2 0 0 cm 10 20 m 40 20 l 40 35 l h S Q EMC',
      '/Figure <</MCID 2>> BDC q 10 10 100 100 re W n Q EMC',
      '/Figure <</MCID 3>> BDC EMC',
      '/Figure <</MCID 4>> BDC 100 100 20 20 re f q 50 0 0 30 20 100 cm /Im1 Do Q EMC',
      '/Figure <</MCID 5>> BDC /PlacedPDF /MC0 BDC 150 150 20 20 re f EMC EMC',
      '/Figure /MC1 BDC 10 150 20 20 re f EMC',
    ].join('\n');
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 6 0 R /MarkInfo << /Marked true >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R'
        + ' /Resources << /XObject << /Im1 5 0 R >>'
        + ' /Properties << /MC0 << /Type /OCG >> /MC1 << /MCID 6 >> >> >> /StructParents 0 >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${image.length} >>\nstream\n${image}\nendstream`,
      '<< /Type /StructTreeRoot /K [7 0 R 8 0 R 9 0 R 10 0 R 11 0 R 12 0 R 13 0 R] >>',
      '<< /Type /StructElem /S /Figure /P 6 0 R /Pg 3 0 R /K 0 >>',
      '<< /Type /StructElem /S /Figure /P 6 0 R /Pg 3 0 R /K 1 >>',
      '<< /Type /StructElem /S /Figure /P 6 0 R /Pg 3 0 R /K 2 >>',
      '<< /Type /StructElem /S /Figure /P 6 0 R /Pg 3 0 R /K 3 >>',
      '<< /Type /StructElem /S /Figure /P 6 0 R /Pg 3 0 R /K 4 >>',
      '<< /Type /StructElem /S /Figure /P 6 0 R /Pg 3 0 R /K 5 >>',
      '<< /Type /StructElem /S /Figure /P 6 0 R /Pg 3 0 R /K 6 >>',
    ];

    let out = '%PDF-1.7\n';
    const offsets: number[] = [];
    objs.forEach((body, index) => {
      offsets.push(out.length);
      out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }

  it('locates a figure drawn as paths, without inflating it by the CTM or by a clip', async () => {
    const path = join(dir, 'path-figures.pdf');
    await writeFile(path, pathFiguresPdf());

    const result = await inspectDocument(path);
    if (!result.ok) expect.unreachable(`could not read the path-figure fixture: ${JSON.stringify(result.failure)}`);
    else {
      const [rect, scaled, clipped, empty, both, nested, named] = result.value.figures;
      // A filled rectangle: its own bounds, in top-down page points.
      expect(rect.box).toEqual({ page: 1, x: 20, y: 70, w: 50, h: 30 });
      // A stroked triangle under a 2× CTM: the bounds of the transformed
      // points, once — (20,40)–(80,70) in PDF space.
      expect(scaled.box).toEqual({ page: 1, x: 20, y: 130, w: 60, h: 30 });
      // A clip is not a painting: the figure has no box rather than a wrong one.
      expect(clipped.box).toBeNull();
      expect(empty.box).toBeNull();
      // A path has a place and no identity.
      for (const figure of [rect, scaled, clipped, empty]) {
        expect(figure.imageDigest).toBeNull();
        expect(figure.imageFilter).toBeNull();
      }
      // Path and image together: the union of both, identified by the image
      // even though the path was drawn first.
      expect(both.box).toEqual({ page: 1, x: 20, y: 70, w: 100, h: 30 });
      expect(both.imageDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      // A nested sequence with no id of its own belongs to the figure; an id
      // declared through the resource dictionary is still the figure's id.
      expect(nested.box).toEqual({ page: 1, x: 150, y: 30, w: 20, h: 20 });
      expect(named.box).toEqual({ page: 1, x: 10, y: 30, w: 20, h: 20 });
    }
  });

  /**
   * A document with other documents inside it.
   *
   * `collection: true` makes it a portfolio; without it, the same attachment
   * mechanism is an ordinary PDF with a file attached. Both reach a reader the
   * same way and neither instrument opens either, so the count must not depend
   * on the `/Collection` flag — which is the thing this fixture pins.
   */
  function attachmentPdf({ collection = false, count = 1 } = {}): Buffer {
    const attached = '%PDF-1.7\n% a document nobody remediated\n%%EOF\n';
    const specs: string[] = [];
    const streams: string[] = [];
    // Objects 5.. alternate: file spec, then its embedded stream.
    for (let i = 0; i < count; i += 1) {
      const specNum = 5 + i * 2;
      const streamNum = specNum + 1;
      specs.push(
        `<< /Type /Filespec /F (attached-${i}.pdf) /UF (attached-${i}.pdf)`
          + ` /EF << /F ${streamNum} 0 R >> /Desc (An attached document) >>`,
      );
      streams.push(
        `<< /Type /EmbeddedFile /Subtype /application#2Fpdf /Length ${attached.length} >>`
          + `\nstream\n${attached}\nendstream`,
      );
    }
    const names = specs.map((_, i) => `(attached-${i}.pdf) ${5 + i * 2} 0 R`).join(' ');

    const objs = [
      `<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 4 0 R /Names 3 0 R`
        + `${collection ? ' /Collection << /Type /Collection /View /D >>' : ''} >>`,
      '<< /Type /Pages /Kids [' + `${5 + count * 2} 0 R` + '] /Count 1 >>',
      `<< /EmbeddedFiles << /Names [${names}] >> >>`,
      '<< /Type /StructTreeRoot >>',
      ...specs.flatMap((spec, i) => [spec, streams[i]]),
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
    ];

    let out = '%PDF-1.7\n';
    const offsets: number[] = [];
    objs.forEach((body, index) => {
      offsets.push(out.length);
      out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }

  it('counts the documents attached to a portfolio', async () => {
    // The blind corpus planted a tagged cover sheet over an untagged payload
    // and it delivered clean: veraPDF validates the outer document's bytes and
    // the structure walk reads the outer tree, so an unremediated attachment
    // failed no clause and produced no finding. Counting is what lets the
    // punch list say so.
    const path = join(dir, 'portfolio.pdf');
    await writeFile(path, attachmentPdf({ collection: true, count: 2 }));

    const result = await inspectDocument(path);
    if (!result.ok) expect.unreachable(`could not read the fixture: ${JSON.stringify(result.failure)}`);
    else expect(result.value.embeddedFiles).toBe(2);
  });

  it('counts an attachment on a document that is not a portfolio', async () => {
    // `/Collection` makes a viewer show the portfolio UI; it is not what makes
    // the attachment unexamined. Keying on it would miss every plain PDF that
    // simply has a file attached.
    const path = join(dir, 'attachment.pdf');
    await writeFile(path, attachmentPdf({ collection: false, count: 1 }));

    const result = await inspectDocument(path);
    if (!result.ok) expect.unreachable('could not read the fixture');
    else expect(result.value.embeddedFiles).toBe(1);
  });

  it('reports an ordinary document as carrying nothing', async () => {
    const result = await inspectDocument(pdfPath);
    if (!result.ok) expect.unreachable('could not read the generated document');
    else expect(result.value.embeddedFiles).toBe(0);
  });

  it('reports a real document, and the result satisfies the domain contract', async () => {
    const result = await inspectDocument(pdfPath);

    if (!result.ok) {
      expect.unreachable(`Inspect failed: ${JSON.stringify(result.failure)}`);
      return;
    }

    // The point of the whole test: what a real JVM printed parses against the
    // schema everything above this layer is written against. `runStage` already
    // validated it, and re-parsing here asserts that rather than assuming it.
    expect(documentStructureSchema.safeParse(result.value).success).toBe(true);

    expect(result.value.pages).toBe(1);
    expect(result.value.textChars).toBeGreaterThan(0);
    // No <img> in the source, so nothing should be drawn.
    expect(result.value.images).toBe(0);
  });

  it('reports an untagged PDF as untagged rather than erroring', async () => {
    // A browser-printed PDF carries no structure tree. That is a fact to
    // report, not a failure — and it is the state most real municipal
    // documents arrive in.
    const result = await inspectDocument(pdfPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.structureElements).toBe(0);
      expect(result.value.headings).toEqual([]);
      expect(result.value.tables).toEqual([]);
    }
  });

  it('fails cleanly on a file that is not a PDF', async () => {
    // The real JVM's own error path: a typed failure carrying the stage name
    // and the first stderr line, never a raw stack reaching a caller.
    const notPdf = join(dir, 'not-a.pdf');
    await writeFile(notPdf, 'this is not a PDF');

    const result = await inspectDocument(notPdf);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('failed');
      if (result.failure.kind === 'failed') {
        expect(result.failure.stage).toBe('Inspect');
        expect(result.failure.stderr).not.toBe('');
        expect(result.failure.timedOut).toBe(false);
      }
    }
  });

  it('fails on a path that does not exist', async () => {
    const result = await inspectDocument(join(dir, 'absent.pdf'));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('failed');
  });

  /**
   * A structure tree is a tree by convention and a graph by format.
   *
   * Nothing in the PDF specification stops a structure element being its own
   * descendant, and `Inspect.walk` recursed whatever it was handed — so this
   * document used to recurse until the JVM's stack gave out. That arrived as a
   * crash rather than as a reading, on a file an operator uploaded.
   *
   * Hand-assembled rather than rendered: `renderPdf` produces well-formed
   * documents, which is the whole reason it cannot produce this one. The bytes
   * are built here and nothing is committed — this repository tracks zero
   * binaries, and that rule is why the fixture above is generated too.
   *
   * The assertion is the *bound*, never a duration. A wall-clock threshold on a
   * recursion bug is a flaky test that teaches people to re-run red, which is
   * the same reason `scripts/chaos.ts` asserts shape and never speed.
   */
  it('returns a bounded reading of a structure tree that contains itself', async () => {
    const cyclic = join(dir, 'cyclic.pdf');
    await writeFile(cyclic, selfReferencingStructureTree());

    const result = await inspectDocument(cyclic);

    if (!result.ok) {
      expect.unreachable(`Inspect failed: ${JSON.stringify(result.failure)}`);
      return;
    }

    expect(documentStructureSchema.safeParse(result.value).success).toBe(true);
    // The cycle is one element. Walked once it is counted once; walked as the
    // format allows, this never returns at all. `hasStructTree` is deliberately
    // not asserted — the domain schema does not carry it, and `isTagged` is
    // derived from this same count.
    expect(result.value.structureElements).toBe(1);
    // The block-level record is bounded by the same guard, so the one `/P`
    // appears once rather than being appended on every revisit.
    expect(result.value.order).toHaveLength(1);
  });
});

/**
 * A minimal PDF whose one structure element lists itself among its kids.
 *
 * Offsets are computed rather than hard-coded: PDFBox will rebuild a broken
 * cross-reference table, and a fixture that leaned on that repair path would be
 * testing the repair rather than the cycle.
 */
function selfReferencingStructureTree(): string {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 4 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
    '<< /Type /StructTreeRoot /K [5 0 R] >>',
    // `/K [5 0 R]` inside object 5: the element is its own kid.
    '<< /Type /StructElem /S /P /P 4 0 R /K [5 0 R] >>',
  ];

  let pdf = '%PDF-1.7\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xref}\n%%EOF\n`;

  return pdf;
}
