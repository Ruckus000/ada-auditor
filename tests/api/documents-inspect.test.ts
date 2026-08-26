import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The read-only document endpoint.
 *
 * `Inspect` itself is covered against a real JVM under `toolchain/`; this is
 * about what the route decides — who may call it, what it refuses, and what it
 * is allowed to say. The two security properties are the same ones the
 * remediate route has, and they are asserted again here rather than assumed to
 * carry over: the shared helper is what makes them true, and a test that only
 * covers one caller cannot notice it being bypassed in the other.
 */

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

const { POST } = await import('../../src/app/api/documents/inspect/route');
const { documentStructureSchema } = await import('../../src/domain/document-structure');

const SECRET_HEADING = 'Ratepayer Jane Doe of 14 Mill Lane';

/** Bytes `isPdf` accepts. */
const pdfBytes = () => new Uint8Array(Buffer.from('%PDF-1.7\nprobe', 'latin1'));

function upload(bytes: Uint8Array, filename = 'notice.pdf', field = 'file'): Request {
  const form = new FormData();
  form.set(field, new File([bytes as BlobPart], filename));
  return new Request('http://localhost:3000/api/documents/inspect', {
    method: 'POST',
    body: form,
  });
}

function inspected(over = {}) {
  return {
    ok: true,
    value: documentStructureSchema.parse({
      structureElements: 40,
      textChars: 900,
      images: 2,
      pages: 3,
      lang: 'en-GB',
      title: 'Planning Committee Agenda',
      headings: ['H1', 'H2'],
      headingTexts: [{ level: 'H1', text: SECRET_HEADING }],
      figures: [
        { type: 'Figure', alt: null, actualText: null },
        { type: 'Figure', alt: 'a map', actualText: null },
      ],
      tables: [],
      lists: [],
      order: [{ type: 'H1', text: SECRET_HEADING }],
      ...over,
    }),
  };
}

describe('POST /api/documents/inspect', () => {
  beforeEach(() => {
    inspectDocument.mockReset();
    inspectDocument.mockResolvedValue(inspected());
    runtimes.java = true;
    authorized.ok = true;
    delete process.env.AUDITOR_MAX_DOCUMENT_BYTES;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports structure and the gaps that still need a human', async () => {
    const response = await POST(upload(pdfBytes()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tagged).toBe(true);
    expect(body.headings).toBe(2);
    expect(body.pages).toBe(3);
    // One figure has absent alt, the other has real alt. Only the first is a gap.
    expect(body.gaps).toContainEqual('1.1.1: 1 figure with no alt text');
  });

  it('writes nothing back — this route only reads', async () => {
    const response = await POST(upload(pdfBytes()));

    // JSON, never a document. A reading endpoint that returned bytes would be
    // claiming to have changed something.
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
  });

  it('reports a missing title and language as gaps rather than fixing them', async () => {
    inspectDocument.mockResolvedValue(inspected({ title: null, lang: null }));

    const body = await (await POST(upload(pdfBytes()))).json();

    expect(body.title).toBe('no-heading-to-copy');
    expect(body.titleText).toBeUndefined();
    expect(body.gaps).toEqual(
      expect.arrayContaining([
        expect.stringContaining('2.4.2'),
        expect.stringContaining('3.1.1'),
      ]),
    );
  });

  it('reports an untagged PDF as untagged, which is the common real case', async () => {
    inspectDocument.mockResolvedValue(
      inspected({ structureElements: 0, headings: [], headingTexts: [], order: [] }),
    );

    const body = await (await POST(upload(pdfBytes()))).json();

    expect(body.tagged).toBe(false);
    expect(body.gaps).toContainEqual(expect.stringContaining('1.3.1'));
  });

  it('refuses an unauthenticated caller before reading the body', async () => {
    authorized.ok = false;

    const response = await POST(upload(pdfBytes()));

    expect(response.status).toBe(401);
    expect(inspectDocument).not.toHaveBeenCalled();
  });

  it('answers 503, not 500, when the host has no JVM', async () => {
    runtimes.java = false;

    const body = await (await POST(upload(pdfBytes()))).json();

    expect(body.error).toBe('document_toolchain_unavailable');
    expect(inspectDocument).not.toHaveBeenCalled();
  });

  it('refuses a file that is not a PDF', async () => {
    const notPdf = new Uint8Array(Buffer.from('PK this is a zip', 'latin1'));

    const response = await POST(upload(notPdf));

    expect(response.status).toBe(415);
    // Refused before a JVM was started for it.
    expect(inspectDocument).not.toHaveBeenCalled();
  });

  it('refuses a request with no file part', async () => {
    const response = await POST(upload(pdfBytes(), 'notice.pdf', 'document'));

    expect(response.status).toBe(400);
  });

  it('refuses an oversized upload', async () => {
    process.env.AUDITOR_MAX_DOCUMENT_BYTES = '4';

    const response = await POST(upload(pdfBytes()));

    expect(response.status).toBe(413);
    expect(inspectDocument).not.toHaveBeenCalled();
  });

  it('reports an unreadable PDF as 422 with its cause', async () => {
    inspectDocument.mockResolvedValue({
      ok: false,
      failure: { kind: 'failed', stage: 'Inspect', exitCode: 1, stderr: 'broken', timedOut: false },
    });

    const response = await POST(upload(pdfBytes()));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.detail).toBe('failed');
  });

  // --- the security properties, asserted for this caller too ----------------

  it("never lets the client's filename reach a path", async () => {
    await POST(upload(pdfBytes(), '../../../../etc/passwd.pdf'));

    expect(inspectDocument).toHaveBeenCalledTimes(1);
    const [source] = inspectDocument.mock.calls[0] as [string];

    expect(source).not.toContain('passwd');
    expect(source).not.toContain('..');
  });

  it('never writes document text to the log', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    expect((await POST(upload(pdfBytes()))).status).toBe(200);

    const logged = lines.join('\n');
    expect(logged).toContain('document_inspected');
    expect(logged).not.toContain(SECRET_HEADING);
    expect(logged).not.toContain('Planning Committee Agenda');
    expect(logged).toContain('"headings":2');
  });
});
