import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The remediation route, without a toolchain.
 *
 * The conversion itself is mocked — exactly as `audit-console-route.test.ts`
 * mocks `runBrowserAudit` — so everything here is about what the route decides:
 * who may call it, what it refuses, and what it is allowed to say afterwards.
 *
 * Two of these are security properties rather than behaviour, and they are the
 * reason this file is longer than the route: the client's filename must never
 * reach a path, and the document's own words must never reach a log.
 */

const { convertSourceToPdf } = vi.hoisted(() => ({ convertSourceToPdf: vi.fn() }));
vi.mock('../../src/integrations/documents/convert', () => ({ convertSourceToPdf }));

const runtimes = vi.hoisted(() => ({ soffice: true, java: true }));

vi.mock('../../src/integrations/documents/libreoffice-runtime', () => ({
  resolveLibreOffice: () =>
    runtimes.soffice
      ? { available: true, sofficeBin: '/usr/bin/soffice' }
      : { available: false, reason: 'LibreOffice not found' },
}));

vi.mock('../../src/integrations/documents/java-runtime', () => ({
  resolveJavaRuntime: () =>
    runtimes.java
      ? { available: true, javaBin: '/usr/bin/java', classpath: '/cp' }
      : { available: false, reason: 'no Java runtime found' },
}));

const authorized = vi.hoisted(() => ({ ok: true }));
vi.mock('../../src/app/api/_lib/authorize', () => ({
  authorizePrincipal: async () => (authorized.ok ? { kind: 'machine', name: 'CI' } : null),
}));

const { POST } = await import('../../src/app/api/documents/remediate/route');
const { documentStructureSchema } = await import('../../src/domain/document-structure');

/** A byte sequence `isWordDocument` accepts. */
function docxBytes(): Uint8Array {
  const names = Buffer.from('[Content_Types].xml....word/document.xml', 'latin1');
  return new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...names]);
}

function upload(bytes: Uint8Array, filename = 'agenda.docx', field = 'file'): Request {
  const form = new FormData();
  form.set(field, new File([bytes as BlobPart], filename));
  return new Request('http://localhost:3000/api/documents/remediate', {
    method: 'POST',
    body: form,
  });
}

const SECRET_HEADING = 'Ratepayer Jane Doe of 14 Mill Lane';

function conversionSucceeds() {
  convertSourceToPdf.mockImplementation(async (_source: string, output: string) => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(output, Buffer.from('%PDF-1.7 fake'));
    return {
      ok: true,
      pdfPath: output,
      provenance: {
        title: { kind: 'already-titled', title: 'Planning Committee Agenda' },
        sourceLanguage: 'en-GB',
        structure: documentStructureSchema.parse({
          structureElements: 40,
          textChars: 900,
          images: 0,
          pages: 1,
          lang: 'en-GB',
          title: 'Planning Committee Agenda',
          headings: ['H1'],
          // The document's own words. Nothing may carry these into a log.
          headingTexts: [{ level: 'H1', text: SECRET_HEADING }],
          figures: [],
          tables: [],
          lists: [],
          order: [{ type: 'H1', text: SECRET_HEADING }],
        }),
      },
    };
  });
}

describe('POST /api/documents/remediate', () => {
  beforeEach(() => {
    convertSourceToPdf.mockReset();
    runtimes.soffice = true;
    runtimes.java = true;
    authorized.ok = true;
    delete process.env.AUDITOR_MAX_DOCUMENT_BYTES;
    conversionSucceeds();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the remediated PDF with a summary header', async () => {
    const response = await POST(upload(docxBytes()));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');

    const summary = JSON.parse(response.headers.get('x-remediation-summary') ?? '{}');
    expect(summary.tagged).toBe(true);
    expect(summary.headings).toBe(1);
    expect(summary.gaps).toEqual([]);
  });

  it('refuses an unauthenticated caller before reading the body', async () => {
    authorized.ok = false;

    const response = await POST(upload(docxBytes()));

    expect(response.status).toBe(401);
    // Nothing was converted, and nothing was buffered on their behalf.
    expect(convertSourceToPdf).not.toHaveBeenCalled();
  });

  it('answers 503, not 500, when the host has no converter', async () => {
    // Absence is a state, not an error. This is the production answer on every
    // serverless deployment, permanently and by design.
    runtimes.soffice = false;

    const response = await POST(upload(docxBytes()));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe('converter_unavailable');
    expect(body.detail).toMatch(/LibreOffice not found/);
  });

  it('names the JVM separately from the converter', async () => {
    // Different missing pieces, different fixes. One generic message would
    // make a person guess which to install.
    runtimes.java = false;

    const body = await (await POST(upload(docxBytes()))).json();

    expect(body.error).toBe('document_toolchain_unavailable');
    expect(body.detail).toMatch(/no Java runtime/);
  });

  it('refuses a text file named .docx', async () => {
    // The measured behaviour this gate exists for: LibreOffice would sniff the
    // content and convert it happily, producing a "remediated" PDF of a text
    // file. A successful conversion is not evidence the input was Word.
    const text = new Uint8Array(Buffer.from('this is not a Word file', 'latin1'));

    const response = await POST(upload(text));

    expect(response.status).toBe(415);
    expect(convertSourceToPdf).not.toHaveBeenCalled();
  });

  it('refuses a request with no file part', async () => {
    const response = await POST(upload(docxBytes(), 'agenda.docx', 'document'));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('missing_file_field');
  });

  it('refuses an oversized upload', async () => {
    process.env.AUDITOR_MAX_DOCUMENT_BYTES = '16';

    const response = await POST(upload(docxBytes()));

    expect(response.status).toBe(413);
    expect(convertSourceToPdf).not.toHaveBeenCalled();
  });

  it('reports a conversion failure as 422 with its kind', async () => {
    convertSourceToPdf.mockResolvedValue({
      ok: false,
      failure: { kind: 'not-tagged', detail: 'no structure tree' },
    });

    const response = await POST(upload(docxBytes()));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.detail).toBe('not-tagged');
  });

  // --- security properties ---------------------------------------------------

  it("never lets the client's filename reach a path", async () => {
    // The upload filename is attacker-controlled. A request id plus a fixed
    // extension is all a temp path needs.
    await POST(upload(docxBytes(), '../../../../etc/passwd.docx'));

    expect(convertSourceToPdf).toHaveBeenCalledTimes(1);
    const [source, output] = convertSourceToPdf.mock.calls[0] as [string, string];

    expect(source).not.toContain('passwd');
    expect(source).not.toContain('..');
    expect(output).not.toContain('..');
  });

  it('never writes document text to the log', async () => {
    // `DocumentStructure` carries the document's own words, and these are
    // municipal records naming real people. A log line persists and travels.
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    const response = await POST(upload(docxBytes()));
    expect(response.status).toBe(200);

    const logged = lines.join('\n');
    expect(logged).toContain('document_remediated');
    // The heading text, the reading order, and the title are all absent.
    expect(logged).not.toContain(SECRET_HEADING);
    expect(logged).not.toContain('Planning Committee Agenda');
    // Counts still made it, or the log would be useless.
    expect(logged).toContain('"headings":1');
  });

  it('still echoes the title in the response, which the caller supplied', async () => {
    const response = await POST(upload(docxBytes()));
    const summary = JSON.parse(response.headers.get('x-remediation-summary') ?? '{}');

    expect(summary.titleText).toBe('Planning Committee Agenda');
  });
});
