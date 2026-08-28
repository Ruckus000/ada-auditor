import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The client-scoped documents routes — the persisting variants of the
 * inspection tools.
 *
 * The fetch and the JVM are mocked; the SSRF guard is real, exactly as in
 * `documents-inspect-url.test.ts`: only the resolver behind
 * `assertSafeTargetUrl` is faked, to a PUBLIC address, so the genuine range
 * checks run. What these cases add over that suite is the persistence half —
 * what lands in the store, what a refusal leaves behind (nothing), and what
 * the log line is allowed to carry once a record exists.
 */

vi.mock('node:dns/promises', () => ({
  lookup: async () => [{ address: '203.0.113.7', family: 4 }],
}));

const { inspectDocument } = vi.hoisted(() => ({ inspectDocument: vi.fn() }));
vi.mock('../../src/integrations/documents/inspect', () => ({ inspectDocument }));

const runtimes = vi.hoisted(() => ({ java: true }));
vi.mock('../../src/integrations/documents/java-runtime', () => ({
  resolveJavaRuntime: () =>
    runtimes.java
      ? { available: true, javaBin: '/var/task/vendor/jre/bin/java', classpath: '/cp' }
      : { available: false, reason: 'no Java runtime found' },
  BUNDLED_JRE_DIR: 'vendor/jre',
}));

const authorized = vi.hoisted(() => ({ ok: true }));
vi.mock('../../src/app/api/_lib/authorize', () => ({
  authorizePrincipal: async () => (authorized.ok ? { kind: 'machine', name: 'CI' } : null),
}));

const { GET, POST, PUT } = await import(
  '../../src/app/api/platform/clients/[clientId]/documents/route'
);
const { documentStructureSchema } = await import('../../src/domain/document-structure');
const { MemoryPlatformStore, resetPlatformStore, setPlatformStore } = await import(
  '../../src/integrations/persistence'
);

const SECRET_PATH = '/minutes/objection-of-jane-doe.pdf';
const DOC_URL = `https://town.example${SECRET_PATH}`;
const FOUND_ON = 'https://town.example/meetings';

function params(clientId: string) {
  return { params: Promise.resolve({ clientId }) };
}

