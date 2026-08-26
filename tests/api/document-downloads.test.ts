import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two doors to a stored converted document: the operator's, and the
 * shared report's. The blob store is mocked (its own streaming is the SDK's);
 * everything here is who gets through which door, and that the blob URL
 * itself never crosses the wire.
 */

const { storeBytes, read } = vi.hoisted(() => ({ storeBytes: vi.fn(), read: vi.fn() }));
vi.mock('../../src/integrations/artifacts/blob-store', () => ({
  getArtifactStore: () => ({ storeBytes, read }),
}));

const authorized = vi.hoisted(() => ({ ok: true }));
vi.mock('../../src/app/api/_lib/authorize', () => ({
  authorizePrincipal: async () => (authorized.ok ? { kind: 'machine', name: 'CI' } : null),
}));

const { GET: operatorGet } = await import(
  '../../src/app/api/platform/clients/[clientId]/documents/conversions/[conversionId]/route'
);
const { GET: sharedGet } = await import('../../src/app/r/[token]/documents/[conversionId]/route');
const { MemoryPlatformStore, resetPlatformStore, setPlatformStore } = await import(
  '../../src/integrations/persistence'
);
const { buildDocumentReport } = await import('../../src/services/document-report');

const BLOB_URL = 'https://blob.example/documents/acme/conv-1-suffix.pdf';
const PDF_BODY = '%PDF-1.7 delivered';

function pdfStream(): ReadableStream<Uint8Array> {
  return new Response(PDF_BODY).body as ReadableStream<Uint8Array>;
}

function summary() {
  return {
    title: 'transcribed' as const,
    titleText: 'Objection of Jane Doe',
    sourceLanguage: 'en-US',
    tagged: true,
    pages: 2,
    headings: 1,
    tables: 0,
    lists: 0,
    figures: 0,
    gaps: [],
  };
}

let platform: InstanceType<typeof MemoryPlatformStore>;

async function seedConversion(withArtifact = true): Promise<string> {
  const doc = await platform.ensureClientDocument(
    'acme',
    { url: 'https://town.example/permit.docx', kind: 'docx', source: 'crawl' },
    '2026-08-26T09:00:00.000Z',
  );
  await platform.saveDocumentConversion({
    id: 'conv-1',
    clientId: 'acme',
    documentId: doc.id,
    summary: summary(),
    inputSha256: 'a'.repeat(64),
    outputSha256: 'b'.repeat(64),
    ...(withArtifact ? { artifactUrl: BLOB_URL } : {}),
    convertedAt: '2026-08-26T10:00:00.000Z',
  });
  return doc.id;
}

describe('document downloads', () => {
  beforeEach(async () => {
    authorized.ok = true;
    read.mockReset();
    read.mockResolvedValue({ status: 'ok', contentType: 'application/pdf', body: pdfStream() });
    platform = new MemoryPlatformStore();
    setPlatformStore(platform);
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
    await platform.upsertClient({ id: 'rival', name: 'Rival' });
  });

  afterEach(() => {
    resetPlatformStore();
  });

  describe('operator route', () => {
    function params(clientId: string, conversionId: string) {
      return { params: Promise.resolve({ clientId, conversionId }) };
    }
    const request = new Request('http://localhost/x');

    it('streams the delivered file, blob URL never crossing the wire', async () => {
      await seedConversion();

      const response = await operatorGet(request, params('acme', 'conv-1'));

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/pdf');
      expect(response.headers.get('content-disposition')).toContain('remediated-conv-1.pdf');
      expect(await response.text()).toBe(PDF_BODY);
      // The store was read with the RECORD's URL — never a caller-supplied
      // string — and the response leaks it nowhere.
      expect(read).toHaveBeenCalledWith(BLOB_URL);
      expect(response.headers.get('content-disposition')).not.toContain('blob.example');
    });

    it('refuses an unauthenticated caller before touching anything', async () => {
      await seedConversion();
      authorized.ok = false;

      expect((await operatorGet(request, params('acme', 'conv-1'))).status).toBe(401);
      expect(read).not.toHaveBeenCalled();
    });

    it("404s another client's conversion — ownership is the path's clientId", async () => {
      await seedConversion();

      expect((await operatorGet(request, params('rival', 'conv-1'))).status).toBe(404);
      expect(read).not.toHaveBeenCalled();
    });

    it('404s honestly when the file was never stored', async () => {
      await seedConversion(false);

      const response = await operatorGet(request, params('acme', 'conv-1'));

      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe('artifact_not_stored');
    });
  });

  describe('shared report route', () => {
    function params(token: string, conversionId: string) {
      return { params: Promise.resolve({ token, conversionId }) };
    }
    const request = new Request('http://localhost/x');

    async function issueReportWithSnapshot(): Promise<void> {
      const documents = (await platform.listClientDocuments('acme')).documents;
      await platform.createReport({
        id: 'report-1',
        requestId: 'run-1',
        shareToken: 'the-token',
        documents: buildDocumentReport(documents, '2026-08-26T11:00:00.000Z'),
      });
    }

    it('streams the file the pinned snapshot offered, with no session at all', async () => {
      await seedConversion();
      await issueReportWithSnapshot();
      authorized.ok = false; // Nothing here consults the platform session.

      const response = await sharedGet(request, params('the-token', 'conv-1'));

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(PDF_BODY);
    });

    it('404s a conversion the snapshot never offered', async () => {
      await seedConversion();
      // A report issued BEFORE the conversion existed: snapshot without it.
      await platform.createReport({
        id: 'report-early',
        requestId: 'run-1',
        shareToken: 'early-token',
        documents: buildDocumentReport([], '2026-08-26T08:00:00.000Z'),
      });

      expect((await sharedGet(request, params('early-token', 'conv-1'))).status).toBe(404);
      expect(read).not.toHaveBeenCalled();
    });

    it('dies with the token: a revoked report downloads nothing', async () => {
      await seedConversion();
      await issueReportWithSnapshot();
      await platform.revokeShareToken('report-1');

      expect((await sharedGet(request, params('the-token', 'conv-1'))).status).toBe(404);
      expect(read).not.toHaveBeenCalled();
    });

    it('404s a token that never existed', async () => {
      await seedConversion();

      expect((await sharedGet(request, params('no-such-token', 'conv-1'))).status).toBe(404);
    });
  });
});
