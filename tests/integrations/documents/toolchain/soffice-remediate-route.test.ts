import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { zipEntry } from '../../../../src/domain/docx-language';
import { resolveLibreOffice } from '../../../../src/integrations/documents/libreoffice-runtime';
import { resolveJavaRuntime } from '../../../../src/integrations/documents/java-runtime';
import { inspectDocument } from '../../../../src/integrations/documents/inspect';
import { zip } from '../../../support/docx-fixture';

const execFileAsync = promisify(execFile);

/**
 * A real Word document, through the real route, to a real tagged PDF.
 *
 * `documents-remediate.test.ts` mocks the conversion and tests what the route
 * decides. This is the other half: that the decisions and the pipeline actually
 * compose — a `.docx` goes in as multipart form data and PDF bytes come back
 * with the author's structure intact.
 *
 * Only authorisation is stubbed. It is covered in the fast suite and is not what
 * this file is for.
 */

vi.mock('../../../../src/app/api/_lib/authorize', () => ({
  authorizePrincipal: async () => ({ kind: 'machine', name: 'toolchain-test' }),
}));

const { POST } = await import('../../../../src/app/api/documents/remediate/route');

const soffice = resolveLibreOffice();
const java = resolveJavaRuntime();
const skip = !soffice.available || !java.available;

// Named rather than silently skipped, the way `java-inspect.test.ts` does it.
// A suite that skips everything without saying so is indistinguishable from
// one that passed — and now that a core-only LibreOffice reports unavailable
// rather than failing four tests, this is the only thing that says why the
// chain did not run.
if (!soffice.available) {
  console.warn(`document conversion skipped — ${soffice.reason}`);
}
if (!java.available) {
  console.warn(`document conversion skipped — ${java.reason}`);
}

/**
 * Seeded from flat ODF, not HTML.
 *
 * `[V]` An HTML-derived source loses its heading styles on import — the
 * Writer/Web RoleMap artefact — so a fixture built that way carries nothing to
 * preserve, and a test asserting preservation against it passes while proving
 * nothing. That mistake has been made twice in this project.
 */
/**
 * One pixel, so the seed carries a figure with nothing to describe it.
 *
 * The image needs no caption and no `svg:desc`: an undescribed figure is the
 * whole point, because it is what raises the ask a person answers. A caption
 * would let `deriveAltFromCaptions` transcribe one and the figure would arrive
 * already described.
 */
const PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const SEED = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
<office:meta><dc:title>Planning Committee Agenda</dc:title></office:meta>
<office:body><office:text>
<text:h text:outline-level="1">Planning Committee Agenda</text:h>
<text:p>Apologies for absence were received.</text:p>
<text:p><draw:frame draw:name="plan" svg:width="2cm" svg:height="2cm" text:anchor-type="as-char"><draw:image><office:binary-data>${PIXEL_PNG}</office:binary-data></draw:image></draw:frame></text:p>
<text:h text:outline-level="2">Declarations of Interest</text:h>
</office:text></office:body></office:document>`;

describe.skipIf(skip)('POST /api/documents/remediate, end to end', () => {
  let dir: string;
  let docx: Uint8Array;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ada-route-e2e-'));
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
    docx = new Uint8Array(await readFile(join(dir, 'seed.docx')));
  }, 180_000);

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  function upload(bytes: Uint8Array, filename = 'agenda.docx', answers?: unknown): Request {
    const form = new FormData();
    form.set('file', new File([bytes as BlobPart], filename));
    if (answers !== undefined) form.set('answers', JSON.stringify(answers));
    return new Request('http://localhost:3000/api/documents/remediate', {
      method: 'POST',
      body: form,
    });
  }

  it('returns a tagged PDF that kept the author\'s structure', async () => {
    const response = await POST(upload(docx));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');

    const summary = JSON.parse(response.headers.get('x-remediation-summary') ?? '{}');
    expect(summary.tagged).toBe(true);
    // Both levels the source declared — transcribed, not inferred.
    expect(summary.headings).toBe(2);
    expect(summary.title).toBe('already-titled');

    // And the bytes really are that document, not just a plausible header.
    const out = join(dir, 'returned.pdf');
    await writeFile(out, Buffer.from(await response.arrayBuffer()));

    const read = await inspectDocument(out);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.structureElements).toBeGreaterThan(0);
      expect(read.value.headings).toEqual(['H1', 'H2']);
      expect(read.value.title).toBe('Planning Committee Agenda');
    }
  });

  /**
   * The bytes may not claim what the report denies.
   *
   * Computed on a file this run produced, never a grep over a frozen artifact:
   * the defect this exists to catch was `Finish` writing `pdfuaid:part` with no
   * guard, so 49 of 68 delivered documents asserted PDF/UA-1 conformance in
   * their own XMP while the verdict beside them said they did not conform. A
   * consumer reading the metadata — which is how conformance is machine
   * detected — would have believed the file over the report.
   *
   * Asserted as a BICONDITIONAL rather than "no false claims". Only refusing
   * the false direction would pass a build that never wrote the identifier at
   * all, and then nothing could ever be reported as conformant.
   */
  it('asserts PDF/UA-1 in its own XMP only when the checker agrees', async () => {
    const response = await POST(upload(docx));
    expect(response.status).toBe(200);

    const summary = JSON.parse(response.headers.get('x-remediation-summary') ?? '{}');
    const bytes = Buffer.from(await response.arrayBuffer());

    // veraPDF may be absent on a contributor's machine; the claim is only
    // checkable against a verdict, so skip rather than assert half of it.
    if (summary.conformance?.checker !== 'verapdf-ua1') return;

    const out = join(dir, 'identifier.pdf');
    await writeFile(out, bytes);
    // The packet is inside a compressed stream, so a raw scan of the file finds
    // nothing. That is exactly how the defect stayed invisible.
    const flat = join(dir, 'identifier-flat.pdf');
    await execFileAsync('qpdf', [
      '--qdf', '--object-streams=disable', '--decode-level=specialized', out, flat,
    ]).catch(() => undefined);
    const readable = await readFile(flat).catch(() => bytes);
    const claimsUa1 = readable.includes('pdfuaid:part');

    expect(claimsUa1).toBe(summary.conformance.compliant === true);
  }, 180_000);

  /**
   * The case the answers channel never had.
   *
   * Every declared-answers test in this repository supplied a PDF, and every
   * Word test supplied no answers, so the conversion lane's declaration pass
   * was run by nothing. It wrote over the file it was reading, and PDFBox
   * resolves objects lazily, so the save truncated its own source: exit 0, a
   * file that still parsed, a reading quietly degraded, and a `content-changed`
   * refusal describing the damage rather than the cause. Three real documents
   * a person had described were refused that way before anyone looked.
   *
   * A real conversion, a real JVM, and a real description — the only shape that
   * could have caught it.
   */
  it('writes a description a person declared onto a converted Word document', async () => {
    const answers = {
      inputSha256: createHash('sha256').update(docx).digest('hex'),
      figures: [
        { ordinal: 0, type: 'Figure', page: 1, prior: 'absent', alt: 'A site plan of the mill' },
      ],
    };

    const response = await POST(upload(docx, 'agenda.docx', answers));
    expect(response.status).toBe(200);

    const summary = JSON.parse(response.headers.get('x-remediation-summary') ?? '{}');
    expect(summary.declared).toEqual({ figures: 1 });

    // The delivered bytes, read back independently: the description is on the
    // figure, and the document the author wrote is still the document.
    const out = join(dir, 'declared.pdf');
    await writeFile(out, Buffer.from(await response.arrayBuffer()));

    const read = await inspectDocument(out);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.figures.map((figure) => figure.alt)).toEqual(['A site plan of the mill']);
      expect(read.value.headings).toEqual(['H1', 'H2']);
      expect(read.value.title).toBe('Planning Committee Agenda');
    }
  }, 180_000);

  /**
   * A language a person declared, through the source-fidelity gate, on real bytes.
   *
   * The gate compares the delivered PDF against what the `.docx` declares, and
   * a source that declares no language plus a delivered one reads as "something
   * re-invented one" — an assertion, a refused delivery. So the gate has to be
   * told what the operator supplied, or the cheapest answer on the punch list
   * refuses every document it is given. That shipped once, and every test that
   * covered it mocked the conversion; this is the first to put it through
   * LibreOffice, the JVM and `checkFidelity` together.
   *
   * `summary.declared` is asserted first because it is what proves the case is
   * reached at all: the declaration is only consumed where the source declares
   * no language, so a seed that carried one would pass this test without ever
   * touching the gate.
   */
  it('delivers a language a person declared, and the fidelity gate lets it through', async () => {
    // `[V]` LibreOffice will not write a `.docx` that declares no language. A
    // seed declaring nothing, `none`, or an unparseable tag came out as its
    // locale's `en-US`; `zxx` came out as `zxx`, a real tag that is carried. So
    // the language is taken OUT of its own output — every
    // `w:lang` in every part, the rest of the bytes untouched and re-zipped with
    // `[Content_Types].xml` first so `isWordDocument` still sees its markers.
    const path = join(dir, 'seed.docx');
    const { stdout } = await execFileAsync('unzip', ['-Z1', path]);
    const names = stdout
      .split('\n')
      .filter(Boolean)
      .sort((a, b) => Number(b === '[Content_Types].xml') - Number(a === '[Content_Types].xml'));
    const undeclared = zip(
      names.map((name): [string, string | Buffer] => {
        const entry = zipEntry(docx, name);
        if (entry === null) throw new Error(`unreadable zip entry: ${name}`);
        return /\.(xml|rels)$/.test(name)
          ? [name, entry.toString('utf8').replace(/<w:lang\b[^>]*\/>/g, '')]
          : [name, entry];
      }),
    );

    const answers = {
      inputSha256: createHash('sha256').update(undeclared).digest('hex'),
      language: 'en',
      figures: [],
    };

    const response = await POST(upload(undeclared, 'agenda.docx', answers));
    // A refusal carries no summary header, so say what it was: this is where
    // the defect lands, as `fidelity-assertion` — or as `answer-mismatch` if
    // the seed ever starts declaring a language again.
    const refusal = response.status === 200 ? null : await response.clone().json();
    expect(refusal).toBeNull();

    const summary = JSON.parse(response.headers.get('x-remediation-summary') ?? '{}');
    expect(summary.declared).toMatchObject({ language: true });
    expect(summary.fidelity?.checked).toBe(true);
    expect(summary.fidelity.defects.filter((d: { kind: string }) => d.kind === 'assertion')).toEqual([]);

    const out = join(dir, 'declared-language.pdf');
    await writeFile(out, Buffer.from(await response.arrayBuffer()));

    const read = await inspectDocument(out);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.lang).toBe('en');
      expect(read.value.headings).toEqual(['H1', 'H2']);
    }
  }, 180_000);

  it('refuses a description for bytes it was not given', async () => {
    // The preimage check, end to end: answers key to the bytes they were
    // written for, and these are not those bytes.
    const response = await POST(
      upload(docx, 'agenda.docx', {
        inputSha256: 'f'.repeat(64),
        figures: [
          { ordinal: 0, type: 'Figure', page: 1, prior: 'absent', alt: 'A site plan of the mill' },
        ],
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ detail: 'answer-mismatch' });
  }, 180_000);

  it('refuses a text file named .docx rather than converting it', async () => {
    // The end-to-end version of the measured trap. LibreOffice would accept
    // this; the route does not, and nothing is spawned.
    const text = new Uint8Array(Buffer.from('this is not a Word file', 'latin1'));

    const response = await POST(upload(text));

    expect(response.status).toBe(415);
  });
});
