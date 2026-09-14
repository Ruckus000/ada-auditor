import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The delivery doors: sign-off, exclusion, prepare, issue/revoke, and the
 * client's download.
 *
 * These landed with no route test at all. The service is covered in
 * `tests/services/document-delivery.test.ts`; what is asserted here is what
 * only a route can get wrong — who may call it, whose records it reaches, what
 * it charges, what it records, and what it logs.
 */

const principal = vi.hoisted(() => ({ value: null as null | { kind: string; id?: string; name: string } }));
vi.mock('../../src/app/api/_lib/authorize', () => ({ authorizePrincipal: async () => principal.value }));

const blobs = vi.hoisted(() => new Map<string, Buffer>());
vi.mock('../../src/integrations/artifacts/blob-store', () => ({
  getArtifactStore: () => ({
    upload: async () => ({}),
    storeBytes: async (path: string, bytes: Uint8Array) => { blobs.set(path, Buffer.from(bytes)); return { url: path }; },
    read: async (url: string) => {
      const bytes = blobs.get(url);
      return bytes
        ? { status: 'ok' as const, contentType: 'application/octet-stream', body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(bytes)); c.close(); } }) }
        : { status: 'pruned' as const };
    },
  }),
}));
vi.mock('../../src/integrations/documents/archive', () => ({
  createDeliveryArchive: vi.fn(async (entries: Array<{ name: string }>) => Buffer.from(JSON.stringify(entries.map((e) => e.name)))),
}));
vi.mock('../../src/integrations/documents/verapdf', () => ({ verifyPdfBytes: vi.fn() }));

const { MemoryPlatformStore, resetPlatformStore, setPlatformStore } = await import('../../src/integrations/persistence');
const { MemoryRunCounter, resetRunCounter, setRunCounter } = await import('../../src/app/api/_lib/run-counter');
const { deliveryOverview } = await import('../../src/services/document-delivery');
const signoffRoute = await import('../../src/app/api/platform/clients/[clientId]/documents/[documentId]/signoff/route');
const exclusionRoute = await import('../../src/app/api/platform/clients/[clientId]/documents/[documentId]/exclusion/route');
const deliveryRoute = await import('../../src/app/api/platform/clients/[clientId]/delivery/route');
const bundleRoute = await import('../../src/app/api/platform/clients/[clientId]/delivery/[bundleId]/route');
const downloadRoute = await import('../../src/app/d/[token]/download/route');

const OPERATOR = { kind: 'operator', id: 'op-1', name: 'Alex' };
const MACHINE = { kind: 'machine', name: 'CI' };
const SECRET_PATH = '/forms/objection-of-jane-doe.pdf';
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

let platform: InstanceType<typeof MemoryPlatformStore>;
let documentId: string;

