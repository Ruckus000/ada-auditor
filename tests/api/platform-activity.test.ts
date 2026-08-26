import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same seam as the other platform-route suites: mocking the principal keeps
// these tests about the route, and the cookie/token machinery has its own
// suite in tests/api/principal.test.ts.
const { principalFromRequest } = vi.hoisted(() => ({ principalFromRequest: vi.fn() }));
vi.mock('../../src/app/api/_lib/principal', () => ({ principalFromRequest }));

import { EVENT_LIST_DEFAULT, SCHEDULED_RUN_NOT_STARTED } from '../../src/domain/platform';

const OPERATOR = {
  kind: 'operator' as const,
  id: 'op-1',
  name: 'Alex Reed',
  email: 'alex@example.com',
};

const { GET } = await import('../../src/app/api/platform/activity/route');
const {
  MemoryPlatformStore,
  resetPlatformStore,
  setPlatformStore,
} = await import('../../src/integrations/persistence');

const TOKEN = 'test-token-16chars';

function request(query = '', headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/platform/activity${query}`, { headers });
}

/** Same-origin plus a session: how the screens call it. */
function fromBrowser(query = ''): Request {
  principalFromRequest.mockResolvedValue(OPERATOR);
  return request(query, { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' });
}

/** Bearer token: how CI, scripts and the failed-runs workflow call it. */
function fromScript(query = ''): Request {
  return request(query, { authorization: `Bearer ${TOKEN}` });
}

let platform: InstanceType<typeof MemoryPlatformStore>;

describe('GET /api/platform/activity', () => {
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

  async function seedNotStarted(journeyId: string, code: string) {
    await platform.recordEvent({
      clientId: 'acme',
      actor: 'Scheduler',
      action: SCHEDULED_RUN_NOT_STARTED,
      subject: journeyId,
      metadata: { journeyId, code },
    });
  }

  it('refuses an unauthenticated request', async () => {
    expect((await GET(request())).status).toBe(401);
  });

  it('refuses a cookie carried cross-origin, and reads nothing', async () => {
    // A session cookie travels on cross-site requests too. Refusing after
    // reading would still have leaked the log to whoever made the page.
    principalFromRequest.mockResolvedValue(OPERATOR);
    const listEvents = vi.spyOn(platform, 'listEvents');

    const response = await GET(
      request('', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }),
    );

    expect(response.status).toBe(401);
    expect(listEvents).not.toHaveBeenCalled();
  });

  // The workflow has no session, only the machine credential.
  it('accepts the machine token', async () => {
    expect((await GET(fromScript())).status).toBe(200);
  });

  it('accepts a session from the screens', async () => {
    expect((await GET(fromBrowser())).status).toBe(200);
  });

  it('answers the shape the other list routes answer', async () => {
    await seedNotStarted('checkout', 'run_budget_exceeded');

    const body = await (await GET(fromScript())).json();

    expect(Object.keys(body).sort()).toEqual(['count', 'events', 'requestId']);
    expect(body.count).toBe(body.events.length);
  });

  it('returns events newest first, with their metadata', async () => {
    await seedNotStarted('checkout', 'run_budget_exceeded');
    await seedNotStarted('signup', 'dispatch_error');

    const body = await (await GET(fromScript())).json();

    expect(body.events.map((event: { subject: string }) => event.subject)).toEqual([
      'signup',
      'checkout',
    ]);
    expect(body.events[0].metadata).toEqual({ journeyId: 'signup', code: 'dispatch_error' });
  });

  /**
   * The query the failed-runs workflow makes: one pinned action, one window.
   *
   * Filtered server-side because the workflow counts what comes back and never
   * parses free text. A `jq` filter over a page of events would make the alert
   * depend on how busy the log happened to be that day.
   */
  it('narrows to one action inside one window', async () => {
    await seedNotStarted('checkout', 'run_budget_exceeded');
    await platform.recordEvent({
      clientId: 'acme',
      actor: 'Alex Reed',
      action: 'added a client',
      subject: 'Acme',
    });

    const since = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
    const query = `?action=${encodeURIComponent(SCHEDULED_RUN_NOT_STARTED)}&since=${since}`;
    const body = await (await GET(fromScript(query))).json();

    expect(body.count).toBe(1);
    expect(body.events[0].action).toBe(SCHEDULED_RUN_NOT_STARTED);
  });

  // `clientId` is a filter, never a scope: there is one organisation and every
  // operator sees every client. Narrowing is a convenience, not isolation.
  it('filters by client without pretending to scope', async () => {
    await platform.upsertClient({ id: 'other', name: 'Other' });
    await seedNotStarted('checkout', 'run_budget_exceeded');
    await platform.recordEvent({ clientId: 'other', actor: 'Scheduler', action: 'something else' });

    const body = await (await GET(fromScript('?clientId=other'))).json();

    expect(body.count).toBe(1);
    expect(body.events[0].clientId).toBe('other');
  });

  // The exact string `date -u ... +%Y-%m-%dT%H:%M:%SZ` produces in
  // `.github/workflows/failed-runs.yml`. If the boundary stops accepting it,
  // the workflow gets a 400 every night and reports nothing.
  it('accepts the timestamp the workflow generates', async () => {
    const response = await GET(fromScript('?since=2026-08-25T11:51:28Z'));

    expect(response.status).toBe(200);
  });

  it('refuses a window it cannot pin down', async () => {
    // "yesterday" is a word, not an instant. Accepting it would silently
    // become "since the beginning of the log".
    expect((await GET(fromScript('?since=yesterday'))).status).toBe(400);
  });

  it('refuses a limit that is not a limit', async () => {
    expect((await GET(fromScript('?limit=0'))).status).toBe(400);
    expect((await GET(fromScript('?limit=500'))).status).toBe(400);
    expect((await GET(fromScript('?limit=abc'))).status).toBe(400);
  });

  it('honours a limit inside the range', async () => {
    await seedNotStarted('checkout', 'run_budget_exceeded');
    await seedNotStarted('signup', 'dispatch_error');

    const body = await (await GET(fromScript('?limit=1'))).json();

    expect(body.count).toBe(1);
  });

  // No limit means the store's own default, not "everything".
  it('clamps by default rather than returning the whole log', async () => {
    for (let index = 0; index < EVENT_LIST_DEFAULT + 5; index += 1) {
      await seedNotStarted(`journey-${index}`, 'dispatch_error');
    }

    const body = await (await GET(fromScript())).json();

    expect(body.count).toBe(EVENT_LIST_DEFAULT);
  });
});
