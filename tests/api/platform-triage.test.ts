import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The routes resolve a principal now rather than asking "is there a
// session?". Mocking that seam keeps these tests about the routes; the
// cookie/token machinery has its own suite in tests/api/principal.test.ts.
const { principalFromRequest } = vi.hoisted(() => ({ principalFromRequest: vi.fn() }));
vi.mock('../../src/app/api/_lib/principal', () => ({ principalFromRequest }));

const OPERATOR = { kind: 'operator' as const, id: 'op-1', name: 'Alex Reed', email: 'alex@example.com' };

const { DELETE, POST } = await import(
  '../../src/app/api/platform/clients/[clientId]/triage/route'
);
const { MemoryPlatformStore, resetPlatformStore, setPlatformStore } = await import(
  '../../src/integrations/persistence'
);
const { MAX_TRIAGE_NOTE } = await import('../../src/domain/platform');

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
  principalFromRequest.mockResolvedValue(OPERATOR);
  return request(body, method, { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' });
}

let platform: InstanceType<typeof MemoryPlatformStore>;

describe('/api/platform/clients/[clientId]/triage', () => {
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
    const body = { findingKey: KEY, state: 'dismissed', note: 'why' };
    expect((await POST(request(body), params('acme'))).status).toBe(401);
    expect((await DELETE(request({ findingKey: KEY }, 'DELETE'), params('acme'))).status).toBe(401);
  });

  it('refuses a cookie carried cross-origin', async () => {
    // Dismissing a finding is how a barrier stops being reported. A cross-site
    // page must not be able to do it with a session cookie it did not earn.
    principalFromRequest.mockResolvedValue(OPERATOR);
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

  it('records an accepted risk as its own decision', async () => {
    // Not a dismissal. `accepted-risk` has been in the type, the enum and the
    // CHECK since Phase 2C with nothing able to write it, which is why every
    // consumer branched two ways over three states.
    const response = await POST(
      fromBrowser({
        findingKey: KEY,
        state: 'accepted-risk',
        note: 'Signed off by the client on 2026-08-20.',
      }),
      params('acme'),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: 'accepted-risk' });
    expect((await platform.listTriage('acme'))[0]).toMatchObject({
      state: 'accepted-risk',
      note: 'Signed off by the client on 2026-08-20.',
    });
  });

  it('will not accept a note-free accepted risk', async () => {
    // Proving the existing refine covers this state rather than assuming it:
    // an acceptance with nobody named and no basis given is the record an
    // auditor would have to defend, and there would be nothing in it.
    const response = await POST(
      fromBrowser({ findingKey: KEY, state: 'accepted-risk' }),
      params('acme'),
    );

    expect(response.status).toBe(400);
    expect(await platform.listTriage('acme')).toEqual([]);
  });

  it('logs an accepted risk as an acceptance, not as a dismissal', async () => {
    // The activity feed is append-only, so this wording is the permanent
    // record. "dismissed a finding" against an accepted barrier says the
    // opposite of what happened.
    await POST(
      fromBrowser({ findingKey: KEY, state: 'accepted-risk', note: 'Client accepts.' }),
      params('acme'),
    );

    const [event] = await platform.listEvents({ clientId: 'acme' });
    expect(event).toMatchObject({
      action: 'accepted the risk on a finding',
      subject: 'image-alt',
      metadata: { state: 'accepted-risk' },
    });
  });

  it('refuses a note longer than the cap the screen enforces', async () => {
    // One constant behind both, so a textarea cannot let an operator type
    // something the route will throw away without saying which field was
    // wrong — `invalid_request_body` names no field.
    const response = await POST(
      fromBrowser({ findingKey: KEY, state: 'dismissed', note: 'x'.repeat(MAX_TRIAGE_NOTE + 1) }),
      params('acme'),
    );

    expect(response.status).toBe(400);
    expect(await platform.listTriage('acme')).toEqual([]);
  });

  it('accepts a note exactly at the cap', async () => {
    const response = await POST(
      fromBrowser({ findingKey: KEY, state: 'dismissed', note: 'x'.repeat(MAX_TRIAGE_NOTE) }),
      params('acme'),
    );

    expect(response.status).toBe(200);
  });

  it('refuses an assignee who is not an account', async () => {
    // A dangling assignee reads as handled by somebody who does not exist, and
    // Postgres would reject the foreign key while the double accepted it.
    const response = await POST(
      fromBrowser({
        findingKey: KEY,
        state: 'assigned',
        assignee: 'Nobody At All',
        assigneeOperatorId: 'op-missing',
      }),
      params('acme'),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: 'unknown_assignee' });
    expect(await platform.listTriage('acme')).toEqual([]);
  });

  it('refuses an assignee whose account is disabled', async () => {
    // Disabled means out now, not "cannot sign in again". Assigning work to a
    // disabled account is a finding nobody owns.
    await platform.upsertOperator({
      id: 'op-2',
      email: 'gone@example.com',
      name: 'Gone Away',
      passwordHash: 'x',
      disabledAt: '2026-08-01T00:00:00.000Z',
    });

    const response = await POST(
      fromBrowser({
        findingKey: KEY,
        state: 'assigned',
        assignee: 'Gone Away',
        assigneeOperatorId: 'op-2',
      }),
      params('acme'),
    );

    expect(response.status).toBe(422);
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

  // The name is what the activity feed reads back; the id is what makes it an
  // account rather than a string. Both, because they are different facts —
  // this used to be a configured environment variable and could name only one
  // person however many were working.
  it('records who decided, by name and by account', async () => {
    await POST(fromBrowser({ findingKey: KEY, state: 'dismissed', note: 'why' }), params('acme'));

    const [event] = await platform.listEvents({ clientId: 'acme' });
    expect(event).toMatchObject({
      actor: 'Alex Reed',
      actorOperatorId: 'op-1',
      action: 'dismissed a finding',
      subject: 'image-alt',
    });
  });

  // Automation is a legitimate caller with no account. The event still has to
  // say who, or a scheduled dismissal reads as though nobody did it.
  it('records a machine caller by name, with no account id', async () => {
    // Built first: `fromBrowser` sets the principal itself, so overriding it
    // has to come after.
    const call = fromBrowser({ findingKey: KEY, state: 'dismissed', note: 'why' });
    principalFromRequest.mockResolvedValue({ kind: 'machine', name: 'Operator' });

    await POST(call, params('acme'));

    const [event] = await platform.listEvents({ clientId: 'acme' });
    expect(event?.actor).toBe('Operator');
    expect(event).not.toHaveProperty('actorOperatorId');
  });

  it("does not let one client's decision apply to another's finding", async () => {
    await platform.upsertClient({ id: 'other', name: 'Other' });
    await POST(fromBrowser({ findingKey: KEY, state: 'dismissed', note: 'why' }), params('acme'));

    expect(await platform.listTriage('other')).toEqual([]);
  });
});
