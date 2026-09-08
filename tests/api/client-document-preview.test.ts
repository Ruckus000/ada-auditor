import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({
  authorize: vi.fn(), documents: vi.fn(), getClient: vi.fn(), getConversion: vi.fn(),
  read: vi.fn(), fetchBytes: vi.fn(), render: vi.fn(),
}));
vi.mock('../../src/app/api/_lib/authorize', () => ({ authorizePrincipal: deps.authorize }));
vi.mock('../../src/integrations/persistence', () => ({ getPlatformStore: () => ({ getClient: deps.getClient, getDocumentConversion: deps.getConversion }) }));
vi.mock('../../src/services/document-delivery', () => ({ allDeliveryDocuments: deps.documents }));
vi.mock('../../src/integrations/artifacts/blob-store', () => ({ getArtifactStore: () => ({ read: deps.read }) }));
vi.mock('../../src/app/api/_lib/document-fetch', () => ({ fetchDocumentBytes: deps.fetchBytes }));
vi.mock('../../src/integrations/documents/preview', () => ({ previewDocument: deps.render }));
import { GET } from '../../src/app/api/platform/clients/[clientId]/documents/[documentId]/preview/route';
const at = '2026-09-07T12:00:00.000Z';
const bytes = Buffer.from('%PDF-fixture');
const hash = createHash('sha256').update(bytes).digest('hex');
const context = { params: Promise.resolve({ clientId: 'c', documentId: 'd' }) };
const request = (reading = at) => new Request(`https://example.test/preview?reading=${encodeURIComponent(reading)}`);
const record = () => ({ id: 'd', clientId: 'c', kind: 'pdf', source: 'crawl', url: 'https://example.test/a.pdf', latestInspection: { inspectedAt: at, inputSha256: hash, summary: {} } });
describe('inventory preview isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deps.authorize.mockResolvedValue({ kind: 'operator', id: 'op', name: 'Operator' });
    deps.getClient.mockResolvedValue({ id: 'c' }); deps.documents.mockResolvedValue([record()]);
    deps.fetchBytes.mockResolvedValue({ ok: true, bytes });
    deps.render.mockResolvedValue({ ok: true, value: { page: 1, pages: 1, width: 1, height: 1, png: 'x', figures: [] } });
  });
  it('authorizes before reading inventory or buffering source', async () => {
    deps.authorize.mockResolvedValue(null);
    expect((await GET(request(), context)).status).toBe(401);
    expect(deps.documents).not.toHaveBeenCalled(); expect(deps.fetchBytes).not.toHaveBeenCalled();
  });
  it('refuses an obsolete reading before fetching source bytes', async () => {
    const response = await GET(request('old'), context);
    expect(response.status).toBe(409); expect((await response.json()).error).toBe('preview_reading_changed');
    expect(deps.fetchBytes).not.toHaveBeenCalled();
  });
  it('rejects changed source bytes without placing old asks', async () => {
    deps.fetchBytes.mockResolvedValue({ ok: true, bytes: Buffer.from('changed') });
    const response = await GET(request(), context);
    expect(response.status).toBe(409); expect((await response.json()).error).toBe('preview_bytes_changed');
    expect(deps.render).not.toHaveBeenCalled();
  });
  it('refuses a conversion from another client before reading its artifact', async () => {
    const document = { ...record(), latestConversion: { id: 'converted', convertedAt: at + '1', inputSha256: hash, artifactUrl: 'private', summary: {} } };
    deps.documents.mockResolvedValue([document]); deps.getConversion.mockResolvedValue({ clientId: 'other', artifactUrl: 'private' });
    expect((await GET(request(at + '1'), context)).status).toBe(404);
    expect(deps.read).not.toHaveBeenCalled();
  });
  it('returns a bounded unavailable response when the store fails', async () => {
    deps.documents.mockRejectedValue(new Error('database connection secret'));
    const response = await GET(request(), context);
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('renders exact matching bytes with no-store identity', async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(200); expect((await response.json()).sha256).toBe(hash);
    expect(deps.render).toHaveBeenCalledOnce();
  });
});