function jsonRequest(body?: unknown): Request {
  return new Request('http://localhost/api/platform/clients/acme/documents', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function uploadRequest(bytes: Uint8Array, filename = 'agenda.pdf'): Request {
  const form = new FormData();
  form.set('file', new File([new Uint8Array(bytes)], filename, { type: 'application/pdf' }));
  return new Request('http://localhost/api/platform/clients/acme/documents', {
    method: 'PUT',
    body: form,
  });
}

const PDF_BYTES = new Uint8Array(Buffer.from('%PDF-1.7\nfixture', 'latin1'));

function pdfResponse(bytes: Uint8Array): Response {
  return new Response(new Uint8Array(bytes), { status: 200 });
}

function structure(over = {}) {
  return documentStructureSchema.parse({
    marked: true,
    structureElements: 12,
    textChars: 400,
    images: 0,
    pages: 2,
    lang: 'en-US',
    title: 'Objection of Jane Doe',
    headings: [],
    headingTexts: [],
    figures: [],
    tables: [],
    lists: [],
    order: [],
    ...over,
  });
}

let platform: InstanceType<typeof MemoryPlatformStore>;
let fetchSpy: ReturnType<typeof vi.spyOn>;

describe('/api/platform/clients/[clientId]/documents', () => {
  beforeEach(async () => {
    inspectDocument.mockReset();
    inspectDocument.mockResolvedValue({ ok: true, value: structure() });
    runtimes.java = true;
    authorized.ok = true;
    platform = new MemoryPlatformStore();
    setPlatformStore(platform);
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pdfResponse(PDF_BYTES));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetPlatformStore();
  });

  it('refuses an unauthenticated caller on every method, before fetching anything', async () => {
    authorized.ok = false;

    expect((await GET(jsonRequest(), params('acme'))).status).toBe(401);
    expect((await POST(jsonRequest({ url: DOC_URL }), params('acme'))).status).toBe(401);
    expect((await PUT(uploadRequest(PDF_BYTES), params('acme'))).status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await platform.listDocumentInspections('acme')).toEqual([]);
  });

  it('answers 404 for a client that does not exist, and persists nothing', async () => {
    expect((await GET(jsonRequest(), params('nobody'))).status).toBe(404);
    expect((await POST(jsonRequest({ url: DOC_URL }), params('nobody'))).status).toBe(404);
    expect((await PUT(uploadRequest(PDF_BYTES), params('nobody'))).status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers 503 for a PDF when the host has no JVM — after the fetch, which is the trade', async () => {
    // The kind is not known until the bytes are, so the toolchain guard lives
    // in the PDF branch: a JVM-less host pays one guarded fetch before
    // refusing. What it buys is the case below — that host can still catalog
    // a Word document.
    runtimes.java = false;

    const response = await POST(jsonRequest({ url: DOC_URL }), params('acme'));

    expect(response.status).toBe(503);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(inspectDocument).not.toHaveBeenCalled();
    // The refusal persisted nothing.
    expect((await platform.listClientDocuments('acme')).documents).toEqual([]);
  });

  it('catalogs a Word URL as an inventory row, no JVM needed, no inspection persisted', async () => {
    runtimes.java = false;
    const names = Buffer.from('[Content_Types].xml....word/document.xml', 'latin1');
    fetchSpy.mockResolvedValue(
      pdfResponse(new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...names])),
    );

    const response = await POST(
      jsonRequest({ url: 'https://town.example/download?id=44', foundOn: FOUND_ON }),
      params('acme'),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    // The bytes decided, not the extension — the URL has none.
    expect(body.document).toMatchObject({
      url: 'https://town.example/download?id=44',
      kind: 'docx',
      source: 'crawl',
      foundOn: FOUND_ON,
    });
    expect(body).not.toHaveProperty('inspection');

    const documents = (await platform.listClientDocuments('acme')).documents;
    expect(documents).toHaveLength(1);
    expect(documents[0].kind).toBe('docx');
    // A sighting, not a reading: the store holds only what an instrument said.
    expect(await platform.listDocumentInspections('acme')).toEqual([]);
    expect(inspectDocument).not.toHaveBeenCalled();
  });

  it('inspects a crawl-found document and persists the record', async () => {
    const response = await POST(
      jsonRequest({ url: DOC_URL, foundOn: FOUND_ON }),
      params('acme'),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.inspection).toMatchObject({
      url: DOC_URL,
      foundOn: FOUND_ON,
      source: 'crawl',
    });
    // The summary verbatim, title included: the record is what the operator
    // saw, and the store must not be a paraphrase.
    expect(body.inspection.summary.titleText).toBe('Objection of Jane Doe');
    expect(body.inspection.summary.tagged).toBe(true);

    const stored = await platform.listDocumentInspections('acme');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: body.inspection.id,
      clientId: 'acme',
      url: DOC_URL,
      foundOn: FOUND_ON,
      source: 'crawl',
    });
    expect(stored[0].summary).toEqual(body.inspection.summary);

    // The inspection attached to a document row — the entity the inventory
    // lists — created on the way because the inventory had never heard of
    // this URL.
    const documents = (await platform.listClientDocuments('acme')).documents;
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({ url: DOC_URL, kind: 'pdf', source: 'crawl' });
    expect(stored[0].documentId).toBe(documents[0].id);
  });

  it('lists the inventory with the latest word, most recently seen first', async () => {
    const older = await platform.ensureClientDocument(
      'acme',
      { url: 'https://town.example/a.pdf', kind: 'pdf', source: 'crawl' },
      '2026-08-26T09:00:00.000Z',
    );
    await platform.saveDocumentInspection({
      id: 'insp-a',
      clientId: 'acme',
      documentId: older.id,
      url: older.url,
      source: 'crawl',
      summary: {
        title: 'no-heading-to-copy',
        sourceLanguage: null,
        tagged: false,
        pages: 1,
        headings: 0,
        tables: 0,
        lists: 0,
        figures: 0,
        gaps: ['2.4.2: the document has no title, and states no heading to copy one from'],
      },
      inspectedAt: '2026-08-26T09:00:00.000Z',
    });
    await platform.ensureClientDocument(
      'acme',
      { url: 'https://town.example/permit.docx', kind: 'docx', source: 'crawl' },
      '2026-08-26T10:00:00.000Z',
    );

    const response = await GET(jsonRequest(), params('acme'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.count).toBe(2);
    expect(body.documents.map((d: { url: string }) => d.url)).toEqual([
      'https://town.example/permit.docx',
      'https://town.example/a.pdf',
    ]);
    // The latest word rides on the row; nothing echoes the clientId the
    // caller just used.
    expect(body.documents[1].latestInspection.id).toBe('insp-a');
    expect(body.documents[1].latestInspection.summary.gaps[0]).toContain('2.4.2');
    expect(body.documents[0]).not.toHaveProperty('latestInspection');
    expect(body.documents[0]).not.toHaveProperty('clientId');
    // One reading is a first reading: nothing to diff, so nothing claimed.
    expect(body.documents[1]).not.toHaveProperty('regression');
  });

  it('pairs a PDF with the Word document sharing its stem, across any filter', async () => {
    await platform.ensureClientDocument(
      'acme',
      { url: 'https://town.example/files/permit.pdf', kind: 'pdf', source: 'crawl' },
      '2026-08-26T09:00:00.000Z',
    );
    const word = await platform.ensureClientDocument(
      'acme',
      { url: 'https://town.example/files/permit.docx?ver=3', kind: 'docx', source: 'crawl' },
      '2026-08-26T10:00:00.000Z',
    );
    await platform.ensureClientDocument(
      'acme',
      { url: 'https://town.example/files/loner.pdf', kind: 'pdf', source: 'crawl' },
      '2026-08-26T11:00:00.000Z',
    );

    const body = await (await GET(jsonRequest(), params('acme'))).json();
    const byUrl = new Map(
      body.documents.map((d: { url: string }) => [d.url, d] as const),
    );
    expect(byUrl.get('https://town.example/files/permit.pdf')).toMatchObject({
      sourceAvailable: {
        id: word.id,
        kind: 'docx',
        url: 'https://town.example/files/permit.docx?ver=3',
      },
    });
    // Only the PDF side carries the annotation, and only when a sibling exists.
    expect(byUrl.get('https://town.example/files/permit.docx?ver=3')).not.toHaveProperty(
      'sourceAvailable',
    );
    expect(byUrl.get('https://town.example/files/loner.pdf')).not.toHaveProperty(
      'sourceAvailable',
    );

    // A kind filter narrows the page, not the pairing universe: the docx is
    // filtered out of the listing yet still found as the PDF's source.
    const filtered = await (
      await GET(
        new Request('http://localhost/api/platform/clients/acme/documents?kind=pdf'),
        params('acme'),
      )
    ).json();
    const pdfRow = filtered.documents.find(
      (d: { url: string }) => d.url === 'https://town.example/files/permit.pdf',
    );
    expect(pdfRow.sourceAvailable.id).toBe(word.id);
  });

  it('passes filters and the cursor to the store, and refuses half a cursor', async () => {
    await platform.ensureClientDocument(
      'acme',
      { url: 'https://town.example/a.pdf', kind: 'pdf', source: 'crawl' },
      '2026-08-26T09:00:00.000Z',
    );
    await platform.ensureClientDocument(
      'acme',
      { url: 'https://town.example/permit.docx', kind: 'docx', source: 'crawl' },
      '2026-08-26T10:00:00.000Z',
    );

    const get = (qs: string) =>
      GET(
        new Request(`http://localhost/api/platform/clients/acme/documents${qs}`),
        params('acme'),
      );

    const filtered = await (await get('?kind=docx')).json();
    expect(filtered.documents.map((d: { url: string }) => d.url)).toEqual([
      'https://town.example/permit.docx',
    ]);
    expect(filtered.hasMore).toBe(false);

    const unreviewed = await (await get('?unreviewed=true')).json();
    expect(unreviewed.documents).toHaveLength(2);

    // A bad kind and half a cursor both refuse rather than silently selecting
    // the wrong page.
    expect((await get('?kind=xlsx')).status).toBe(400);
    expect((await get('?beforeLastSeenAt=2026-08-26T09:00:00.000Z')).status).toBe(400);

    // A whole cursor pages past the newest row.
    const paged = await (
      await get(
        `?beforeLastSeenAt=${encodeURIComponent('2026-08-26T10:00:00.000Z')}&beforeId=${encodeURIComponent(
          unreviewed.documents[0].id,
        )}`,
      )
    ).json();
    expect(paged.documents.map((d: { url: string }) => d.url)).toEqual([
      'https://town.example/a.pdf',
    ]);
  });

  it('attaches the document regression once a second reading exists', async () => {
    const doc = await platform.ensureClientDocument(
      'acme',
      { url: 'https://town.example/a.pdf', kind: 'pdf', source: 'crawl' },
      '2026-08-26T09:00:00.000Z',
    );
    const reading = (gaps: string[], id: string, inspectedAt: string) => ({
      id,
      clientId: 'acme',
      documentId: doc.id,
      url: doc.url,
      source: 'crawl' as const,
      summary: {
        title: 'no-heading-to-copy' as const,
        sourceLanguage: null,
        tagged: false,
        pages: 1,
        headings: 0,
        tables: 0,
        lists: 0,
        figures: 0,
        gaps,
      },
      inspectedAt,
    });
    await platform.saveDocumentInspection(
      reading(
        ['2.4.2: the document has no title, and states no heading to copy one from'],
        'insp-base',
        '2026-08-26T09:00:00.000Z',
      ),
    );
    await platform.saveDocumentInspection(reading([], 'insp-now', '2026-08-26T10:00:00.000Z'));

    const body = await (await GET(jsonRequest(), params('acme'))).json();

    expect(body.documents[0].regression).toMatchObject({
      status: 'improved',
      newGaps: [],
      resolvedGaps: ['2.4.2: the document has no title, and states no heading to copy one from'],
      unchangedCount: 0,
      baselineAt: '2026-08-26T09:00:00.000Z',
    });
  });

  it('refuses a private address with the real guard, and persists nothing', async () => {
    const response = await POST(
      jsonRequest({ url: 'http://169.254.169.254/x.pdf' }),
      params('acme'),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('unsafe_url');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await platform.listDocumentInspections('acme')).toEqual([]);
  });

  it('refuses a redirect rather than following it, and persists nothing', async () => {
    fetchSpy.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/x.pdf' } }),
    );

    const response = await POST(jsonRequest({ url: DOC_URL }), params('acme'));

    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('redirected');
    expect(inspectDocument).not.toHaveBeenCalled();
    // A refusal is the instrument saying nothing, and the store holds only
    // what the instrument said — no inspection, and no inventory row minted
    // for a URL that refused to fetch.
    expect(await platform.listDocumentInspections('acme')).toEqual([]);
    expect((await platform.listClientDocuments('acme')).documents).toEqual([]);
  });

  it('refuses a body that is not a URL as invalid_request_body', async () => {
    expect((await POST(jsonRequest({ url: 'not a url' }), params('acme'))).status).toBe(400);
    expect(
      (await POST(jsonRequest({ url: DOC_URL, extra: true }), params('acme'))).status,
    ).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('inspects an upload and persists it under its filename, with no foundOn', async () => {
    const response = await PUT(uploadRequest(PDF_BYTES, 'fee-schedule.pdf'), params('acme'));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.inspection).toMatchObject({ url: 'fee-schedule.pdf', source: 'upload' });
    expect(body.inspection).not.toHaveProperty('foundOn');

    const [stored] = await platform.listDocumentInspections('acme');
    expect(stored).toMatchObject({ url: 'fee-schedule.pdf', source: 'upload' });
    expect(stored).not.toHaveProperty('foundOn');
    // No fetch for an upload: the bytes arrived in the request.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses an upload that is not a PDF, and persists nothing', async () => {
    const response = await PUT(
      uploadRequest(new Uint8Array(Buffer.from('<html>a page</html>', 'latin1'))),
      params('acme'),
    );

    expect(response.status).toBe(415);
    expect(inspectDocument).not.toHaveBeenCalled();
    expect(await platform.listDocumentInspections('acme')).toEqual([]);
  });

  it('never logs the URL path, the filename, or the title — the store may hold them, logs may not', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    expect((await POST(jsonRequest({ url: DOC_URL }), params('acme'))).status).toBe(201);
    expect((await PUT(uploadRequest(PDF_BYTES, 'objection-of-jane-doe.pdf'), params('acme'))).status).toBe(
      201,
    );

    const logged = lines.join('\n');
    expect(logged).toContain('document_inspected');
    // The hostname is fine; the path, the filename and the title are not.
    expect(logged).toContain('town.example');
    expect(logged).not.toContain('jane-doe');
    expect(logged).not.toContain(SECRET_PATH);
    expect(logged).not.toContain('Jane Doe');

    // And the records carry what the logs refused: that split is the design.
    const stored = await platform.listDocumentInspections('acme');
    expect(stored.map((r) => r.url)).toContain('objection-of-jane-doe.pdf');
    expect(stored.every((r) => r.summary.titleText === 'Objection of Jane Doe')).toBe(true);
  });
});
