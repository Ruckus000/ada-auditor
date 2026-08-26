import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { convertSourceToPdf } from '../../../../src/integrations/documents/convert';
import { resolveLibreOffice } from '../../../../src/integrations/documents/libreoffice-runtime';
import { resolveJavaRuntime } from '../../../../src/integrations/documents/java-runtime';

const execFileAsync = promisify(execFile);

/**
 * A real Word source through the real chain.
 *
 * The whole claim of the source path is that it **transcribes** — the author's
 * headings, title and lists come out the other side because they went in, not
 * because anything inferred them. That is only testable against a source that
 * actually has them.
 *
 * ## The fixture, and why it is built this way
 *
 * This repository tracks zero binaries, so the `.docx` is generated at test
 * time. It is seeded from a hand-written flat ODF rather than from HTML, and
 * that detail is load-bearing: `[V]` an HTML-derived source loses its heading
 * styles on import — the Writer/Web RoleMap artefact the research recorded —
 * so a fixture built that way produces zero headings and this test would assert
 * that nothing survives nothing. Seeding from ODF produces genuine `Heading1`
 * and `Heading2` styles, which is what a real municipal `.docx` carries.
 */

const soffice = resolveLibreOffice();
const java = resolveJavaRuntime();
const skip = !soffice.available || !java.available;

const SEED = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
<office:meta><dc:title>Planning Committee Agenda</dc:title></office:meta>
<office:body><office:text>
<text:h text:outline-level="1">Planning Committee Agenda</text:h>
<text:p>Apologies for absence were received.</text:p>
<text:h text:outline-level="2">Declarations of Interest</text:h>
<text:list><text:list-item><text:p>First item</text:p></text:list-item><text:list-item><text:p>Second item</text:p></text:list-item></text:list>
</office:text></office:body></office:document>`;

describe.skipIf(skip)('a Word source through the real chain', () => {
  let dir: string;
  let docx: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ada-soffice-'));
    const seed = join(dir, 'seed.fodt');
    await writeFile(seed, SEED, 'utf8');

    if (!soffice.available) return;
    await execFileAsync(soffice.sofficeBin, [
      '--headless',
      `-env:UserInstallation=${pathToFileURL(join(dir, 'profile')).href}`,
      '--convert-to',
      'docx:MS Word 2007 XML',
      '--outdir',
      dir,
      seed,
    ]);
    docx = join(dir, 'seed.docx');
  }, 180_000);

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('produced a fixture that actually has something to preserve', () => {
    // Guards the guard, for the reason the untagged-PDF fixture taught: a test
    // that asserts preservation against a source with nothing in it passes
    // while proving nothing.
    expect(existsSync(docx)).toBe(true);
  });

  it('carries the author\'s structure into a tagged PDF', async () => {
    const out = join(dir, 'out.pdf');
    const result = await convertSourceToPdf(docx, out);

    if (!result.ok) {
      expect.unreachable(`conversion failed: ${JSON.stringify(result.failure)}`);
      return;
    }

    const { structure, title } = result.provenance;

    // Tagged. This is the assertion that catches a mistyped filter option,
    // which produces an untagged PDF at exit 0 that is otherwise
    // indistinguishable from success.
    expect(structure.structureElements).toBeGreaterThan(0);

    // Transcribed, not inferred: both heading levels the source declared.
    expect(structure.headings).toEqual(['H1', 'H2']);
    // The list the source declared, with both its items.
    expect(structure.lists).toEqual([{ depth: 1, items: 2 }]);

    // The title was already in the source, so it is carried rather than copied
    // from a heading — and the distinction is recorded rather than flattened.
    expect(title).toEqual({ kind: 'already-titled', title: 'Planning Committee Agenda' });
    expect(structure.title).toBe('Planning Committee Agenda');
  });

  it('reports a language that matches what the source declared', async () => {
    const out = join(dir, 'lang.pdf');
    const result = await convertSourceToPdf(docx, out);

    if (!result.ok) {
      expect.unreachable(`conversion failed: ${JSON.stringify(result.failure)}`);
      return;
    }

    // The point is agreement, not a particular tag. The exporter's own guess is
    // discarded and the source's declaration reapplied, so these cannot drift.
    expect(result.provenance.structure.lang).toBe(result.provenance.sourceLanguage);
  });

  it('fails on a source that is not there', async () => {
    const result = await convertSourceToPdf(join(dir, 'absent.docx'), join(dir, 'absent.pdf'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Either soffice refuses, or it exits 0 having written nothing. Both are
      // real behaviours of this tool and both have to be caught.
      expect(['no-output', 'converter-failed']).toContain(result.failure.kind);
    }
  });

  it('converts a mislabelled file rather than rejecting it — so callers must validate input', async () => {
    // `[V]` Discovered by this test failing when it assumed the opposite.
    // LibreOffice sniffs content rather than trusting the extension, so a text
    // file named `.docx` is converted as a text document and succeeds.
    //
    // Recorded as behaviour rather than "fixed", because it is not ours to fix
    // and pretending otherwise would hide it. The consequence is what matters:
    // **a successful conversion is not evidence that the input was a Word
    // document.** Anything that accepts uploads has to check the input itself;
    // it cannot delegate that to the converter.
    const junk = join(dir, 'junk.docx');
    await writeFile(junk, 'this is not a Word file');
    const out = join(dir, 'junk.pdf');

    const result = await convertSourceToPdf(junk, out);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // It produced a real, tagged document — of the wrong thing.
      expect(result.provenance.structure.structureElements).toBeGreaterThan(0);
      // And nothing was invented to fill the gaps: no heading existed, so no
      // title could be transcribed, and the outcome says so.
      expect(result.provenance.title).toEqual({ kind: 'no-heading-to-copy' });
      expect(result.provenance.structure.title).toBeNull();
    }
  });
});
