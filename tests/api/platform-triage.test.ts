import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { hasOperatorSession } = vi.hoisted(() => ({ hasOperatorSession: vi.fn() }));
vi.mock('../../src/app/api/_lib/operator-session', () => ({ hasOperatorSession }));

const { DELETE, POST } = await import(
  '../../src/app/api/platform/clients/[clientId]/triage/route'
);
const { MemoryPlatformStore, resetPlatformStore, setPlatformStore } = await import(
  '../../src/integrations/persistence'
);

const TOKEN = 'test-token-16chars';
const KEY = 'deterministic:image-alt:https://acme.test/one:img';

function params(clientId: string) {
  return { params: Promise.resolve({ clientId }) };
}

function request(body: unknown, method = 'POST', headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/platform/clients/acme/triage', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Same-origin plus a session: how the screens call it. */
function fromBrowser(body: unknown, method = 'POST'): Request {
  hasOperatorSession.mockResolvedValue(true);
  return request(body, method, { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' });
}

let platform: InstanceType<typeof MemoryPlatformStore>;

describe('/api/platform/clients/[clientId]/triage', () => {
  const originalToken = process.env.AUDITOR_RUN_TOKEN;

  beforeEach(async () => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;
    hasOperatorSession.mockReset();
    hasOperatorSession.mockResolvedValue(false);
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
    const body = { findingKey: KEY, state: 'dismissed', note: 'why' };
    expect((await POST(request(body), params('acme'))).status).toBe(401);
    expect((await DELETE(request({ findingKey: KEY }, 'DELETE'), params('acme'))).status).toBe(401);
  });

  it('refuses a cookie carried cross-origin', async () => {
    // Dismissing a finding is how a barrier stops being reported. A cross-site
    // page must not be able to do it with a session cookie it did not earn.
    hasOperatorSession.mockResolvedValue(true);
    const response = await POST(
      request({ findingKey: KEY, state: 'dismissed', note: 'why' }, 'POST', {
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      }),
      params('acme'),
    );

    expect(response.status).toBe(401);
    expect(await platform.listTriage('acme')).toEqual([]);
  });

  it('refuses a client that does not exist', async () => {
    const body = { findingKey: KEY, state: 'dismissed', note: 'why' };
    expect((await POST(fromBrowser(body), params('nobody'))).status).toBe(404);
  });

  it('dismisses a finding with its reason', async () => {
    const response = await POST(
      fromBrowser({
        findingKey: KEY,
        state: 'dismissed',
        note: 'Decorative, hidden from the tree.',
        pageUrl: 'https://acme.test/one',
        selector: 'img',
      }),
      params('acme'),
    );

    expect(response.status).toBe(200);
    expect((await platform.listTriage('acme'))[0]).toMatchObject({
      findingKey: KEY,
      state: 'dismissed',
      note: 'Decorative, hidden from the tree.',
      source: 'deterministic',
      code: 'image-alt',
      pageUrl: 'https://acme.test/one',
      selector: 'img',
    });
  });

  it('stores a selector that contains a colon intact', async () => {
    // `a[href^="mailto:"]` is a perfectly ordinary selector, and a page URL has
    // colons of its own — so the key's tail cannot be split back apart. The
    // caller sends both fields; guessing them would file the decision against a
    // selector that matches nothing, and the dismissal would never apply.
    const key = 'deterministic:link-name:https://acme.test/one:a[href^="mailto:"]';
    await POST(
      fromBrowser({
        findingKey: key,
        state: 'dismissed',
        note: 'why',
        pageUrl: 'https://acme.test/one',
        selector: 'a[href^="mailto:"]',
      }),
      params('acme'),
    );

    expect((await platform.listTriage('acme'))[0]).toMatchObject({
      findingKey: key,
      source: 'deterministic',
      code: 'link-name',
      pageUrl: 'https://acme.test/one',
      selector: 'a[href^="mailto:"]',
    });
  });

  it('will not accept a note-free dismissal', async () => {
    // A dismissal without a reason is indistinguishable from a mistake, and
    // this is the record an auditor defends later.
    const response = await POST(
      fromBrowser({ findingKey: KEY, state: 'dismissed' }),
      params('acme'),
    );

    expect(response.status).toBe(400);
    expect(await platform.listTriage('acme')).toEqual([]);
  });

  it('will not accept an assignment with nobody assigned', async () => {
    expect(
      (await POST(fromBrowser({ findingKey: KEY, state: 'assigned' }), params('acme'))).status,
    ).toBe(400);
  });

  it('will not accept a "fixed" state', async () => {
    // A finding is fixed when the next run stops reporting it. Storing it as a
    // human decision lets the flag and the evidence disagree.
    const response = await POST(
      fromBrowser({ findingKey: KEY, state: 'fixed', note: 'we fixed it' }),
      params('acme'),
    );

    expect(response.status).toBe(400);
  });

  it('replaces an earlier decision rather than stacking one on it', async () => {
    await POST(fromBrowser({ findingKey: KEY, state: 'dismissed', note: 'first' }), params('acme'));
    await POST(
      fromBrowser({ findingKey: KEY, state: 'assigned', assignee: 'Alex Reed' }),
      params('acme'),
    );

    const entries = await platform.listTriage('acme');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ state: 'assigned', assignee: 'Alex Reed' });
  });

  it('reopens a finding without touching the finding itself', async () => {
    await POST(fromBrowser({ findingKey: KEY, state: 'dismissed', note: 'why' }), params('acme'));

    const response = await DELETE(fromBrowser({ findingKey: KEY }, 'DELETE'), params('acme'));

    expect(response.status).toBe(200);
    expect(await platform.listTriage('acme')).toEqual([]);
  });

  it('records who decided', async () => {
    process.env.AUDITOR_OPERATOR_NAME = 'Alex Reed';
    try {
      await POST(fromBrowser({ findingKey: KEY, state: 'dismissed', note: 'why' }), params('acme'));

      const [event] = await platform.listEvents({ clientId: 'acme' });
      expect(event).toMatchObject({
        actor: 'Alex Reed',
        action: 'dismissed a finding',
        subject: 'image-alt',
      });
    } finally {
      delete process.env.AUDITOR_OPERATOR_NAME;
    }
  });

  it("does not let one client's decision apply to another's finding", async () => {
    await platform.upsertClient({ id: 'other', name: 'Other' });
    await POST(fromBrowser({ findingKey: KEY, state: 'dismissed', note: 'why' }), params('acme'));

    expect(await platform.listTriage('other')).toEqual([]);
  });
});
