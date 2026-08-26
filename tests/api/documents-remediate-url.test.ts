import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The by-URL conversion endpoint — the one discovery's Word rows flow into.
 *
 * The fetch and the conversion are mocked, so everything here is about what
 * the route decides: which URLs it refuses, what it does before spending a
 * fetch, and what it is allowed to say afterwards. The SSRF guard itself is
 * real — only the network behind it is faked — so a private address is
 * refused by the actual `assertSafeTargetUrl`, not by a stub agreeing with
 * the test.
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

const { POST } = await import('../../src/app/api/documents/remediate-url/route');
const { documentStructureSchema } = await import('../../src/domain/document-structure');

const SECRET_PATH = '/forms/objection-of-jane-doe.docx';
const DOC_URL = `https://town.example${SECRET_PATH}`;

function request(body: unknown): Request {
  return new Request('http://localhost:3000/api/documents/remediate-url', {
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

function docxResponse(bytes: Uint8Array = docxBytes(), init: ResponseInit = {}): Response {
  return new Response(new Uint8Array(bytes), { status: 200, ...init });
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
        title: { kind: 'transcribed', title: 'Planning Committee Agenda' },
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

describe('POST /api/documents/remediate-url', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    convertSourceToPdf.mockReset();
    conversionSucceeds();
    runtimes.soffice = true;
    runtimes.java = true;
    authorized.ok = true;
    delete process.env.AUDITOR_MAX_DOCUMENT_BYTES;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(docxResponse());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches the document and returns the remediated PDF with its summary', async () => {
    const response = await POST(request({ url: DOC_URL }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await response.arrayBuffer()).toString('latin1')).toBe('%PDF-1.7 fake');

    const summary = JSON.parse(response.headers.get('x-remediation-summary') ?? '{}');
    expect(summary.tagged).toBe(true);
    expect(summary.title).toBe('transcribed');
  });

  it('names the download by request id, never by the URL it came from', async () => {
    // The URL's own filename is remote-controlled, and a `content-disposition`
    // header is one CRLF away from being a response-splitting vector. A
    // generated name has neither problem.
    const response = await POST(request({ url: DOC_URL }));
    const disposition = response.headers.get('content-disposition') ?? '';

    expect(disposition).toMatch(/^attachment; filename="remediated-[a-z0-9-]+\.pdf"$/i);
    expect(disposition).not.toContain('jane-doe');
  });

  it('refuses an unauthenticated caller before fetching anything', async () => {
    authorized.ok = false;

    const response = await POST(request({ url: DOC_URL }));

    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers 503 before fetching when the host has no converter', async () => {
    // No point pulling a document this host cannot convert — and this is the
    // production answer on every serverless deployment, by design.
    runtimes.soffice = false;

    const response = await POST(request({ url: DOC_URL }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe('converter_unavailable');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('names the JVM separately from the converter', async () => {
    runtimes.java = false;

    const body = await (await POST(request({ url: DOC_URL }))).json();

    expect(body.error).toBe('document_toolchain_unavailable');
  });

  it('refuses a URL that is not a URL', async () => {
    expect((await POST(request({ url: 'not a url' }))).status).toBe(400);
    expect((await POST(request({ url: 'ftp://town.example/a.docx' }))).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a private address — the real guard, not a stub', async () => {
    // `assertSafeTargetUrl` is NOT mocked. A literal link-local address is
    // range-checked before any DNS, so this exercises the actual refusal.
    const response = await POST(request({ url: 'http://169.254.169.254/x.docx' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('unsafe_url');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a redirect rather than following it', async () => {
    fetchSpy.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://elsewhere.example/x.docx' },
      }),
    );

    const response = await POST(request({ url: DOC_URL }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe('redirected');
    expect(convertSourceToPdf).not.toHaveBeenCalled();
  });

  it('stops an over-limit stream mid-flight', async () => {
    process.env.AUDITOR_MAX_DOCUMENT_BYTES = '8';

    const response = await POST(request({ url: DOC_URL }));

    expect(response.status).toBe(413);
    expect(convertSourceToPdf).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a Word document', async () => {
    // A PDF, for instance — the format this route's sibling handles. The
    // measured reason the byte check exists at all: LibreOffice sniffs content
    // and converts mislabelled files happily, so a successful conversion is
    // not evidence the input was Word.
    fetchSpy.mockResolvedValue(
      docxResponse(new Uint8Array(Buffer.from('%PDF-1.7 not word', 'latin1'))),
    );

    const response = await POST(request({ url: DOC_URL }));

    expect(response.status).toBe(415);
    expect(convertSourceToPdf).not.toHaveBeenCalled();
  });

  it('reports an unreachable document as 502, not 500', async () => {
    fetchSpy.mockRejectedValue(new Error('getaddrinfo ENOTFOUND town.example'));

    expect((await POST(request({ url: DOC_URL }))).status).toBe(502);
  });

  it('reports a conversion failure as 422 with its kind', async () => {
    convertSourceToPdf.mockResolvedValue({
      ok: false,
      failure: { kind: 'not-tagged', detail: 'no structure tree' },
    });

    const response = await POST(request({ url: DOC_URL }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.detail).toBe('not-tagged');
  });

  it('never lets the URL reach a filesystem path', async () => {
    // Same rule as the upload route's filename: the URL is remote-authored,
    // and a request id plus a known extension is all a temp path needs.
    await POST(request({ url: DOC_URL }));

    expect(convertSourceToPdf).toHaveBeenCalledTimes(1);
    const [source, output] = convertSourceToPdf.mock.calls[0] as [string, string];

    expect(source).not.toContain('jane-doe');
    expect(source).toMatch(/\.docx$/);
    expect(output).not.toContain('jane-doe');
  });

  it('never writes the full URL or document text to the log — paths name people', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    expect((await POST(request({ url: DOC_URL }))).status).toBe(200);

    const logged = lines.join('\n');
    expect(logged).toContain('document_remediated');
    // The hostname is fine; the path is not, and neither are the document's
    // own words.
    expect(logged).toContain('town.example');
    expect(logged).not.toContain('jane-doe');
    expect(logged).not.toContain(SECRET_PATH);
    expect(logged).not.toContain(SECRET_HEADING);
    expect(logged).not.toContain('Planning Committee Agenda');
  });
});
