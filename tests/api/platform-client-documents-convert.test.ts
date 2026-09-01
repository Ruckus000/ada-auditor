import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The client-scoped conversion — the one that leaves an audit trail.
 *
 * The fetch and the pipeline are mocked, the SSRF guard is real (resolver
 * faked to a PUBLIC address, exactly as in `documents-remediate-url.test.ts`).
 * What these cases add over that suite is the persistence half: the
 * conversion record with its hashes, the document row it attaches to, and
 * the refusals that persist neither.
 */

vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '203.0.113.7', family: 4 }],
}));

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

const { storeBytes } = vi.hoisted(() => ({ storeBytes: vi.fn() }));
vi.mock('../../src/integrations/artifacts/blob-store', () => ({
  getArtifactStore: () => ({ storeBytes }),
}));

const { POST, PUT } = await import(
  '../../src/app/api/platform/clients/[clientId]/documents/convert/route'
);
const { documentStructureSchema } = await import('../../src/domain/document-structure');
const { MemoryPlatformStore, resetPlatformStore, setPlatformStore } = await import(
  '../../src/integrations/persistence'
);

const SECRET_PATH = '/forms/objection-of-jane-doe.docx';
const DOC_URL = `https://town.example${SECRET_PATH}`;

function params(clientId: string) {
  return { params: Promise.resolve({ clientId }) };
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/platform/clients/acme/documents/convert', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** A byte sequence `isWordDocument` accepts. */
function docxBytes(): Uint8Array {
  const names = Buffer.from('[Content_Types].xml....word/document.xml', 'latin1');
  return new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...names]);
}

function uploadRequest(bytes: Uint8Array, filename = 'agenda.docx'): Request {
  const form = new FormData();
  form.set('file', new File([new Uint8Array(bytes)], filename));
  return new Request('http://localhost/api/platform/clients/acme/documents/convert', {
    method: 'PUT',
    body: form,
  });
}

