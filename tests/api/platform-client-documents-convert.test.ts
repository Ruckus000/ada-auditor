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

// The repair lane's two stages, for the answer-consumption cases below; the
// conversion cases never reach them.
const { inspectDocument, finishDocument } = vi.hoisted(() => ({
  inspectDocument: vi.fn(),
  finishDocument: vi.fn(),
}));
vi.mock('../../src/integrations/documents/inspect', () => ({ inspectDocument }));
vi.mock('../../src/integrations/documents/finish', () => ({ finishDocument }));

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
  // The repair lane joins this onto its root; the stages are mocked here, so
  // the value never reaches a filesystem.
  DOCUMENT_FONTS_DIR: 'vendor/fonts/liberation',
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
const { MemoryRunCounter, resetRunCounter, setRunCounter } = await import(
  '../../src/app/api/_lib/run-counter'
);

beforeEach(() => setRunCounter(new MemoryRunCounter()));
afterEach(() => {
  resetRunCounter();
  delete process.env.AUDITOR_MAX_DOCUMENTS_PER_HOUR;
});
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

const PDF_BYTES = new Uint8Array(Buffer.from('%PDF-1.7\nfixture', 'latin1'));
const PDF_URL = 'https://town.example/minutes/agenda.pdf';

/** A tagged reading with one undescribed figure and no language. */
function pdfReading(over: Record<string, unknown> = {}) {
  return documentStructureSchema.parse({
    marked: true,
    signed: false,
    encrypted: false,
    annotationsNotInStructure: 0,
    formFields: 0,
    formFieldsWithoutName: 0,
    embeddedFiles: 0,
    structureElements: 12,
    textChars: 400,
    images: 1,
    pages: 1,
    lang: null,
    title: 'Agenda',
    headings: [],
    headingTexts: [],
    figures: [{ type: 'Figure', alt: null, actualText: null, page: 1 }],
    tables: [],
    lists: [],
    order: [{ type: 'Figure', text: null }],
    ...over,
  });
}

/** The document, its reading carrying the asks, and answers to both. */
async function seedAnsweredPdf(figureAltNow: string | null = null) {
  const doc = await platform.ensureClientDocument(
    'acme',
    { url: PDF_URL, kind: 'pdf', source: 'crawl' },
    '2026-08-26T09:00:00.000Z',
  );
  const inputSha256 = sha256(PDF_BYTES);
  await platform.saveDocumentInspection({
    id: 'insp-1',
    clientId: 'acme',
    documentId: doc.id,
    url: PDF_URL,
    source: 'crawl',
    inputSha256,
    summary: {
      title: 'already-titled', titleText: 'Agenda', sourceLanguage: null, tagged: true,
      pages: 1, headings: 0, tables: 0, lists: 0, figures: 1,
      gaps: ['3.1.1: the source declares no language, so none is claimed', '1.1.1: 1 figure with no alt text'],
      needs: [{ criterion: '3.1.1', item: 'x' }, { criterion: '1.1.1', item: 'y' }],
      asks: [
        { id: 'language', kind: 'language', criterion: '3.1.1', answerable: 'operator' },
        { id: 'figure:0', kind: 'figure', criterion: '1.1.1', answerable: 'operator', target: { ordinal: 0, type: 'Figure', page: 1, prior: 'absent' } },
      ],
    },
    inspectedAt: '2026-08-26T09:00:00.000Z',
  });
  await platform.saveDocumentAnswers([
    {
      id: 'ans-lang', clientId: 'acme', documentId: doc.id, inputSha256, askId: 'language', kind: 'language',
      disposition: 'declared', value: 'en', actor: 'Sam', declaredAt: '2026-08-26T10:00:00.000Z',
    },
    {
      id: 'ans-fig', clientId: 'acme', documentId: doc.id, inputSha256, askId: 'figure:0', kind: 'figure',
      target: { ordinal: 0, type: 'Figure', page: 1, prior: 'absent' },
      disposition: 'declared', value: 'A map of the town centre', actor: 'Sam', declaredAt: '2026-08-26T10:00:00.000Z',
    },
  ]);
  // The reading the run takes BEFORE writing, then the one it takes after.
  const before = pdfReading({ figures: [{ type: 'Figure', alt: figureAltNow, actualText: null, page: 1 }] });
  // As a real `Inspect` reads it back: the description is now the figure's
  // reading-order text too, which is the delta the gate is told to expect.
  const after = pdfReading({
    lang: 'en',
    figures: [{ type: 'Figure', alt: 'A map of the town centre', actualText: null, page: 1 }],
    order: [{ type: 'Figure', text: 'A map of the town centre' }],
  });
  inspectDocument.mockReset();
  inspectDocument.mockResolvedValueOnce({ ok: true, value: before }).mockResolvedValue({ ok: true, value: after });
  finishDocument.mockReset();
  finishDocument.mockImplementation(async (request: { outputPath: string }) => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(request.outputPath, FAKE_PDF);
    return { ok: true };
  });
  fetchSpy.mockResolvedValue(new Response(new Uint8Array(PDF_BYTES), { status: 200 }));
  return doc;
}

