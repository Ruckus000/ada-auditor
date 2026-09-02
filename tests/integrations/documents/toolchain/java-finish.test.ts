import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { finishDocument } from '../../../../src/integrations/documents/finish';
import { DOCUMENT_FONTS_DIR } from '../../../../src/integrations/documents/java-runtime';
import { inspectDocument } from '../../../../src/integrations/documents/inspect';
import { resolveJavaRuntime } from '../../../../src/integrations/documents/java-runtime';
import { applyDeclarations } from '../../../../src/domain/document-answers';
import { contentChanges, type DocumentStructure } from '../../../../src/domain/document-structure';
import { renderPdf } from '../../../../src/integrations/browser/render-pdf';

/**
 * The first stage that writes a file, held to the claim it makes about itself.
 *
 * `Finish.java`'s header says: "No structure element is created, moved,
 * re-parented or altered." Nothing has ever checked that. It is the difference
 * between a repair that is safe to deliver and one that quietly deletes
 * meaning, and it is checkable now that `Inspect` has graduated — read the
 * document, repair it, read it again, and compare.
 *
 * This is how a repair gets verified without ground truth, which matters
 * because a client's document has none.
 */

const runtime = resolveJavaRuntime();

describe.skipIf(!runtime.available)('Finish against a real JVM', () => {
  let dir: string;
  let source: string;
  let before: DocumentStructure;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ada-finish-'));
    source = join(dir, 'source.pdf');

    // TAGGED, and that is the whole point of the fixture. An untagged PDF
    // reports zero structure elements and empty arrays for headings, tables,
    // lists and reading order — so `contentChanges` against one would be
    // asserting that empty stays empty, which is no assertion at all. This
    // carries an H1, a header cell, a list and a reading order to preserve.
    await writeFile(
      source,
      await renderPdf(
        '<title>Planning Committee</title><h1>Planning Committee</h1>' +
          '<p>Apologies for absence were received.</p>' +
          '<table><tr><th>Item</th><td>One</td></tr></table>' +
          '<ul><li>First</li><li>Second</li></ul>',
        { tagged: true },
      ),
    );

    const read = await inspectDocument(source);
    if (!read.ok) expect.unreachable(`could not read the source: ${JSON.stringify(read.failure)}`);
    else before = read.value;
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('writes the language it was given', async () => {
    const out = join(dir, 'welsh.pdf');
    const result = await finishDocument({ inputPath: source, outputPath: out, language: 'cy-GB' });

    expect(result.ok).toBe(true);
    expect(existsSync(out)).toBe(true);

    const after = await inspectDocument(out);
    expect(after.ok).toBe(true);
    if (after.ok) {
      // Not `en`. The tag the caller supplied, unaltered — a stage that
      // normalised or defaulted this would be stating something the caller
      // never said.
      expect(after.value.lang).toBe('cy-GB');
    }
  });

  it('has real structure to preserve, or the next test proves nothing', () => {
    // Guards the guard. If the fixture ever silently stops being tagged, the
    // invariant below would keep passing while checking nothing.
    expect(before.structureElements).toBeGreaterThan(0);
    expect(before.headings.length).toBeGreaterThan(0);
    expect(before.tables.length).toBeGreaterThan(0);
    expect(before.order.length).toBeGreaterThan(0);
  });

  it('changes no content field — the claim in its own header', async () => {
    const out = join(dir, 'finished.pdf');
    const result = await finishDocument({ inputPath: source, outputPath: out, language: 'en-GB' });
    expect(result.ok).toBe(true);

    const after = await inspectDocument(out);
    if (!after.ok) {
      expect.unreachable(`could not read the output: ${JSON.stringify(after.failure)}`);
      return;
    }

    // The whole safety argument, in one assertion. Anything in this list means
    // a metadata pass altered what the document says, and the message names
    // exactly which field so the failure is diagnosable rather than mysterious.
    expect(contentChanges(before, after.value)).toEqual([]);
  });

  it('leaves an untitled document untitled rather than inventing one', async () => {
    // A title copied from DocInfo is transcription; a title built from the
    // first line of body text is invention, and it is the same mistake as
    // guessing at alt text. An untitled document should stay untitled and fail
    // 7.1-9 visibly.
    const untitled = join(dir, 'untitled-source.pdf');
    await writeFile(
      untitled,
      await renderPdf('<h1>No title element at all.</h1><p>Body.</p>', { tagged: true }),
    );

    const read = await inspectDocument(untitled);
    if (!read.ok) {
      expect.unreachable('could not read the untitled source');
      return;
    }

    const out = join(dir, 'untitled-finished.pdf');
    expect((await finishDocument({ inputPath: untitled, outputPath: out, language: 'en' })).ok).toBe(
      true,
    );

    const after = await inspectDocument(out);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value.title).toBe(read.value.title);
      expect(contentChanges(read.value, after.value)).toEqual([]);
    }
  });

  /**
   * A title carrying a character XML forbids outright.
   *
   * XML 1.0 admits no C0 control other than tab, newline and carriage return —
   * not even as a numeric character reference — so one in a title produced an
   * XMP packet that is not well-formed XML. veraPDF then fails the delivered
   * file for a metadata reason this vocabulary cannot name, and it reaches the
   * client as a bare clause id in the catch-all.
   *
   * The title is never ours: it is copied from a heading in the client's
   * document, or on the repair path read straight out of the document's own
   * info dictionary, and nothing validates it anywhere. `Finish` is the
   * boundary where it has to be made safe.
   *
   * Asserted as the property rather than by parsing: this project has no XML
   * parser and one assertion does not justify adding a dependency. "Contains
   * no character XML forbids" is exactly the invariant that was broken.
   */
  it('writes a well-formed XMP packet when the title carries a control character', async () => {
    const source = join(dir, 'control-char-source.pdf');
    await writeFile(source, await renderPdf('<h1>Notice</h1><p>Body.</p>', { tagged: true }));

    const out = join(dir, 'control-char-finished.pdf');
    const result = await finishDocument({
      inputPath: source,
      outputPath: out,
      language: 'en',
      title: 'Notice\u0001 of Meeting',
    });
    expect(result.ok).toBe(true);

    const bytes = await readFile(out);
    const text = bytes.toString('latin1');
    const start = text.indexOf('<x:xmpmeta');
    const end = text.indexOf('</x:xmpmeta>');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const packet = text.slice(start, end + '</x:xmpmeta>'.length);

    // Dropped, not replaced: substituting a visible character would put
    // something in the client's title their document never said.
    expect(packet).toContain('Notice of Meeting');
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(packet)).toBe(false);
  });

  /**
   * A minimal PDF whose DocInfo names an author.
   *
   * Hand-written because nothing in the toolchain sets `/Author`: `renderPdf`
   * is Chromium and does not, and PDFBox's CLI has no metadata setter. The
   * same approach `java-inspect.test.ts` uses for its signature fixture, and
   * for the same reason — what is under test is whether `Finish` CARRIES the
   * field, not how it got there.
   */
  function authoredPdf(author: string): Buffer {
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
      '<< /Length 36 >>\nstream\nBT /F1 12 Tf 20 100 Td (notice) Tj ET\nendstream',
      `<< /Author (${author}) /Title (Planning Notice) >>`,
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
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  }

  /**
   * The author survives the repair.
   *
   * `setMetadata` REPLACES the whole XMP packet, so everything a document
   * declared there is gone unless it is written again. `[V]` 35 of the 52 real
   * PDFs in the blind corpus declare `dc:creator`, and every repair dropped
   * it — losing the author of a municipal record while fixing its
   * accessibility is an edit to somebody's document that nothing discloses and
   * `contentChanges` cannot see, because metadata is not a content field.
   *
   * Carried from DocInfo, which this pass preserves, rather than by parsing
   * and merging the old packet: DocInfo is already the source of truth for the
   * title here, and a bad merge writes WRONG metadata where a rebuild writes
   * none.
   */
  it('keeps the author the source declared', async () => {
    const source = join(dir, 'authored-source.pdf');
    await writeFile(source, authoredPdf('Borough Clerk'));

    const out = join(dir, 'authored-finished.pdf');
    expect((await finishDocument({ inputPath: source, outputPath: out, language: 'en' })).ok).toBe(true);

    const packet = (await readFile(out)).toString('latin1');
    expect(packet).toContain('<dc:creator>');
    expect(packet).toContain('Borough Clerk');
  });

  it('does not invent an author for a document that declares none', async () => {
    // The other half of the rule, and the one that matters more: a rebuilt
    // packet must not gain a field the document never had.
    const source = join(dir, 'unauthored-source.pdf');
    await writeFile(source, await renderPdf('<h1>Notice</h1><p>Body.</p>', { tagged: true }));

    const out = join(dir, 'unauthored-finished.pdf');
    expect((await finishDocument({ inputPath: source, outputPath: out, language: 'en' })).ok).toBe(true);

    expect((await readFile(out)).toString('latin1')).not.toContain('<dc:creator>');
  });

  it('removes a language claim when the source declared none', async () => {
    // `[V]` The measurement behind this: LibreOffice writes /Lang as `en-US`
    // onto a PDF exported from a source with EVERY fo:language declaration
    // stripped out. That is a statement the document never made, and carrying
    // it forward would make our own toolchain the thing asserting it.
    //
    // `language: null` is how a caller says "the source declares none". The
    // result fails 7.2-34 visibly, which a reviewer can see — rather than
    // asserting a language nobody chose, which no reader can.
    const withLang = join(dir, 'has-lang.pdf');
    expect(
      (await finishDocument({ inputPath: source, outputPath: withLang, language: 'en-GB' })).ok,
    ).toBe(true);
    const before = await inspectDocument(withLang);
    expect(before.ok && before.value.lang).toBe('en-GB');

    const cleared = join(dir, 'no-lang.pdf');
    expect(
      (await finishDocument({ inputPath: withLang, outputPath: cleared, language: null })).ok,
    ).toBe(true);

    const after = await inspectDocument(cleared);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value.lang).toBeNull();
      // Removing a claim must not remove content.
      if (before.ok) expect(contentChanges(before.value, after.value)).toEqual([]);
    }
  });

  /**
   * The guard that lets this stage be pointed at a client's own PDF.
   *
   * `Marked true` says "this document is tagged". Written onto a document with
   * no structure tree it is an assertion we manufactured — invisible to a
   * reader, and enough to make a machine checker report success. The stage now
   * only makes the claim a document has earned.
   */
  describe('on a document with no structure tree', () => {
    let untagged: string;

    beforeAll(async () => {
      untagged = join(dir, 'untagged-source.pdf');
      await writeFile(
        untagged,
        await renderPdf('<title>Fee Schedule</title><h1>Fee Schedule</h1><p>Body.</p>', {
          tagged: false,
        }),
      );
    });

    it('is genuinely untagged, or the assertions below prove nothing', async () => {
      const read = await inspectDocument(untagged);
      if (!read.ok) expect.unreachable('could not read the untagged fixture');
      else expect(read.value.structureElements).toBe(0);
    });

    it('does not claim the document is tagged', async () => {
      const out = join(dir, 'untagged-finished.pdf');
      const result = await finishDocument({
        inputPath: untagged,
        outputPath: out,
        language: 'en-GB',
      });
      expect(result.ok).toBe(true);

      const after = await inspectDocument(out);
      if (!after.ok) expect.unreachable('could not read the output');
      else {
        // The claim, read back from MarkInfo. A byte search cannot see this:
        // PDFBox writes the catalog into a compressed object stream, so
        // `/Marked true` never appears as text — an earlier version of this
        // test looked for it, passed against the unguarded stage, and proved
        // nothing.
        expect(after.value.marked).toBe(false);
        // And the honest facts are still written — the guard narrows one
        // claim, it does not turn the stage off.
        expect(after.value.lang).toBe('en-GB');
        expect(after.value.structureElements).toBe(0);
      }
    });

    it('agrees with Inspect about what tagged means, on both fixtures', async () => {
      // Two implementations of one definition — `Finish`'s local check and
      // `Inspect`'s element count — so the drift between them is what gets
      // tested. If either changes its mind about an empty tree, this fails.
      const taggedOut = join(dir, 'agree-tagged.pdf');
      const untaggedOut = join(dir, 'agree-untagged.pdf');
      await finishDocument({ inputPath: source, outputPath: taggedOut, language: 'en' });
      await finishDocument({ inputPath: untagged, outputPath: untaggedOut, language: 'en' });

      const taggedRead = await inspectDocument(taggedOut);
      const untaggedRead = await inspectDocument(untaggedOut);

      if (!taggedRead.ok || !untaggedRead.ok) {
        expect.unreachable('could not read one of the outputs');
        return;
      }
      expect(taggedRead.value.marked).toBe(taggedRead.value.structureElements > 0);
      expect(untaggedRead.value.marked).toBe(untaggedRead.value.structureElements > 0);
    });
  });

  /**
   * A CID font whose FontDescriptor carries a CIDSet stream.
   *
   * Hand-built because the alternative does not exist: `renderPdf` emits
   * CIDFontType2 subsets with embedded programs but writes NO CIDSet, so a
   * rendered fixture would assert nothing. `[V]` Measured on a rendered PDF —
   * 2 CIDFontType2, 2 FontFile2, 0 CIDSet.
   *
   * The chain is complete rather than a bare dictionary with the key on it —
   * page resources → Type0 → DescendantFonts → FontDescriptor → CIDSet — so
   * the test still means something if the walk is ever reimplemented.
   */
  /**
   * A PDF's dictionary keys, including the ones inside compressed object
   * streams.
   *
   * A raw byte search is not good enough and the failure is silent both ways:
   * PDFBox writes objects into `/ObjStm`, so searching the file text finds
   * neither the key that was removed nor the font that was kept, and an
   * assertion either way passes for the wrong reason. `[V]` The first version
   * of this test asserted on raw bytes; `/CIDSet` was "absent" and
   * `/CIDFontType2` was too, in a document that still had the font.
   */
  async function pdfKeys(path: string): Promise<string> {
    const bytes = await readFile(path);
    const parts = [bytes.toString('latin1')];
    const marker = /stream\r?\n/g;
    let match: RegExpExecArray | null;
    while ((match = marker.exec(bytes.toString('latin1'))) !== null) {
      const start = match.index + match[0].length;
      const end = bytes.indexOf('endstream', start, 'latin1');
      if (end < 0) continue;
      try {
        parts.push(inflateSync(bytes.subarray(start, end)).toString('latin1'));
      } catch {
        // Not every stream is deflate — images, the CIDSet itself. Skipped
        // rather than failed: this helper reads what it can.
      }
    }
    return parts.join('\n');
  }

  function cidSetPdf(embeddedNoMap = false): Buffer {
    const content = 'BT /F1 12 Tf 20 100 Td <0001> Tj ET';
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R'
        + ' /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+TestFont /Encoding /Identity-H'
        + ' /DescendantFonts [6 0 R] >>',
      '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ABCDEF+TestFont'
        + ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>'
        // The rider's shape drops the map an embedded CIDFontType2 must
        // carry; the original keeps it, so the CIDSet test proves removal
        // never touches a map that exists.
        + ` /FontDescriptor 7 0 R${embeddedNoMap ? '' : ' /CIDToGIDMap /Identity'} /DW 1000 >>`,
      '<< /Type /FontDescriptor /FontName /ABCDEF+TestFont /Flags 4'
        + ' /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 1000 /Descent 0'
        + ` /CapHeight 1000 /StemV 80 /CIDSet 8 0 R${embeddedNoMap ? ' /FontFile2 8 0 R' : ''} >>`,
      '<< /Length 2 >>\nstream\n\xc0\x00\nendstream',
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

  it('drops a CIDSet that indexes an embedded font, keeping the font', async () => {
    // UA-1 7.21.4.2-2, which four of twenty real municipal PDFs fail: the
    // font IS embedded and a producer wrote an index of it that does not
    // match. Removed rather than regenerated, for the reason /Lang is cleared
    // rather than guessed — we do not carry forward a claim we cannot stand
    // behind, and CIDSet is optional in PDF/UA.
    const source = join(dir, 'cidset-source.pdf');
    const out = join(dir, 'cidset-finished.pdf');
    await writeFile(source, cidSetPdf());

    const result = await finishDocument({ inputPath: source, outputPath: out, language: 'en' });
    expect(result.ok).toBe(true);

    expect(await pdfKeys(source)).toContain('/CIDSet');
    const keys = await pdfKeys(out);
    expect(keys).not.toContain('/CIDSet');
    // The font survives — this removes an index, never a glyph source.
    expect(keys).toContain('/CIDFontType2');
  });

  it('states the CIDToGIDMap default an embedded CIDFontType2 must carry', async () => {
    // UA-1 7.21.3.2-1. ISO 32000 defines the absent value as Identity, so
    // writing /Identity states the default every reader already applies —
    // zero semantic change, one clause honestly closed. Only onto an EMBEDDED
    // font: on an unembedded one the map is not the problem.
    const source = join(dir, 'cidmap-source.pdf');
    const out = join(dir, 'cidmap-finished.pdf');
    await writeFile(source, cidSetPdf(true));

    expect(await pdfKeys(source)).not.toContain('/CIDToGIDMap');
    expect((await finishDocument({ inputPath: source, outputPath: out, language: 'en' })).ok).toBe(true);
    expect(await pdfKeys(out)).toContain('/CIDToGIDMap /Identity');
  });

  it('leaves a document with no CID fonts alone', async () => {
    // The guard against a walk that damages what it does not understand.
    const out = join(dir, 'no-cid-fonts.pdf');
    const result = await finishDocument({ inputPath: source, outputPath: out, language: 'en-GB' });
    expect(result.ok).toBe(true);

    const after = await inspectDocument(out);
    if (!after.ok) expect.unreachable('could not read the output');
    // Still the same document: structure preserved, claims still written.
    else {
      expect(contentChanges(before, after.value)).toEqual([]);
      expect(after.value.lang).toBe('en-GB');
    }
  });

  /**
   * A tagged PDF with two internal links: one over text, one over nothing.
   *
   * Hand-built because nothing in the toolchain emits this shape. `renderPdf`
   * is Chromium, whose `<a href="#x">` does not produce a `/Link` structure
   * element wrapping an `/OBJR`, and the corpus's own `p30-link-outside-
   * structure` builds the opposite case on purpose — a link that is NOT in the
   * tree. What is under test is the pairing: an annotation reachable from the
   * structure element whose text describes it.
   *
   * Both links carry a `/Dest` and no `/A`, which is what a Word table of
   * contents exports as and what `linkUri` returns null for.
   */
  function internallyLinkedPdf(): Buffer {
    const stream = 'BT /F1 12 Tf 20 100 Td /Link <</MCID 0>> BDC (Budget Section) Tj EMC ET';
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 6 0 R /MarkInfo << /Marked true >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R'
        + ' /Resources << /Font << /F1 5 0 R >> >> /Annots [8 0 R 9 0 R] /StructParents 0 >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Type /StructTreeRoot /K [7 0 R] >>',
      '<< /Type /StructElem /S /Document /P 6 0 R /K [10 0 R 11 0 R] >>',
      // Over the text. `/Dest`, never `/A`, so there is no URI to transcribe.
      '<< /Type /Annot /Subtype /Link /Rect [20 100 200 120] /F 4 /Dest [3 0 R /XYZ 0 0 0] /StructParent 1 >>',
      // Over nothing — the image-link case. Its structure element references
      // the annotation and no marked content, so there is no text to read.
      '<< /Type /Annot /Subtype /Link /Rect [20 40 60 60] /F 4 /Dest [3 0 R /XYZ 0 0 0] /StructParent 2 >>',
      '<< /Type /StructElem /S /Link /P 7 0 R /Pg 3 0 R /K [0 12 0 R] >>',
      '<< /Type /StructElem /S /Link /P 7 0 R /Pg 3 0 R /K [13 0 R] >>',
      '<< /Type /OBJR /Obj 8 0 R >>',
      '<< /Type /OBJR /Obj 9 0 R >>',
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

  /**
   * `[V]` The measured shape this exists for: one real delivered document
   * carries 70 link annotations, 35 with a URI and described by the pass above,
   * and 35 with a direct `/Dest` — a Word table of contents — described by
   * nothing. Both `7.18.5-2` and `7.18.1-2` failed on it, and on a second
   * document whose ONLY remaining failures were those two.
   */
  it('describes an internal link with the text the link itself displays', async () => {
    const source = join(dir, 'internal-links.pdf');
    await writeFile(source, internallyLinkedPdf());

    const out = join(dir, 'internal-links-finished.pdf');
    expect((await finishDocument({ inputPath: source, outputPath: out, language: 'en' })).ok).toBe(true);

    // Through `pdfKeys`, not the raw bytes: PDFBox saves with object streams,
    // so every dictionary in the output is deflated and a plain byte search
    // finds nothing — including the page's own `/Contents`. A first version of
    // this test read the raw file and reported the fix missing when it had
    // worked.
    expect(await pdfKeys(out)).toContain('/Contents (Budget Section)');
  });

  it('leaves a link with no text to transcribe silent, rather than naming it', async () => {
    // The half that matters more. A link over an image has nothing the
    // document says about it, and the honest output is the punch item asking a
    // person for a description — not a name we made up from a destination.
    const source = join(dir, 'internal-links-2.pdf');
    await writeFile(source, internallyLinkedPdf());

    const out = join(dir, 'internal-links-2-finished.pdf');
    expect((await finishDocument({ inputPath: source, outputPath: out, language: 'en' })).ok).toBe(true);

    // Exactly one of the two links is described: the one with words.
    expect((await pdfKeys(out)).split('/Contents (').length - 1).toBe(1);
  });

  /**
   * A tagged PDF with one Figure per entry, carrying the given /Alt (or none),
   * in tree order. Hand-built like the ladder below: the thing under test is
   * WHICH figure a declared description lands on, so the ordinals have to be
   * known exactly rather than left to an exporter.
   */
  function figuresPdf(alts: Array<string | null>): Buffer {
    const stream = alts
      .map((_, i) => `/Figure <</MCID ${i}>> BDC 20 ${150 - i * 30} 40 20 re f EMC`)
      .join('\n');
    const kids = alts.map((_, i) => `${6 + i} 0 R`).join(' ');
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 5 0 R /MarkInfo << /Marked true >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /StructParents 0 >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      `<< /Type /StructTreeRoot /K [${kids}] >>`,
    ];
    alts.forEach((alt, i) => {
      objs.push(
        `<< /Type /StructElem /S /Figure /P 5 0 R /Pg 3 0 R /K ${i}${alt === null ? '' : ` /Alt (${alt})`} >>`,
      );
    });

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

  /**
   * The declared-change channel's one write: a person's description, onto
   * the figure THEY described and no other.
   *
   * The ordinal is the position in `Inspect`'s own walk, and both stages
   * walk through the same `FigureOrder` helper — but the property is asserted
   * rather than trusted: the alt lands at ordinal n and Inspect reads it back
   * at n, every other figure is untouched, and an ordinal the document does
   * not have writes nothing at all.
   */
  it('writes a declared description onto the named figure and no other', async () => {
    const source = join(dir, 'figures.pdf');
    await writeFile(source, figuresPdf([null, null, 'The town seal']));
    const out = join(dir, 'figures-declared.pdf');

    const finished = await finishDocument({
      inputPath: source,
      outputPath: out,
      language: 'en',
      alt: [{ ordinal: 1, text: 'A map of the town centre — café marked' }],
    });
    expect(finished.ok).toBe(true);

    const after = await inspectDocument(out);
    if (!after.ok) expect.unreachable('could not read the output');
    else {
      expect(after.value.figures.map((figure) => figure.alt)).toEqual([
        null,
        'A map of the town centre — café marked',
        'The town seal',
      ]);
      // Nothing but the declared delta moved — the delta as the pipeline's
      // gate computes it, through the same function, so this test and the
      // gate cannot disagree about what a declaration is allowed to change.
      const read = await inspectDocument(join(dir, 'figures.pdf'));
      if (read.ok) {
        const expected = applyDeclarations(read.value, {
          inputSha256: 'a'.repeat(64),
          figures: [{ ordinal: 1, type: 'Figure', page: 1, prior: 'absent', alt: 'A map of the town centre — café marked' }],
        });
        expect(expected.ok).toBe(true);
        if (expected.ok) expect(contentChanges(expected.structure, after.value)).toEqual([]);
      }
    }
  });

  it('refuses an ordinal the document does not have, and writes nothing', async () => {
    const source = join(dir, 'figures-short.pdf');
    await writeFile(source, figuresPdf([null]));
    const out = join(dir, 'figures-short-declared.pdf');

    const finished = await finishDocument({
      inputPath: source,
      outputPath: out,
      language: 'en',
      alt: [{ ordinal: 4, text: 'x' }],
    });
    expect(finished.ok).toBe(false);
    expect(existsSync(out)).toBe(false);
  });

  /**
   * A tagged PDF whose headings sit at the given levels, one text run each.
   *
   * Hand-built for the same reason as `internallyLinkedPdf`: the shape under
   * test is the exporter's — a ladder parked below H1, or a skip — and
   * Chromium normalises headings on its own. `mapVia` swaps the elements'
   * own /S for a custom name and adds a RoleMap entry resolving it, which is
   * the shape the re-rank must refuse.
   */
  function headingLadderPdf(levels: string[], mapVia?: string): Buffer {
    const stream = levels
      .map((level, i) => {
        const tag = mapVia === 'AWAY' ? level : (mapVia ?? level);
        return `BT /F1 12 Tf 20 ${160 - i * 20} Td /${tag} <</MCID ${i}>> BDC (Item ${i + 1}) Tj EMC ET`;
      })
      .join('\n');
    const kids = levels.map((_, i) => `${7 + i} 0 R`).join(' ');
    const roleMap = mapVia === 'AWAY'
      ? ` /RoleMap << /${levels[levels.length - 1]} /P >>`
      : mapVia ? ` /RoleMap << /${mapVia} /${levels[0]} >>` : '';
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R /StructTreeRoot 6 0 R /MarkInfo << /Marked true >> >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R'
        + ' /Resources << /Font << /F1 5 0 R >> >> /StructParents 0 >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Type /StructTreeRoot /K [7 0 R]${roleMap} >>`,
    ];
    // A Document root would be truer to life, but a flat tree keeps the
    // object count readable and the walk under test is recursive either way.
    objs[5] = `<< /Type /StructTreeRoot /K [${kids}]${roleMap} >>`;
    levels.forEach((level, i) => {
      const s = mapVia === 'AWAY' ? level : (mapVia ?? level);
      objs.push(`<< /Type /StructElem /S /${s} /P 6 0 R /Pg 3 0 R /K ${i} >>`);
    });

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

  async function finishedHeadings(name: string, levels: string[], renumber: boolean): Promise<string[]> {
    const source = join(dir, `${name}.pdf`);
    await writeFile(source, headingLadderPdf(levels));
    const out = join(dir, `${name}-finished.pdf`);
    const finished = await finishDocument(
      { inputPath: source, outputPath: out, language: 'en', renumberHeadings: renumber },
    );
    expect(finished.ok).toBe(true);
    const after = await inspectDocument(out);
    if (!after.ok) expect.unreachable('could not read the output');
    return after.ok ? after.value.headings : [];
  }

  /**
   * `[V]` The measured shape the standing policy exists for: both real Word
   * documents failing 7.4.2-1 are a FLAT ladder the exporter parked below H1
   * — 19×H2 and 49×H3. One authored level, wrongly seated.
   */
  it('re-ranks a flat deep ladder onto H1 under the standing policy', async () => {
    expect(await finishedHeadings('deep-flat', ['H2', 'H2', 'H2'], true))
      .toEqual(['H1', 'H1', 'H1']);
  });

  it('closes a skip while keeping authored levels DISTINCT', async () => {
    // Rank-preserving, never merging: H1-then-H3 becomes H1-then-H2. If this
    // ever comes back ['H1','H1'], the policy has started deciding which of
    // two authored levels was the mistake, which is the punch list's question.
    expect(await finishedHeadings('skip', ['H1', 'H3'], true)).toEqual(['H1', 'H2']);
  });

  it('changes no heading without the flag — the repair lane never asks', async () => {
    expect(await finishedHeadings('untouched', ['H2', 'H2'], false)).toEqual(['H2', 'H2']);
  });

  it('refuses to renumber a heading reached through the RoleMap', async () => {
    // The element's own /S is not the name a reader resolves, and rewriting
    // /S underneath a live mapping trades one lie for another. The punch item
    // survives instead.
    const source = join(dir, 'rolemapped.pdf');
    await writeFile(source, headingLadderPdf(['H2', 'H2'], 'Kop2'));
    const out = join(dir, 'rolemapped-finished.pdf');
    expect((await finishDocument(
      { inputPath: source, outputPath: out, language: 'en', renumberHeadings: true },
    )).ok).toBe(true);

    const keys = await pdfKeys(out);
    expect(keys).toContain('/Kop2');
    expect(keys).not.toContain('/H1');
  });

  it('refuses to renumber when the RoleMap resolves a heading AWAY', async () => {
    // r34's shape, and the wave run's one invented claim: elements whose own
    // /S is H-named while the RoleMap resolves them to P. Re-ranking H3 to H2
    // — a name the map does not cover — MANUFACTURED six headings the reader
    // never had, on a delivered document, invisibly to veraPDF because the
    // invented ladder was valid. The whole remap is refused instead.
    const source = join(dir, 'mapped-away.pdf');
    await writeFile(source, headingLadderPdf(['H1', 'H3'], 'AWAY'));
    const out = join(dir, 'mapped-away-finished.pdf');
    expect((await finishDocument(
      { inputPath: source, outputPath: out, language: 'en', renumberHeadings: true },
    )).ok).toBe(true);

    const keys = await pdfKeys(out);
    expect(keys).toContain('/S /H3');
    expect(keys).not.toContain('/S /H2');
  });

  /**
   * A TrueType font a producer named and never embedded — the measured shape
   * carried by 17 of the 19 real documents failing 7.21.4.1-1: a Windows
   * metric-clone BaseFont, WinAnsi encoding, full /Widths, a descriptor with
   * no FontFile*.
   */
  function unembeddedFontPdf(widths: string, flags: number): Buffer {
    const stream = 'BT /F1 12 Tf 20 100 Td (AB) Tj ET';
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R'
        + ' /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      '<< /Type /Font /Subtype /TrueType /BaseFont /ArialMT /FirstChar 65 /LastChar 66'
        + ` /Widths [${widths}] /Encoding /WinAnsiEncoding /FontDescriptor 6 0 R >>`,
      `<< /Type /FontDescriptor /FontName /ArialMT /Flags ${flags} /FontBBox [0 0 1000 1000]`
        + ' /ItalicAngle 0 /Ascent 728 /Descent -210 /CapHeight 716 /StemV 88 >>',
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

  const fontsDir = join(process.cwd(), DOCUMENT_FONTS_DIR);

  async function finishedWithFonts(name: string, fixture: Buffer, embed: boolean): Promise<string> {
    const source = join(dir, `${name}.pdf`);
    await writeFile(source, fixture);
    const out = join(dir, `${name}-finished.pdf`);
    const finished = await finishDocument({
      inputPath: source,
      outputPath: out,
      language: 'en',
      ...(embed ? { embedFontsDir: fontsDir } : {}),
    });
    expect(finished.ok).toBe(true);
    return pdfKeys(out);
  }

  it('embeds a metric-identical program for a font the producer only named', async () => {
    // Arial 'A' and 'B' are 667/1000 em, and `[V]` Liberation Sans measures
    // 666.99 for both — inside the guard's 0.5. The write is ONE key: the
    // descriptor gains a FontFile2 carrying its uncompressed Length1;
    // BaseFont, Encoding, /Widths and the content stream are untouched, which
    // is why layout provably cannot move.
    const keys = await finishedWithFonts('embed-exact', unembeddedFontPdf('667 667', 32), true);

    expect(keys).toContain('/FontFile2');
    expect(keys).toContain('/Length1');
  });

  it('refuses the same font over ONE mismatched width', async () => {
    // 700 where Liberation Sans measures 667. A replacement that changes an
    // advance moves the client's layout, so the guard refuses the whole font
    // and the 7.21.4 punch item keeps voicing it — the state before this pass
    // existed.
    const keys = await finishedWithFonts('embed-mismatch', unembeddedFontPdf('700 667', 32), true);

    expect(keys).not.toContain('/FontFile2');
  });

  it('refuses a symbolic font, whatever its widths say', async () => {
    // Flag bit 3: the encoding is defined by the font program we do not have,
    // so no width table can prove the replacement draws the same characters.
    const keys = await finishedWithFonts('embed-symbolic', unembeddedFontPdf('667 667', 4), true);

    expect(keys).not.toContain('/FontFile2');
  });

  it('embeds nothing without the directory — absence is the safe direction', async () => {
    const keys = await finishedWithFonts('embed-off', unembeddedFontPdf('667 667', 32), false);

    expect(keys).not.toContain('/FontFile2');
  });

  it('fails cleanly on a file that is not a PDF, writing nothing', async () => {
    const notPdf = join(dir, 'not-a.pdf');
    await writeFile(notPdf, 'this is not a PDF');
    const out = join(dir, 'never-written.pdf');

    const result = await finishDocument({ inputPath: notPdf, outputPath: out, language: 'en' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('failed');
    // A stage that failed must not leave a half-written document behind for
    // somebody to pick up and deliver.
    expect(existsSync(out)).toBe(false);
  });
});