function post(body: unknown) {
  return new Request('http://localhost/api/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
const documentParams = (clientId = 'acme') => ({ params: Promise.resolve({ clientId, documentId }) });
const clientParams = (clientId = 'acme') => ({ params: Promise.resolve({ clientId }) });

async function fingerprint() {
  return (await deliveryOverview(platform, 'acme')).rows.find((r) => r.record.id === documentId)!.fingerprint;
}

async function signedBundle() {
  principal.value = OPERATOR;
  expect((await signoffRoute.POST(post({ fingerprint: await fingerprint() }), documentParams())).status).toBe(200);
  const prepared = await deliveryRoute.POST(post({ documentIds: [documentId] }), clientParams());
  expect(prepared.status).toBe(201);
  return (await prepared.json()).bundle as { id: string };
}

beforeEach(async () => {
  setRunCounter(new MemoryRunCounter());
  blobs.clear();
  blobs.set('output', Buffer.from('verified output'));
  blobs.set('report', Buffer.from('{"verified":true}'));
  platform = new MemoryPlatformStore();
  setPlatformStore(platform);
  await platform.upsertClient({ id: 'acme', name: 'Acme' });
  await platform.upsertClient({ id: 'other', name: 'Other' });
  const record = await platform.ensureClientDocument('acme', { url: `https://town.example${SECRET_PATH}`, kind: 'pdf', source: 'crawl', contentSha256: sha('source') }, '2026-09-01T00:00:00.000Z');
  documentId = record.id;
  await platform.saveDocumentConversion({
    id: 'conversion-a', clientId: 'acme', documentId, inputSha256: sha('source'), outputSha256: sha('verified output'),
    artifactUrl: 'output', verificationArtifactUrl: 'report', verificationSha256: sha('{"verified":true}'), convertedAt: '2026-09-02T00:00:00.000Z',
    summary: { title: 'already-titled', sourceLanguage: 'en', tagged: true, pages: 1, headings: 1, figures: 0, tables: 0, lists: 0, gaps: [],
      conformance: { checker: 'verapdf-ua1', compliant: true } },
  });
  principal.value = OPERATOR;
});

afterEach(() => {
  resetPlatformStore();
  resetRunCounter();
  delete process.env.AUDITOR_MAX_DOCUMENTS_PER_HOUR;
  vi.restoreAllMocks();
});

describe('delivery routes', () => {
  it('refuses an unauthenticated caller at every door', async () => {
    principal.value = null;
    expect((await signoffRoute.POST(post({ fingerprint: 'a'.repeat(64) }), documentParams())).status).toBe(401);
    expect((await exclusionRoute.POST(post({ reason: 'x' }), documentParams())).status).toBe(401);
    expect((await deliveryRoute.GET(new Request('http://localhost/'), clientParams())).status).toBe(401);
    expect((await deliveryRoute.POST(post({ documentIds: [documentId] }), clientParams())).status).toBe(401);
  });

  it('keeps every attestation a person: the machine token may not sign, exclude, prepare or issue', async () => {
    principal.value = MACHINE;
    expect((await signoffRoute.POST(post({ fingerprint: await fingerprint() }), documentParams())).status).toBe(403);
    expect((await exclusionRoute.POST(post({ reason: 'x' }), documentParams())).status).toBe(403);
    expect((await deliveryRoute.POST(post({ documentIds: [documentId] }), clientParams())).status).toBe(403);
  });

  it('refuses a sign-off that does not name the state it was shown', async () => {
    const missing = await signoffRoute.POST(post({}), documentParams());
    expect(missing.status).toBe(400);
    const stale = await signoffRoute.POST(post({ fingerprint: 'f'.repeat(64) }), documentParams());
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe('document_changed');
    expect(await platform.listDocumentSignoffs('acme')).toEqual([]);
  });

  it('lists the fingerprint each row was shown with', async () => {
    const body = await (await deliveryRoute.GET(new Request('http://localhost/'), clientParams())).json();
    expect(body.rows[0].fingerprint).toBe(await fingerprint());
    expect(body.rows[0].knownDifferences).toEqual([]);
  });

  it("will not reach another client's bundle", async () => {
    const bundle = await signedBundle();
    const context = { params: Promise.resolve({ clientId: 'other', bundleId: bundle.id }) };
    expect((await bundleRoute.GET(new Request('http://localhost/'), context)).status).toBe(404);
    expect((await bundleRoute.POST(post({ action: 'issue' }), context)).status).toBe(404);
  });

  it('refuses to revoke a link that was never issued, and records nothing', async () => {
    const bundle = await signedBundle();
    const context = { params: Promise.resolve({ clientId: 'acme', bundleId: bundle.id }) };
    const response = await bundleRoute.POST(post({ action: 'revoke' }), context);
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('delivery_not_issued');
    expect((await platform.listEvents({ clientId: 'acme' })).map((e) => e.action)).not.toContain('delivery.revoked');
  });

  it('closes the client download the moment the link is revoked', async () => {
    const bundle = await signedBundle();
    const context = { params: Promise.resolve({ clientId: 'acme', bundleId: bundle.id }) };
    const issued = await (await bundleRoute.POST(post({ action: 'issue' }), context)).json();
    const token = issued.bundle.token as string;
    const tokenContext = { params: Promise.resolve({ token }) };

    const open = await downloadRoute.GET(new Request('http://localhost/'), tokenContext);
    expect(open.status).toBe(200);
    expect(open.headers.get('x-robots-tag')).toContain('noindex');
    expect(open.headers.get('cache-control')).toBe('private, no-store');

    expect((await bundleRoute.POST(post({ action: 'revoke' }), context)).status).toBe(200);
    expect((await downloadRoute.GET(new Request('http://localhost/'), tokenContext)).status).toBe(404);
  });

  it('charges the document budget before archiving a delivery', async () => {
    process.env.AUDITOR_MAX_DOCUMENTS_PER_HOUR = '1';
    await signedBundle(); // the one unit this hour allows
    const refused = await deliveryRoute.POST(post({ documentIds: [documentId] }), clientParams());
    expect(refused.status).toBe(429);
    const body = await refused.json();
    expect(body.error).toBe('document_budget_exceeded');
    // The sentence that says when the window resets — every other document
    // door forwards it, and without it a screen can only guess.
    expect(body.message).toMatch(/\S/);
    expect(await platform.listDeliveryBundles('acme')).toHaveLength(1);
  });

  it('never logs the URL path of a document it delivers', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => { lines.push(String(line)); });
    vi.spyOn(console, 'warn').mockImplementation((line: unknown) => { lines.push(String(line)); });
    const bundle = await signedBundle();
    await bundleRoute.POST(post({ action: 'issue' }), { params: Promise.resolve({ clientId: 'acme', bundleId: bundle.id }) });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(SECRET_PATH);
  });
});
