import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The routes resolve a principal now rather than asking "is there a
// session?". Mocking that seam keeps these tests about the routes; the
// cookie/token machinery has its own suite in tests/api/principal.test.ts.
const { principalFromRequest } = vi.hoisted(() => ({ principalFromRequest: vi.fn() }));
vi.mock('../../src/app/api/_lib/principal', () => ({ principalFromRequest }));

const OPERATOR = { kind: 'operator' as const, id: 'op-1', name: 'Alex Reed', email: 'alex@example.com' };

const { GET, POST } = await import(
  '../../src/app/api/platform/clients/[clientId]/journeys/route'
);
const { MemoryPlatformStore, resetPlatformStore, setPlatformStore } = await import(
  '../../src/integrations/persistence'
);

const TOKEN = 'test-token-16chars';

function params(clientId: string) {
  return { params: Promise.resolve({ clientId }) };
}

function request(body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/platform/clients/acme/journeys', {
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

let platform: InstanceType<typeof MemoryPlatformStore>;

describe('/api/platform/clients/[clientId]/journeys', () => {
  const originalToken = process.env.AUDITOR_RUN_TOKEN;

  beforeEach(async () => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;
    principalFromRequest.mockReset();
    principalFromRequest.mockResolvedValue(null);
    platform = new MemoryPlatformStore();
    setPlatformStore(platform);
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.AUDITOR_RUN_TOKEN;
    else process.env.AUDITOR_RUN_TOKEN = originalToken;
    resetPlatformStore();
  });

  it('refuses an unauthenticated request', async () => {
    expect((await GET(request(), params('acme'))).status).toBe(401);
    expect((await POST(request({ name: 'Checkout' }), params('acme'))).status).toBe(401);
  });

  it('refuses a cookie carried cross-origin', async () => {
    // A session cookie travels on cross-site posts too. Without this, any page
    // could write journeys into the operator's account.
    principalFromRequest.mockResolvedValue(OPERATOR);
    const response = await POST(
      request({ name: 'Checkout' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }),
      params('acme'),
    );

    expect(response.status).toBe(401);
    expect(await platform.listJourneys('acme')).toEqual([]);
  });

  it('refuses a client that does not exist', async () => {
    // Otherwise a typo silently creates a journey nobody owns, which is the
    // `client-unassigned` hole this route exists to close.
    expect((await POST(fromBrowser({ name: 'Checkout' }), params('nobody'))).status).toBe(404);
    expect((await GET(fromBrowser(), params('nobody'))).status).toBe(404);
  });

  it('records a journey against the client that owns it', async () => {
    const response = await POST(
      fromBrowser({ name: 'Checkout', targetUrl: 'https://acme.test/cart' }),
      params('acme'),
    );

    expect(response.status).toBe(201);
    expect((await response.json()).journey.id).toBe('acme-checkout');

    const [stored] = await platform.listJourneys('acme');
    expect(stored).toMatchObject({
      id: 'acme-checkout',
      clientId: 'acme',
      name: 'Checkout',
      targetUrl: 'https://acme.test/cart',
    });
  });

  it('scopes the id to the client', async () => {
    // Two clients may both have a journey called Checkout, and they are not
    // the same journey. The id is global — runs reference it — so an unscoped
    // slug would attach one client's runs to the other's screen.
    await platform.upsertClient({ id: 'other', name: 'Other' });
    await POST(fromBrowser({ name: 'Checkout' }), params('acme'));
    await POST(fromBrowser({ name: 'Checkout' }), params('other'));

    expect((await platform.listJourneys('acme'))[0].id).toBe('acme-checkout');
    expect((await platform.listJourneys('other'))[0].id).toBe('other-checkout');
  });

  it('suffixes a repeated name rather than overwriting the first journey', async () => {
    await POST(fromBrowser({ name: 'Checkout' }), params('acme'));
    const second = await POST(fromBrowser({ name: 'Checkout' }), params('acme'));

    expect((await second.json()).journey.id).toBe('acme-checkout-2');
    expect(await platform.listJourneys('acme')).toHaveLength(2);
  });

  it('refuses a step carrying a credential rather than a reference to one', async () => {
    // A journey is stored whole. A literal here would be a password written
    // into a database column, which is the rule the credential refs exist for.
    const response = await POST(
      fromBrowser({
        name: 'Login',
        steps: [{ action: 'fill', selector: '#pw', password: 'hunter2' }],
      }),
      params('acme'),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('inline_credential');
    expect(await platform.listJourneys('acme')).toEqual([]);
  });

  it('accepts a step that references a credential', async () => {
    const response = await POST(
      fromBrowser({
        name: 'Login',
        steps: [{ action: 'fill', selector: '#pw', credentialRef: 'acme', field: 'pass' }],
      }),
      params('acme'),
    );

    expect(response.status).toBe(201);
    expect((await platform.listJourneys('acme'))[0].steps).toHaveLength(1);
  });

  it.each([
    ['no name', {}],
    ['a blank name', { name: '  ' }],
    ['a target that is not a URL', { name: 'Checkout', targetUrl: 'not-a-url' }],
  ])('rejects %s', async (_label, body) => {
    expect((await POST(fromBrowser(body), params('acme'))).status).toBe(400);
    expect(await platform.listJourneys('acme')).toEqual([]);
  });

  it('lists the journeys it recorded', async () => {
    await POST(fromBrowser({ name: 'Checkout' }), params('acme'));

    const body = await (await GET(fromBrowser(), params('acme'))).json();
    expect(body.count).toBe(1);
    expect(body.journeys[0]).toMatchObject({ id: 'acme-checkout', clientId: 'acme' });
  });

  it('records who recorded it', async () => {
    await POST(fromBrowser({ name: 'Checkout' }), params('acme'));

    const [event] = await platform.listEvents({ clientId: 'acme' });
    expect(event).toMatchObject({ actor: 'Alex Reed', action: 'recorded a journey' });
  });

  /**
   * Creating is scheduling, and this route was the last one deciding
   * runnability on its own.
   *
   * The schedule route refuses to book a journey that cannot run; this one
   * takes a `schedule` too and took it unchecked, so the whole refusal was one
   * POST away from being bypassed. The tick would not have claimed the row —
   * the claim query refuses it as well — but the screens hide the cadence
   * picker for an unrunnable journey, so it would have been stored `daily`
   * where nobody could see it and nobody could clear it.
   */
  it.each([
    ['no steps', { name: 'Checkout', targetUrl: 'https://acme.test/', schedule: 'daily' }, 'journey_has_no_steps'],
    ['no target URL', { name: 'Checkout', steps: [{ action: 'navigate', type: 'goto', path: '/' }], schedule: 'weekly' }, 'journey_not_runnable'],
  ])('refuses to create a journey scheduled with %s', async (_label, body, error) => {
    const response = await POST(fromBrowser(body), params('acme'));

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe(error);
    // Refused, not stored-then-refused.
    expect(await platform.listJourneys('acme')).toEqual([]);
  });

  it('still creates an unrunnable journey when no schedule is asked for', async () => {
    // Recording one before its steps are known is how the API is meant to be
    // used — it is only booking a cadence on it that is a certain failure.
    const response = await POST(
      fromBrowser({ name: 'Checkout', targetUrl: 'https://acme.test/' }),
      params('acme'),
    );

    expect(response.status).toBe(201);
    expect(await platform.listJourneys('acme')).toHaveLength(1);
  });
});
