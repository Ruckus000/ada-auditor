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
  // The repair lane joins this onto its root to point Finish at replacement
  // font programs; these tests mock the stages, so the value never reaches a
  // filesystem.
  DOCUMENT_FONTS_DIR: 'vendor/fonts/liberation',
}));

const { checkUa1 } = vi.hoisted(() => ({ checkUa1: vi.fn() }));
vi.mock('../../src/integrations/documents/verapdf', () => ({ checkUa1 }));

const authorized = vi.hoisted(() => ({ ok: true }));
vi.mock('../../src/app/api/_lib/authorize', () => ({
  authorizePrincipal: async () => (authorized.ok ? { kind: 'machine', name: 'CI' } : null),
}));

const { GET, POST } = await import('../../src/app/api/documents/remediate/route');
const { documentStructureSchema } = await import('../../src/domain/document-structure');
const { MemoryRunCounter, resetRunCounter, setRunCounter } = await import(
  '../../src/app/api/_lib/run-counter'
);
const { MAX_ANSWERS_BYTES } = await import('../../src/app/api/_lib/document-upload');

beforeEach(() => setRunCounter(new MemoryRunCounter()));
afterEach(() => {
  resetRunCounter();
  delete process.env.AUDITOR_MAX_DOCUMENTS_PER_HOUR;
});

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

/** A byte sequence `isPdf` accepts. */
function pdfBytes(): Uint8Array {
  return new Uint8Array(Buffer.from('%PDF-1.7\nreal enough for the container check\n', 'latin1'));
}

/**
 * The repair path's two stages, stubbed: read the document, write it back.
 * `over` shapes the reading, which is what every rule under test turns on.
 */
function repairReads(over: Record<string, unknown> = {}) {
  const reading = documentStructureSchema.parse({
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
    pages: 2,
    lang: 'en-GB',
    title: null,
    headings: [],
    headingTexts: [],
    figures: [],
    tables: [],
    lists: [],
    order: [],
    ...over,
  });
  inspectDocument.mockResolvedValue({ ok: true, value: reading });
  finishDocument.mockImplementation(async (request: { outputPath: string }) => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(request.outputPath, Buffer.from('%PDF-1.7 repaired'));
    return { ok: true };
  });
  return reading;
}

/**
 * The identifier is EARNED, and every way of failing to earn it is safe.
 *
 * `earnUaIdentifier` finishes the document a second time with the PDF/UA
 * identifier claimed, proves the second pass moved no content, and re-checks
 * it. Any of those can fail, and each failure keeps the honest unstamped file
 * and the verdict that describes it.
 *
 * None of this was covered. `AGENTS.md` records what that cost: gating the
 * identifier once took conformant deliveries from 19 to 0 — the product could
 * not certify ANY document — and the blind corpus still reported every promise
 * held, because no answer key claimed a document should come back conformant.
 * These are the four bail-outs that silence would hide again.
 */
