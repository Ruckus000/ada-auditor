import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { finishDocument } from '../../../../src/integrations/documents/finish';
import { inspectDocument } from '../../../../src/integrations/documents/inspect';
import { resolveJavaRuntime } from '../../../../src/integrations/documents/java-runtime';
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

  function cidSetPdf(): Buffer {
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
        + ' /FontDescriptor 7 0 R /CIDToGIDMap /Identity /DW 1000 >>',
      '<< /Type /FontDescriptor /FontName /ABCDEF+TestFont /Flags 4'
        + ' /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 1000 /Descent 0'
        + ' /CapHeight 1000 /StemV 80 /CIDSet 8 0 R >>',
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