const FAKE_PDF = Buffer.from('%PDF-1.7 fake');
const SECRET_HEADING = 'Ratepayer Jane Doe of 14 Mill Lane';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function conversionSucceeds() {
  convertSourceToPdf.mockImplementation(async (_source: string, output: string) => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(output, FAKE_PDF);
    return {
      ok: true,
      pdfPath: output,
      provenance: {
        title: { kind: 'transcribed', title: 'Planning Committee Agenda' },
        sourceLanguage: 'en-GB',
        structure: documentStructureSchema.parse({
          marked: true,
          signed: false,
          encrypted: false,
          annotationsNotInStructure: 0,
          formFields: 0,
          formFieldsWithoutName: 0,
          embeddedFiles: 0,
          structureElements: 40,
          textChars: 900,
          images: 0,
          pages: 1,
          lang: 'en-GB',
          title: 'Planning Committee Agenda',
          headings: ['H1'],
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

let platform: InstanceType<typeof MemoryPlatformStore>;
let fetchSpy: ReturnType<typeof vi.spyOn>;

describe('/api/platform/clients/[clientId]/documents/convert', () => {
  beforeEach(async () => {
    convertSourceToPdf.mockReset();
    conversionSucceeds();
    storeBytes.mockReset();
    storeBytes.mockResolvedValue({ url: 'https://blob.example/documents/acme/stored.pdf' });
    runtimes.soffice = true;
    runtimes.java = true;
    authorized.ok = true;
    platform = new MemoryPlatformStore();
    setPlatformStore(platform);
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array(docxBytes()), { status: 200 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetPlatformStore();
  });

  it('converts by URL, returns the PDF, and records the conversion with its hashes', async () => {
    const response = await POST(
      request({ url: DOC_URL, foundOn: 'https://town.example/forms' }),
      params('acme'),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await response.arrayBuffer()).equals(FAKE_PDF)).toBe(true);

    const [document] = (await platform.listClientDocuments('acme')).documents;
    // The row is the entity; the byte check's verdict names the kind.
    expect(document).toMatchObject({
      url: DOC_URL,
      kind: 'docx',
      source: 'crawl',
      foundOn: 'https://town.example/forms',
    });

    // The audit trail's teeth: exactly the bytes in, exactly the bytes out.
    expect(document.latestConversion).toMatchObject({
      documentId: document.id,
      inputSha256: sha256(docxBytes()),
      outputSha256: sha256(FAKE_PDF),
    });
    expect(document.latestConversion?.summary.tagged).toBe(true);
    expect(document.latestConversion?.summary.title).toBe('transcribed');

    // The delivered bytes went to the blob store under a GENERATED path —
    // never the URL's own, which names a person — and the record keeps the
    // store's URL so the download routes can stream it back.
    expect(storeBytes).toHaveBeenCalledTimes(1);
    const [storedPath] = storeBytes.mock.calls[0] as [string];
    expect(storedPath).toMatch(/^documents\/acme\/[a-z0-9-]+\.pdf$/);
    expect(storedPath).not.toContain('jane-doe');
    expect(document.latestConversion?.artifactUrl).toBe(
      'https://blob.example/documents/acme/stored.pdf',
    );
  });

  it('records honest absence when no blob store is configured', async () => {
    storeBytes.mockResolvedValue(null);

    const response = await POST(request({ url: DOC_URL }), params('acme'));

    expect(response.status).toBe(200);
    const [document] = (await platform.listClientDocuments('acme')).documents;
    // The conversion succeeded and its hashes stand; only the pointer is
    // absent — which is exactly what the download route 404s on.
    expect(document.latestConversion).not.toHaveProperty('artifactUrl');
  });

  it('a failing blob store does not fail the conversion', async () => {
    storeBytes.mockRejectedValue(new Error('blob outage'));

    const response = await POST(request({ url: DOC_URL }), params('acme'));

    expect(response.status).toBe(200);
    const [document] = (await platform.listClientDocuments('acme')).documents;
    expect(document.latestConversion).not.toHaveProperty('artifactUrl');
  });

  it('converts an upload under its filename, no fetch made', async () => {
    const response = await PUT(uploadRequest(docxBytes(), 'permit.docx'), params('acme'));

    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();

    const [document] = (await platform.listClientDocuments('acme')).documents;
    expect(document).toMatchObject({ url: 'permit.docx', kind: 'docx', source: 'upload' });
    expect(document).not.toHaveProperty('foundOn');
    expect(document.latestConversion?.inputSha256).toBe(sha256(docxBytes()));
  });

  it('refuses an unauthenticated caller before fetching anything', async () => {
    authorized.ok = false;

    expect((await POST(request({ url: DOC_URL }), params('acme'))).status).toBe(401);
    expect((await PUT(uploadRequest(docxBytes()), params('acme'))).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers 503 before fetching when the host cannot convert', async () => {
    runtimes.soffice = false;

    const response = await POST(request({ url: DOC_URL }), params('acme'));

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('converter_unavailable');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers 404 for a client that does not exist', async () => {
    expect((await POST(request({ url: DOC_URL }), params('nobody'))).status).toBe(404);
    expect((await PUT(uploadRequest(docxBytes()), params('nobody'))).status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a private address with the real guard, and persists nothing', async () => {
    const response = await POST(request({ url: 'http://169.254.169.254/x.docx' }), params('acme'));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('unsafe_url');
    expect((await platform.listClientDocuments('acme')).documents).toEqual([]);
  });

  it('a failed conversion persists nothing — not even a document row', async () => {
    convertSourceToPdf.mockResolvedValue({
      ok: false,
      failure: { kind: 'not-tagged', detail: 'no structure tree' },
    });

    const response = await POST(request({ url: DOC_URL }), params('acme'));

    expect(response.status).toBe(422);
    expect((await platform.listClientDocuments('acme')).documents).toEqual([]);
  });

  it('never logs the URL path, the filename, or the title — the store may hold them', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    expect((await POST(request({ url: DOC_URL }), params('acme'))).status).toBe(200);
    expect(
      (await PUT(uploadRequest(docxBytes(), 'objection-of-jane-doe.docx'), params('acme'))).status,
    ).toBe(200);

    const logged = lines.join('\n');
    expect(logged).toContain('document_converted');
    expect(logged).toContain('town.example');
    expect(logged).not.toContain('jane-doe');
    expect(logged).not.toContain(SECRET_PATH);
    expect(logged).not.toContain(SECRET_HEADING);
    expect(logged).not.toContain('Planning Committee Agenda');

    // And the records carry what the logs refused: that split is the design.
    const documents = (await platform.listClientDocuments('acme')).documents;
    expect(documents.map((doc) => doc.url)).toContain('objection-of-jane-doe.docx');
  });
});