describe('earning the PDF/UA identifier', () => {
  /** The honest file: conformant except for the identifier it has not claimed. */
  const ONLY_IDENTIFIER = {
    checker: 'verapdf-ua1' as const,
    compliant: false as const,
    failingClauses: ['5-1'],
  };

  beforeEach(() => {
    convertSourceToPdf.mockReset();
    checkUa1.mockReset();
    runtimes.soffice = true;
    runtimes.java = true;
    authorized.ok = true;
  });

  async function deliver() {
    const response = await POST(upload(pdfBytes(), 'notice.pdf'));
    return {
      response,
      summary: JSON.parse(response.headers.get('x-remediation-summary') ?? '{}'),
    };
  }

  it('stamps the file when the second pass earns it', async () => {
    repairReads();
    checkUa1
      .mockResolvedValueOnce(ONLY_IDENTIFIER)
      .mockResolvedValue({ checker: 'verapdf-ua1', compliant: true });

    const { response, summary } = await deliver();
    expect(response.status).toBe(200);
    expect(summary.conformance).toEqual({ checker: 'verapdf-ua1', compliant: true });
  });

  it('keeps the honest file when the stamping pass fails', async () => {
    repairReads();
    // The first Finish writes the deliverable; the second — the stamped one —
    // fails. The document must still be delivered, uncertified.
    let calls = 0;
    finishDocument.mockImplementation(async (request: { outputPath: string }) => {
      calls += 1;
      if (calls === 2) return { ok: false, failure: { kind: 'failed', exitCode: 1 } };
      const { writeFile } = await import('node:fs/promises');
      await writeFile(request.outputPath, Buffer.from('%PDF-1.7 repaired'));
      return { ok: true };
    });
    checkUa1.mockResolvedValue(ONLY_IDENTIFIER);

    const { response, summary } = await deliver();
    expect(response.status).toBe(200);
    expect(summary.conformance).toEqual(ONLY_IDENTIFIER);
  });

  /**
   * The repair reads the document THREE times: the source, the repaired file
   * (which its own `contentChanges` gate compares against the source), and —
   * only if the identifier is the single failing clause — the stamped file.
   * A test that disturbs read 2 trips the repair's gate and never reaches the
   * one under test here, which is read 3.
   */
  function stagedReadIs(result: unknown, reading: unknown) {
    let reads = 0;
    inspectDocument.mockImplementation(async () => {
      reads += 1;
      return reads >= 3 ? result : { ok: true, value: reading };
    });
  }

  it('keeps the honest file when the stamped pass moved content', async () => {
    const reading = repairReads();
    // The stamped file reads back saying something else. A certificate is worth
    // nothing on a document that no longer says what it said.
    stagedReadIs(
      { ok: true, value: { ...reading, headings: ['H1', 'H2'], headingTexts: [] } },
      reading,
    );
    // The re-check SUCCEEDS, so the fidelity gate is the only thing that can
    // stop this. Otherwise a broken gate is masked by the next bail-out and
    // the test proves nothing.
    checkUa1
      .mockResolvedValueOnce(ONLY_IDENTIFIER)
      .mockResolvedValue({ checker: 'verapdf-ua1', compliant: true });

    const { response, summary } = await deliver();
    expect(response.status).toBe(200);
    expect(summary.conformance).toEqual(ONLY_IDENTIFIER);
  });

  it('keeps the honest file when the stamped file cannot be read back', async () => {
    const reading = repairReads();
    // Unreadable is not "unchanged". A stamp that cannot be verified is not one
    // this product will ship.
    stagedReadIs({ ok: false, failure: { kind: 'invalid-output', detail: 'nope' } }, reading);
    checkUa1
      .mockResolvedValueOnce(ONLY_IDENTIFIER)
      .mockResolvedValue({ checker: 'verapdf-ua1', compliant: true });

    const { response, summary } = await deliver();
    expect(response.status).toBe(200);
    expect(summary.conformance).toEqual(ONLY_IDENTIFIER);
  });

  it('keeps the honest file when the identifier did not actually help', async () => {
    // The stamp was written and the document STILL does not conform. Reporting
    // the pre-stamp verdict is the only honest answer, and the file that ships
    // is the one that verdict describes.
    repairReads();
    checkUa1
      .mockResolvedValueOnce(ONLY_IDENTIFIER)
      .mockResolvedValue({
        checker: 'verapdf-ua1',
        compliant: false,
        failingClauses: ['5-1', '7.1-3'],
      });

    const { response, summary } = await deliver();
    expect(response.status).toBe(200);
    expect(summary.conformance).toEqual(ONLY_IDENTIFIER);
  });

  it('never attempts a stamp when more than the identifier is failing', async () => {
    repairReads();
    checkUa1.mockResolvedValue({
      checker: 'verapdf-ua1',
      compliant: false,
      failingClauses: ['5-1', '7.21.4.1-1'],
    });

    const { summary } = await deliver();
    // One check only: the second would mean a stamp was attempted on a document
    // the identifier could not rescue.
    expect(checkUa1).toHaveBeenCalledTimes(1);
    expect(summary.conformance.compliant).toBe(false);
  });
});

