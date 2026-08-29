import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The by-URL document endpoint — the one discovery's findings flow into.
 *
 * The fetch is mocked, so everything here is about what the route decides:
 * which URLs it refuses, what it does to an over-limit stream, and what it is
 * allowed to say afterwards. The SSRF guard itself is real — only the network
 * behind it is faked — so a private address is refused by the actual
 * `assertSafeTargetUrl`, not by a stub agreeing with the test.
 */

/**
 * The guard's logic is real; only its resolver is faked. `town.example` does
 * not exist in DNS, so without this every case would 400 at the lookup and the
 * interesting branches would never run — while a hostname mapped to a PUBLIC
 * address still exercises the genuine range checks. The private-address case
 * below uses a literal IP precisely so it bypasses this fake and hits the real
 * refusal.
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

const { POST } = await import('../../src/app/api/documents/inspect-url/route');
const { documentStructureSchema } = await import('../../src/domain/document-structure');

const SECRET_PATH = '/minutes/objection-of-jane-doe.pdf';
const DOC_URL = `https://town.example${SECRET_PATH}`;

function request(body: unknown): Request {
  return new Request('http://localhost:3000/api/documents/inspect-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function pdfResponse(bytes: Uint8Array, init: ResponseInit = {}): Response {
  return new Response(new Uint8Array(bytes), { status: 200, ...init });
}

const PDF_BYTES = new Uint8Array(Buffer.from('%PDF-1.7\nfixture', 'latin1'));

function structure(over = {}) {
  return documentStructureSchema.parse({
    marked: true,
    signed: false,
    annotationsNotInStructure: 0,
    structureElements: 12,
    textChars: 400,
    images: 0,
    pages: 2,
    lang: 'en-US',
    title: null,
    headings: [],
    headingTexts: [],
    figures: [],
    tables: [],
    lists: [],
    order: [],
    ...over,
  });
}

describe('POST /api/documents/inspect-url', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    inspectDocument.mockReset();
    inspectDocument.mockResolvedValue({ ok: true, value: structure() });
    runtimes.java = true;
    authorized.ok = true;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(pdfResponse(PDF_BYTES));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the document and reports its gaps', async () => {
    const response = await POST(request({ url: DOC_URL }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.url).toBe(DOC_URL);
    expect(body.tagged).toBe(true);
    // The fixture is untitled but declares a language, so 2.4.2 is the one
    // gap expected and 3.1.1 must not appear.
    expect(body.gaps).toContainEqual(expect.stringContaining('2.4.2'));
    expect(body.gaps).not.toContainEqual(expect.stringContaining('3.1.1'));
  });

  it('refuses an unauthenticated caller before fetching anything', async () => {
    authorized.ok = false;

    const response = await POST(request({ url: DOC_URL }));

    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers 503 when the host has no JVM, before fetching', async () => {
    runtimes.java = false;

    const response = await POST(request({ url: DOC_URL }));

    expect(response.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a URL that is not a URL', async () => {
    expect((await POST(request({ url: 'not a url' }))).status).toBe(400);
    expect((await POST(request({ url: 'ftp://town.example/a.pdf' }))).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a private address — the real guard, not a stub', async () => {
    // `assertSafeTargetUrl` is NOT mocked. A literal link-local address is
    // range-checked before any DNS, so this exercises the actual refusal.
    const response = await POST(request({ url: 'http://169.254.169.254/x.pdf' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('unsafe_url');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a redirect rather than following it', async () => {
    // Each hop would need the whole safety check again; following silently
    // would defeat it. The fetch uses `redirect: manual` and this is the
    // branch that honours it.
    fetchSpy.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/x.pdf' } }),
    );

    const response = await POST(request({ url: DOC_URL }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe('redirected');
    expect(inspectDocument).not.toHaveBeenCalled();
  });

  it('stops an over-limit stream mid-flight', async () => {
    process.env.AUDITOR_MAX_DOCUMENT_BYTES = '8';
    try {
      const response = await POST(request({ url: DOC_URL }));

      expect(response.status).toBe(413);
      expect(inspectDocument).not.toHaveBeenCalled();
    } finally {
      delete process.env.AUDITOR_MAX_DOCUMENT_BYTES;
    }
  });

  it('refuses a body that is not a PDF', async () => {
    fetchSpy.mockResolvedValue(
      pdfResponse(new Uint8Array(Buffer.from('<html>a page</html>', 'latin1'))),
    );

    const response = await POST(request({ url: DOC_URL }));

    expect(response.status).toBe(415);
    expect(inspectDocument).not.toHaveBeenCalled();
  });

  it('reports an unreachable document as 502, not 500', async () => {
    fetchSpy.mockRejectedValue(new Error('getaddrinfo ENOTFOUND town.example'));

    expect((await POST(request({ url: DOC_URL }))).status).toBe(502);
  });

  it('never writes the full URL to the log — paths name people', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    expect((await POST(request({ url: DOC_URL }))).status).toBe(200);

    const logged = lines.join('\n');
    expect(logged).toContain('document_inspected');
    // The hostname is fine; the path is not.
    expect(logged).toContain('town.example');
    expect(logged).not.toContain('jane-doe');
    expect(logged).not.toContain(SECRET_PATH);
  });
});
