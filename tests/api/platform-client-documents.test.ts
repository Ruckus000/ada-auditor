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

  it('answers 503 when the host has no JVM, before fetching', async () => {
    runtimes.java = false;

    expect((await POST(jsonRequest({ url: DOC_URL }), params('acme'))).status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
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
  });

  it('lists stored inspections newest first, without the clientId echoed', async () => {
    await platform.saveDocumentInspection({
      id: 'doc-old',
      clientId: 'acme',
      url: 'https://town.example/a.pdf',
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
    await platform.saveDocumentInspection({
      id: 'doc-new',
      clientId: 'acme',
      url: 'agenda.pdf',
      source: 'upload',
      summary: {
        title: 'already-titled',
        titleText: 'Agenda',
        sourceLanguage: 'en-US',
        tagged: true,
        pages: 3,
        headings: 2,
        tables: 0,
        lists: 1,
        figures: 0,
        gaps: [],
      },
      inspectedAt: '2026-08-26T10:00:00.000Z',
    });

    const response = await GET(jsonRequest(), params('acme'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.count).toBe(2);
    expect(body.inspections.map((i: { id: string }) => i.id)).toEqual(['doc-new', 'doc-old']);
    expect(body.inspections[0]).not.toHaveProperty('clientId');
    expect(body.inspections[1]).not.toHaveProperty('foundOn');
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
    // what the instrument said.
    expect(await platform.listDocumentInspections('acme')).toEqual([]);
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