describe('POST /api/documents/remediate', () => {
  beforeEach(() => {
    convertSourceToPdf.mockReset();
    runtimes.soffice = true;
    runtimes.java = true;
    authorized.ok = true;
    delete process.env.AUDITOR_MAX_DOCUMENT_BYTES;
    inspectDocument.mockReset();
    finishDocument.mockReset();
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

  it('refuses the upload past the document ceiling before converting', async () => {
    process.env.AUDITOR_MAX_DOCUMENTS_PER_HOUR = '1';
    expect((await POST(upload(docxBytes()))).status).toBe(200);

    const response = await POST(upload(docxBytes()));

    expect(response.status).toBe(429);
    expect((await response.json()).error).toBe('document_budget_exceeded');
    expect(convertSourceToPdf).toHaveBeenCalledTimes(1);
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

  it('repairs a PDF, deriving its title from the filename it was saved under', async () => {
    repairReads({ title: null });

    const response = await POST(upload(pdfBytes(), '2026-Mid-Year-Fee-Schedule.pdf'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    // The transcribed title reaches the stage that writes it — and it travels
    // in a file, never on the command line.
    expect(finishDocument).toHaveBeenCalledWith(
      expect.objectContaining({ title: '2026 Mid Year Fee Schedule', language: 'en-GB' }),
      expect.anything(),
    );
    const summary = JSON.parse(response.headers.get('x-remediation-summary') ?? '{}');
    expect(summary.title).toBe('filename-derived');
    // Conversion was never involved: this document was already a PDF.
    expect(convertSourceToPdf).not.toHaveBeenCalled();
  });

  it('refuses to repair an untagged PDF, and says what would help', async () => {
    repairReads({ structureElements: 0, marked: false });

    const response = await POST(upload(pdfBytes(), 'notice.pdf'));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe('repair_refused');
    expect(body.detail).toBe('not-tagged');
    // The operator gets an action, not just a kind.
    expect(body.message).toContain('Word source');
    expect(finishDocument).not.toHaveBeenCalled();
  });

  it('discards a repair that moved any content, rather than delivering it', async () => {
    // `Finish` claims to change no structure. If a reading back ever says
    // otherwise, the original is better than a file we cannot vouch for.
    const before = repairReads({ title: 'Fee Schedule', headings: ['H1'] });
    inspectDocument
      .mockResolvedValueOnce({ ok: true, value: before })
      .mockResolvedValueOnce({
        ok: true,
        value: { ...before, headings: [] },
      });

    const response = await POST(upload(pdfBytes(), 'schedule.pdf'));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe('repair_failed');
    expect(body.detail).toBe('content-changed');
  });

  it('repairs a PDF on a host with no LibreOffice — repair needs only the JVM', async () => {
    runtimes.soffice = false;
    repairReads({ title: 'Zoning Ordinance' });

    const response = await POST(upload(pdfBytes(), 'zoning.pdf'));

    expect(response.status).toBe(200);
  });

  it('never logs the repaired document’s title', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    repairReads({ title: SECRET_HEADING });

    await POST(upload(pdfBytes(), 'agenda.pdf'));
    spy.mockRestore();

    expect(lines.join('\n')).not.toContain(SECRET_HEADING);
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

  it('survives a title the header could not carry unescaped', async () => {
    // Header values are ByteStrings: the `Response` constructor throws on a
    // code point above U+00FF, so before the summary JSON was ASCII-escaped,
    // an em-dash in a title turned a *successful* conversion into a crash at
    // the very last step. Municipal agendas have em-dashes.
    const title = 'Agenda — Planning Committee';
    convertSourceToPdf.mockImplementation(async (_source: string, output: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(output, Buffer.from('%PDF-1.7 fake'));
      return {
        ok: true,
        pdfPath: output,
        provenance: {
          title: { kind: 'already-titled', title },
          sourceLanguage: 'en-GB',
          structure: documentStructureSchema.parse({
            marked: true,
            signed: false,
            encrypted: false,
            annotationsNotInStructure: 0,
            formFields: 0,
            formFieldsWithoutName: 0,
            embeddedFiles: 0,
            structureElements: 4,
            textChars: 100,
            images: 0,
            pages: 1,
            lang: 'en-GB',
            title,
            headings: [],
            headingTexts: [],
            figures: [],
            tables: [],
            lists: [],
            order: [],
          }),
        },
      };
    });

    const response = await POST(upload(docxBytes()));
    expect(response.status).toBe(200);

    // Escaped in transit, intact after parsing.
    const summary = JSON.parse(response.headers.get('x-remediation-summary') ?? '{}');
    expect(summary.titleText).toBe(title);
  });
});

describe('GET /api/documents/remediate', () => {
  beforeEach(() => {
    runtimes.soffice = true;
    runtimes.java = true;
    authorized.ok = true;
  });

  it('answers available when both halves are present', async () => {
    const body = await (await GET(new Request('http://localhost:3000/api/documents/remediate'))).json();

    expect(body.available).toBe(true);
  });

  it('answers unavailable naming the missing half', async () => {
    // The production answer on every serverless deployment, and the reason the
    // screen asks before offering a Convert button.
    runtimes.soffice = false;

    const body = await (await GET(new Request('http://localhost:3000/api/documents/remediate'))).json();

    expect(body.available).toBe(false);
    expect(body.reason).toMatch(/LibreOffice not found/);
  });

  it('refuses an unauthenticated caller', async () => {
    authorized.ok = false;

    const response = await GET(new Request('http://localhost:3000/api/documents/remediate'));

    expect(response.status).toBe(401);
  });
});

describe('answers posted with the file', () => {
  beforeEach(() => {
    checkUa1.mockReset();
    runtimes.soffice = true;
    runtimes.java = true;
    authorized.ok = true;
  });

  function withAnswers(answers: unknown): Request {
    const form = new FormData();
    form.set('file', new File([pdfBytes() as BlobPart], 'notice.pdf'));
    form.set('answers', typeof answers === 'string' ? answers : JSON.stringify(answers));
    return new Request('http://localhost:3000/api/documents/remediate', { method: 'POST', body: form });
  }

  it('refuses answers given for other bytes, and writes nothing', async () => {
    // The harness's tamper case: a sidecar keyed to a sha that is not the
    // file's. The door must not let the pipeline run on it.
    repairReads({ figures: [{ type: 'Figure', alt: null, actualText: null, page: 1 }], images: 1 });
    checkUa1.mockResolvedValue({ checker: 'verapdf-ua1', compliant: false, failingClauses: ['7.3-1'] });

    const response = await POST(withAnswers({
      inputSha256: 'b'.repeat(64),
      figures: [{ ordinal: 0, type: 'Figure', page: 1, prior: 'absent', alt: 'A map' }],
    }));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'repair_refused', detail: 'answer-mismatch' });
    expect(finishDocument).not.toHaveBeenCalled();
  });

  it('refuses a malformed answers part before any stage runs', async () => {
    repairReads();
    for (const bad of ['{not json', { inputSha256: 'x', figures: 'no' }]) {
      const response = await POST(withAnswers(bad));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('invalid_answers');
    }
    expect(finishDocument).not.toHaveBeenCalled();
  });

  it('refuses an answers part over its byte cap rather than running without it', async () => {
    // Dropped silently, an over-cap part delivered a file as if the person
    // had said nothing — an unrecorded loss of an attributed claim. Refused,
    // the caller knows.
    repairReads();

    const response = await POST(withAnswers('x'.repeat(MAX_ANSWERS_BYTES + 1)));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      error: 'answers_too_large',
      detail: `limit is ${MAX_ANSWERS_BYTES} bytes`,
    });
    expect(finishDocument).not.toHaveBeenCalled();
  });

  it('measures the cap in bytes, so a CJK part is neither over-counted nor under-counted', async () => {
    // Seventy descriptions of a thousand CJK characters: 70k UTF-16 units,
    // which the old cap (64k units) refused, and ~210 KB of UTF-8, well
    // inside this one. It reaches the route's own checks, which refuse it for
    // naming other bytes — the proof that the door let it through.
    repairReads();
    checkUa1.mockResolvedValue({ checker: 'verapdf-ua1', compliant: false, failingClauses: ['7.3-1'] });
    const answers = {
      inputSha256: 'b'.repeat(64),
      figures: Array.from({ length: 70 }, (_, ordinal) => ({
        ordinal,
        type: 'Figure',
        page: 1,
        prior: 'absent',
        alt: '図'.repeat(1000),
      })),
    };

    const response = await POST(withAnswers(answers));

    expect(response.status).toBe(422);
    expect((await response.json()).detail).toBe('answer-mismatch');
  });
});

describe('what the header carries', () => {
  beforeEach(() => {
    checkUa1.mockReset();
    runtimes.soffice = true;
    runtimes.java = true;
    authorized.ok = true;
  });

  it('keeps the punch list and leaves its identities and the excerpt behind', async () => {
    // The excerpt quotes the document around an open figure for the operator
    // who will describe it. It is the document's own words, and the header
    // travels further than the persisted row — so it stays off the wire, and
    // the asks go with it because a bounded list can no longer be indexed.
    repairReads({
      figures: [{ type: 'Figure', alt: null, actualText: null, page: 1 }],
      images: 1,
      order: [{ type: 'P', text: SECRET_HEADING }, { type: 'Figure', text: null }],
    });
    checkUa1.mockResolvedValue({ checker: 'verapdf-ua1', compliant: false, failingClauses: ['7.3-1'] });

    const response = await POST(upload(pdfBytes(), 'notice.pdf'));
    const header = response.headers.get('x-remediation-summary') ?? '';
    const summary = JSON.parse(header);

    expect(response.status).toBe(200);
    expect(summary.needs).toContainEqual({
      criterion: '1.1.1',
      item: 'Figure 1 (p1): no alt text, no caption to transcribe — write a description',
    });
    expect(summary).not.toHaveProperty('asks');
    expect(summary).not.toHaveProperty('excerpt');
    expect(header).not.toContain('Jane Doe');
  });
});
