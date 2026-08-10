import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The routes resolve a principal now rather than asking "is there a
// session?". Mocking that seam keeps these tests about the routes; the
// cookie/token machinery has its own suite in tests/api/principal.test.ts.
const { principalFromRequest } = vi.hoisted(() => ({ principalFromRequest: vi.fn() }));
vi.mock('../../src/app/api/_lib/principal', () => ({ principalFromRequest }));

const OPERATOR = { kind: 'operator' as const, id: 'op-1', name: 'Alex Reed', email: 'alex@example.com' };

const { GET, POST } = await import('../../src/app/api/platform/clients/route');
const {
  MemoryPlatformStore,
  MemoryRunStore,
  resetPlatformStore,
  resetRunStore,
  setPlatformStore,
  setRunStore,
} = await import('../../src/integrations/persistence');

const TOKEN = 'test-token-16chars';

function request(body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/platform/clients', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Same-origin plus a session: how the screens call it. */
function fromBrowser(body?: unknown): Request {
  principalFromRequest.mockResolvedValue(OPERATOR);
  return request(body, { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' });
}

/** Bearer token: how CI and scripts call it. */
function fromScript(body?: unknown): Request {
  return request(body, { authorization: `Bearer ${TOKEN}` });
}

let platform: InstanceType<typeof MemoryPlatformStore>;

describe('/api/platform/clients', () => {
  const originalToken = process.env.AUDITOR_RUN_TOKEN;

  beforeEach(() => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;
    principalFromRequest.mockReset();
    principalFromRequest.mockResolvedValue(null);
    platform = new MemoryPlatformStore();
    setPlatformStore(platform);
    setRunStore(new MemoryRunStore());
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.AUDITOR_RUN_TOKEN;
    else process.env.AUDITOR_RUN_TOKEN = originalToken;
    resetPlatformStore();
    resetRunStore();
  });

  it('refuses an unauthenticated request', async () => {
    // The layout's gate protects rendering only. This route is reachable
    // directly, so it checks for itself.
    expect((await GET(request())).status).toBe(401);
    expect((await POST(request({ name: 'Acme' }))).status).toBe(401);
  });

  it('refuses a cookie carried cross-origin', async () => {
    // A session cookie travels on cross-site posts too. Without the
    // same-origin check, any page could add clients to the operator's account.
    principalFromRequest.mockResolvedValue(OPERATOR);
    const response = await POST(
      request({ name: 'Acme' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }),
    );

    expect(response.status).toBe(401);
    expect(await platform.listClients()).toEqual([]);
  });

  it('starts empty, because nothing is seeded', async () => {
    const body = await (await GET(fromScript())).json();

    expect(body.count).toBe(0);
    expect(body.clients).toEqual([]);
  });

  it('adds a client and gives it a readable id', async () => {
    const response = await POST(fromBrowser({ name: 'Acme Outfitters', owner: 'Alex Reed' }));

    expect(response.status).toBe(201);
    expect((await response.json()).client).toMatchObject({
      id: 'acme-outfitters',
      name: 'Acme Outfitters',
    });

    const [stored] = await platform.listClients();
    expect(stored).toMatchObject({ id: 'acme-outfitters', owner: 'Alex Reed' });
  });

  it('suffixes a duplicate name rather than overwriting the first client', async () => {
    // The id is the URL. Reusing it would silently show one client's findings
    // under the other's name.
    await POST(fromBrowser({ name: 'Acme' }));
    const second = await POST(fromBrowser({ name: 'Acme' }));

    expect((await second.json()).client.id).toBe('acme-2');
    expect((await platform.listClients()).map((c) => c.id)).toEqual(['acme', 'acme-2']);
  });

  it('records who added the client', async () => {
    // Activity is attributed to the configured operator name; there is no
    // per-user identity to attribute it to.
    await POST(fromBrowser({ name: 'Acme' }));

    const [event] = await platform.listEvents({ clientId: 'acme' });
    expect(event).toMatchObject({ actor: 'Alex Reed', action: 'added a client', subject: 'Acme' });
  });

  it.each([
    ['no name', {}],
    ['blank name', { name: '   ' }],
    ['a name that is not a string', { name: 42 }],
    ['an over-long name', { name: 'x'.repeat(200) }],
  ])('rejects %s', async (_label, body) => {
    expect((await POST(fromBrowser(body))).status).toBe(400);
    expect(await platform.listClients()).toEqual([]);
  });

  it('lists a client it just added', async () => {
    await POST(fromBrowser({ name: 'Acme' }));

    const body = await (await GET(fromScript())).json();
    expect(body.count).toBe(1);
    expect(body.clients[0]).toMatchObject({ id: 'acme', journeyCount: 0, lastRun: null });
  });
});
