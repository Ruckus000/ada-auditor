import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
