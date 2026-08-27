import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { inspectDocument } from '../../../../src/integrations/documents/inspect';
import { resolveJavaRuntime } from '../../../../src/integrations/documents/java-runtime';
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