describe('consuming the answers on record', () => {
  beforeEach(async () => {
    storeBytes.mockReset();
    storeBytes.mockResolvedValue(null);
    runtimes.soffice = true;
    runtimes.java = true;
    authorized.ok = true;
    platform = new MemoryPlatformStore();
    setPlatformStore(platform);
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetPlatformStore();
  });

  it('writes the declared answers for these bytes, and the row says which', async () => {
    const doc = await seedAnsweredPdf();

    const response = await POST(request({ url: PDF_URL }), params('acme'));

    expect(response.status).toBe(200);
    // The stage was told exactly what a person said: the description onto its
    // ordinal, the language into the catalog.
    const finishRequest = finishDocument.mock.calls[0]?.[0] as { alt?: unknown; language?: unknown };
    expect(finishRequest.alt).toEqual([{ ordinal: 0, text: 'A map of the town centre' }]);
    expect(finishRequest.language).toBe('en');

    const [record] = (await platform.listClientDocuments('acme')).documents;
    expect(record.id).toBe(doc.id);
    expect(record.latestConversion?.answerIds?.sort()).toEqual(['ans-fig', 'ans-lang']);
    expect(record.latestConversion?.summary.declared).toEqual({ language: true, figures: 1 });
    expect(record.latestConversion?.summary.sourceLanguage).toBe('en');
    // The header carries the provenance too.
    const summary = JSON.parse(response.headers.get('x-remediation-summary') ?? '{}');
    expect(summary.declared).toEqual({ language: true, figures: 1 });
  });

  it('refuses an answer whose figure no longer looks as it did when answered', async () => {
    // The document now carries a description on that figure. Writing a
    // person's answer over an author's words is not transcription, so the
    // whole run refuses, nothing is delivered, and the trail says why.
    await seedAnsweredPdf('The clerk’s own description');

    const response = await POST(request({ url: PDF_URL }), params('acme'));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'repair_refused', detail: 'answer-mismatch' });
    expect(finishDocument).not.toHaveBeenCalled();
    const [record] = (await platform.listClientDocuments('acme')).documents;
    expect(record.latestConversion).toBeUndefined();
    const events = await platform.listEvents({ clientId: 'acme' });
    expect(events[0]).toMatchObject({ action: 'document_repair_failed', metadata: { detail: 'answer-mismatch' } });
  });
});

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

  it('refuses past the document ceiling before fetching or converting', async () => {
    process.env.AUDITOR_MAX_DOCUMENTS_PER_HOUR = '1';
    expect((await POST(request({ url: DOC_URL }), params('acme'))).status).toBe(200);
    fetchSpy.mockClear();
    convertSourceToPdf.mockClear();

    expect((await POST(request({ url: DOC_URL }), params('acme'))).status).toBe(429);
    expect((await PUT(uploadRequest(docxBytes()), params('acme'))).status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(convertSourceToPdf).not.toHaveBeenCalled();
    expect((await platform.listClientDocuments('acme')).documents).toHaveLength(1);
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

    // The bytes the route had in hand are on the document row — what a later
    // reading of different bytes is compared against — and the trail says
    // who converted, by document id, never by path.
    expect(document.contentSha256).toBe(sha256(docxBytes()));
    const [event] = await platform.listEvents({ clientId: 'acme' });
    expect(event).toMatchObject({ actor: 'CI', action: 'document_converted', subject: document.id });
    expect(JSON.stringify(event)).not.toContain('jane-doe');
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
