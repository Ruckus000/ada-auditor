import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The client-scoped crawl — the one that REMEMBERS.
 *
 * The crawl itself is mocked (`discoverLinks`; it has its own browser suite);
 * everything here is about what the route adds over `/api/platform/discover`:
 * the merge into the client's inventory, the counts that report it, and the
 * refusals that merge nothing.
 */

const { discoverLinks } = vi.hoisted(() => ({ discoverLinks: vi.fn() }));
vi.mock('../../src/integrations/browser/discover-links', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/integrations/browser/discover-links')>()),
  discoverLinks,
}));

const authorized = vi.hoisted(() => ({ ok: true }));
vi.mock('../../src/app/api/_lib/authorize', () => ({
  authorizePrincipal: async () => (authorized.ok ? { kind: 'machine', name: 'CI' } : null),
}));

const { POST } = await import(
  '../../src/app/api/platform/clients/[clientId]/documents/discover/route'
);
const { UnsafeTargetError } = await import('../../src/integrations/browser/target-url');
const { MemoryPlatformStore, resetPlatformStore, setPlatformStore } = await import(
  '../../src/integrations/persistence'
);

function params(clientId: string) {
  return { params: Promise.resolve({ clientId }) };
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/platform/clients/acme/documents/discover', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const TARGET = 'https://town.example/';

function crawlFinds(documents: unknown[]) {
  discoverLinks.mockResolvedValue({ pages: [], documents, errors: [] });
}

let platform: InstanceType<typeof MemoryPlatformStore>;

describe('POST /api/platform/clients/[clientId]/documents/discover', () => {
  beforeEach(async () => {
    discoverLinks.mockReset();
    crawlFinds([
      {
        url: 'https://town.example/minutes/agenda.pdf',
        foundOn: TARGET,
        kind: 'pdf',
      },
      {
        url: 'https://cdn.builder.invalid/assets/permit.docx',
        foundOn: TARGET,
        kind: 'docx',
      },
    ]);
    authorized.ok = true;
    platform = new MemoryPlatformStore();
    setPlatformStore(platform);
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
  });

  afterEach(() => {
    resetPlatformStore();
  });

  it('merges what the crawl saw into the inventory, and says how the merge fell', async () => {
    const first = await POST(request({ targetUrl: TARGET }), params('acme'));
    const firstBody = await first.json();

    expect(first.status).toBe(200);
    expect(firstBody.merge).toEqual({ added: 2, seenAgain: 0 });
    expect(firstBody.documents).toHaveLength(2);

    const documents = await platform.listClientDocuments('acme');
    expect(documents.map((doc) => doc.kind).sort()).toEqual(['docx', 'pdf']);
    // The CDN-hosted document merged like any other: linked from the client's
    // page is what makes it the client's.
    expect(documents.map((doc) => doc.url)).toContain(
      'https://cdn.builder.invalid/assets/permit.docx',
    );

    // A re-scan refreshes rather than duplicates — the reason the inventory
    // exists at all.
    const second = await POST(request({ targetUrl: TARGET }), params('acme'));
    expect((await second.json()).merge).toEqual({ added: 0, seenAgain: 2 });
    expect(await platform.listClientDocuments('acme')).toHaveLength(2);
  });

  it('refuses an unauthenticated caller before crawling', async () => {
    authorized.ok = false;

    expect((await POST(request({ targetUrl: TARGET }), params('acme'))).status).toBe(401);
    expect(discoverLinks).not.toHaveBeenCalled();
  });

  it('answers 404 for a client that does not exist, before crawling', async () => {
    expect((await POST(request({ targetUrl: TARGET }), params('nobody'))).status).toBe(404);
    expect(discoverLinks).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a target URL', async () => {
    expect((await POST(request({ targetUrl: 'not a url' }), params('acme'))).status).toBe(400);
    expect((await POST(request({ nope: true }), params('acme'))).status).toBe(400);
    expect(discoverLinks).not.toHaveBeenCalled();
  });

  it('maps a crawl refusal through the shared branches, and merges nothing', async () => {
    discoverLinks.mockRejectedValue(new UnsafeTargetError('private or reserved address'));

    const response = await POST(request({ targetUrl: TARGET }), params('acme'));

    expect(response.status).toBe(400);
    expect(await platform.listClientDocuments('acme')).toEqual([]);
  });
});
