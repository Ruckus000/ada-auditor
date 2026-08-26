import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same seam as the triage suite: these tests are about the routes, and the
// cookie/token machinery has its own suite in tests/api/principal.test.ts.
const { principalFromRequest } = vi.hoisted(() => ({ principalFromRequest: vi.fn() }));
vi.mock('../../src/app/api/_lib/principal', () => ({ principalFromRequest }));

const OPERATOR = { kind: 'operator' as const, id: 'op-1', name: 'Alex Reed', email: 'alex@example.com' };

const { GET } = await import(
  '../../src/app/api/platform/clients/[clientId]/credentials/route'
);
const { DELETE, PUT } = await import(
  '../../src/app/api/platform/clients/[clientId]/credentials/[ref]/route'
);
const { MemoryPlatformStore, resetPlatformStore, setPlatformStore } = await import(
  '../../src/integrations/persistence'
);

const TOKEN = 'test-token-16chars';

/** 64 hex chars, committed on purpose — a harness key, not a secret. */
const CIPHER_KEY = 'cd'.repeat(32);

/**
 * Obvious sentinels, because the load-bearing assertions grep entire
 * serialised responses for them. A plausible value would make those greps
 * prove nothing.
 */
const USER_SENTINEL = 'route-user-sentinel@example.com';
const PASS_SENTINEL = 'hunter2-sentinel-route';

function params(clientId: string, ref?: string) {
  return {
    params: Promise.resolve(ref === undefined ? { clientId } : { clientId, ref }),
  } as { params: Promise<{ clientId: string; ref: string }> };
}

