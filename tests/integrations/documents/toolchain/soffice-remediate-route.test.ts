import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { resolveLibreOffice } from '../../../../src/integrations/documents/libreoffice-runtime';
import { resolveJavaRuntime } from '../../../../src/integrations/documents/java-runtime';
import { inspectDocument } from '../../../../src/integrations/documents/inspect';

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
const SEED = `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">
<office:meta><dc:title>Planning Committee Agenda</dc:title></office:meta>
<office:body><office:text>
<text:h text:outline-level="1">Planning Committee Agenda</text:h>
<text:p>Apologies for absence were received.</text:p>
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

  function upload(bytes: Uint8Array, filename = 'agenda.docx'): Request {
    const form = new FormData();
    form.set('file', new File([bytes as BlobPart], filename));
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

  it('refuses a text file named .docx rather than converting it', async () => {
    // The end-to-end version of the measured trap. LibreOffice would accept
    // this; the route does not, and nothing is spawned.
    const text = new Uint8Array(Buffer.from('this is not a Word file', 'latin1'));

    const response = await POST(upload(text));

    expect(response.status).toBe(415);
  });
});