function request(body: unknown, method = 'PUT', headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/platform/clients/acme/credentials/portal', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Same-origin plus a session: how the screens call it. */
function fromBrowser(body: unknown, method = 'PUT'): Request {
  principalFromRequest.mockResolvedValue(OPERATOR);
  return request(body, method, { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' });
}

let platform: InstanceType<typeof MemoryPlatformStore>;

describe('/api/platform/clients/[clientId]/credentials', () => {
  const originalToken = process.env.AUDITOR_RUN_TOKEN;
  const originalKey = process.env.AUDITOR_CREDENTIAL_KEY;

  beforeEach(async () => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;
    process.env.AUDITOR_CREDENTIAL_KEY = CIPHER_KEY;
    principalFromRequest.mockReset();
    principalFromRequest.mockResolvedValue(null);
    platform = new MemoryPlatformStore();
    setPlatformStore(platform);
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.AUDITOR_RUN_TOKEN;
    else process.env.AUDITOR_RUN_TOKEN = originalToken;
    if (originalKey === undefined) delete process.env.AUDITOR_CREDENTIAL_KEY;
    else process.env.AUDITOR_CREDENTIAL_KEY = originalKey;
    resetPlatformStore();
  });

  it('refuses an unauthenticated request on every method', async () => {
    const body = { user: USER_SENTINEL, pass: PASS_SENTINEL };
    expect((await PUT(request(body), params('acme', 'portal'))).status).toBe(401);
    expect((await DELETE(request(undefined, 'DELETE'), params('acme', 'portal'))).status).toBe(401);
    expect((await GET(request(undefined, 'GET'), params('acme'))).status).toBe(401);
  });

  it('refuses a cookie carried cross-origin, writing nothing', async () => {
    // A stored credential gets typed into a client's live site. A cross-site
    // page must not be able to plant one with a session cookie it did not earn.
    principalFromRequest.mockResolvedValue(OPERATOR);
    const response = await PUT(
      request({ user: USER_SENTINEL, pass: PASS_SENTINEL }, 'PUT', {
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      }),
      params('acme', 'portal'),
    );

    expect(response.status).toBe(401);
    expect(await platform.listClientCredentialRefs('acme')).toEqual([]);
  });

  it('refuses a client that does not exist', async () => {
    const body = { user: USER_SENTINEL, pass: PASS_SENTINEL };
    expect((await PUT(fromBrowser(body), params('nobody', 'portal'))).status).toBe(404);
    expect((await DELETE(fromBrowser(undefined, 'DELETE'), params('nobody', 'portal'))).status).toBe(404);
    expect((await GET(fromBrowser(undefined, 'GET'), params('nobody'))).status).toBe(404);
  });

  it('answers 503 on a write while no key is configured, and stores nothing', async () => {
    // Absent key means the store is disabled, not degraded: accepting the
    // value would store something no deployment could ever read back. The env
    // fallback is untouched, which is why this is a 503 and not a 500.
    delete process.env.AUDITOR_CREDENTIAL_KEY;

    const response = await PUT(
      fromBrowser({ user: USER_SENTINEL, pass: PASS_SENTINEL }),
      params('acme', 'portal'),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'credential_store_not_configured' });
    expect(await platform.listClientCredentialRefs('acme')).toEqual([]);
  });

  it('refuses a ref that is not a plain identifier', async () => {
    const body = { user: USER_SENTINEL, pass: PASS_SENTINEL };
    for (const ref of ['../etc', 'a b', 'a'.repeat(65), '']) {
      expect((await PUT(fromBrowser(body), params('acme', ref))).status).toBe(400);
    }
    expect(await platform.listClientCredentialRefs('acme')).toEqual([]);
  });

  it('refuses an empty or oversized value', async () => {
    for (const body of [
      { user: '', pass: PASS_SENTINEL },
      { user: USER_SENTINEL, pass: '' },
      { user: USER_SENTINEL },
      { pass: PASS_SENTINEL },
      { user: USER_SENTINEL, pass: 'x'.repeat(513) },
    ]) {
      expect((await PUT(fromBrowser(body), params('acme', 'portal'))).status).toBe(400);
    }
  });

  it('stores a credential and echoes presence, never the value', async () => {
    const response = await PUT(
      fromBrowser({ user: USER_SENTINEL, pass: PASS_SENTINEL }),
      params('acme', 'portal'),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ref: 'portal', fields: ['user', 'pass'] });
    // The write-only guarantee, checked against the WHOLE response: a value
    // smuggled out under any key is the leak.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain(USER_SENTINEL);
    expect(serialised).not.toContain(PASS_SENTINEL);

    expect(await platform.getClientCredentialValues('acme', 'portal')).toEqual({
      user: USER_SENTINEL,
      pass: PASS_SENTINEL,
    });
  });

  it('lists presence for the client and nothing else', async () => {
    await PUT(fromBrowser({ user: USER_SENTINEL, pass: PASS_SENTINEL }), params('acme', 'portal'));

    const response = await GET(fromBrowser(undefined, 'GET'), params('acme'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.credentials).toMatchObject([{ ref: 'portal', user: true, pass: true }]);
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain(USER_SENTINEL);
    expect(serialised).not.toContain(PASS_SENTINEL);
  });

  it('removes a credential and says so without a value', async () => {
    await PUT(fromBrowser({ user: USER_SENTINEL, pass: PASS_SENTINEL }), params('acme', 'portal'));

    const response = await DELETE(fromBrowser(undefined, 'DELETE'), params('acme', 'portal'));

    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(PASS_SENTINEL);
    expect(await platform.listClientCredentialRefs('acme')).toEqual([]);
  });

  it('records both decisions to the activity feed with the ref and never a value', async () => {
    await PUT(fromBrowser({ user: USER_SENTINEL, pass: PASS_SENTINEL }), params('acme', 'portal'));
    await DELETE(fromBrowser(undefined, 'DELETE'), params('acme', 'portal'));

    const events = await platform.listEvents({ clientId: 'acme' });
    expect(events.map((event) => event.action)).toEqual([
      'removed a credential',
      'stored a credential',
    ]);
    for (const event of events) {
      expect(event.metadata).toEqual({ ref: 'portal' });
      expect(event.actor).toBe('Alex Reed');
    }
    // The feed is append-only and read back by screens; a value here would be
    // a secret with an audience.
    const serialised = JSON.stringify(events);
    expect(serialised).not.toContain(USER_SENTINEL);
    expect(serialised).not.toContain(PASS_SENTINEL);
  });
});
