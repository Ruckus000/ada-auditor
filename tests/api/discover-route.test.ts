import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The routes resolve a principal now rather than asking "is there a
// session?". Mocking that seam keeps these tests about the routes; the
// cookie/token machinery has its own suite in tests/api/principal.test.ts.
//
// This is the level every other suite in `tests/api/` mocks at, and the choice
// matters more here than anywhere else: mocking `authorizePrincipal` instead
// would take the same-origin/CSRF check and the bearer comparison out from
// under test, and those are the two things a browser-launching endpoint most
// needs held.
const { principalFromRequest } = vi.hoisted(() => ({ principalFromRequest: vi.fn() }));
vi.mock('../../src/app/api/_lib/principal', () => ({ principalFromRequest }));

const { discoverLinks } = vi.hoisted(() => ({ discoverLinks: vi.fn() }));

// Spread, not replaced. The route does `error instanceof EntryPointRedirectedError`;
// a wholesale replacement makes that identifier `undefined` at runtime, and
// `x instanceof undefined` throws `TypeError` — which would fail *every* test
// that reaches the catch block, including the ones about private addresses
// that have nothing to do with redirects.
vi.mock('../../src/integrations/browser/discover-links', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/integrations/browser/discover-links')>()),
  discoverLinks,
}));

// `importOriginal` loads the real module, which statically imports
// `playwright-core` through `./launch`. Nothing launches a browser, but the
// fast suite's boundary erodes one heavy import at a time.
vi.mock('../../src/integrations/browser/launch', () => ({ launchChromium: vi.fn() }));

const OPERATOR = { kind: 'operator' as const, id: 'op-1', name: 'Alex Reed', email: 'alex@example.com' };

const { POST } = await import('../../src/app/api/platform/discover/route');
const { EntryPointRedirectedError, EntryPointUnreachableError } = await import(
  '../../src/integrations/browser/discover-links'
);
const { UnsafeTargetError } = await import('../../src/integrations/browser/target-url');

const TOKEN = 'test-token-16chars';

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/platform/discover', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Same-origin plus a session: how the screens call it. */
function fromBrowser(body: unknown): Request {
  principalFromRequest.mockResolvedValue(OPERATOR);
  return request(body, { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' });
}

/** Bearer token: how CI and scripts call it. */
function fromScript(body: unknown): Request {
  return request(body, { authorization: `Bearer ${TOKEN}` });
}

const CRAWL = {
  pages: [{ url: 'https://acme.test/', title: 'Home', depth: 0 }],
  errors: [],
};

describe('/api/platform/discover', () => {
  const originalToken = process.env.AUDITOR_RUN_TOKEN;

  beforeEach(() => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;
    principalFromRequest.mockReset();
    principalFromRequest.mockResolvedValue(null);
    discoverLinks.mockReset();
    discoverLinks.mockResolvedValue(CRAWL);
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.AUDITOR_RUN_TOKEN;
    else process.env.AUDITOR_RUN_TOKEN = originalToken;
    vi.restoreAllMocks();
  });

  it('refuses an unauthenticated request', async () => {
    const response = await POST(request({ targetUrl: 'https://acme.test/' }));

    expect(response.status).toBe(401);
    expect(discoverLinks).not.toHaveBeenCalled();
  });

  it('refuses a cookie carried cross-origin', async () => {
    // A crawl is a browser launch against a host of the caller's choosing. A
    // cross-site page must not be able to start one with a session cookie it
    // did not earn.
    principalFromRequest.mockResolvedValue(OPERATOR);
    const response = await POST(
      request(
        { targetUrl: 'https://acme.test/' },
        { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      ),
    );

    expect(response.status).toBe(401);
    expect(discoverLinks).not.toHaveBeenCalled();
  });

  it.each([
    ['a target that is not a URL', { targetUrl: 'not a url' }],
    ['a target on a scheme a browser must not follow', { targetUrl: 'file:///etc/passwd' }],
    ['a body naming no target at all', {}],
    // `.strict()` earns its place here: a caller raising the cap is a caller
    // deciding how long someone else's server gets crawled for.
    ['a smuggled cap', { targetUrl: 'https://acme.test/', maxUrls: 10_000 }],
  ])('refuses %s', async (_name, body) => {
    const response = await POST(fromBrowser(body));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_request_body' });
    expect(discoverLinks).not.toHaveBeenCalled();
  });

  it('crawls the parsed target rather than the raw one', async () => {
    // zod trims inside the piped `z.url()`, and that trimming buys nothing if
    // the route reads the request body again instead of the parsed value.
    await POST(fromScript({ targetUrl: '  https://acme.test/  ' }));

    expect(discoverLinks).toHaveBeenCalledWith(
      expect.objectContaining({ targetUrl: 'https://acme.test/' }),
    );
  });

  it('answers a crawl with the request id first', async () => {
    const response = await POST(fromBrowser({ targetUrl: 'https://acme.test/' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    // Every response in this API leads with `requestId`; a caller quoting one
    // back at support should not have to know which route it came from.
    expect(Object.keys(body)[0]).toBe('requestId');
    expect(body.pages).toEqual(CRAWL.pages);
    expect(body.errors).toEqual([]);
  });

  it('passes truncation and omitted-error counts through', async () => {
    // A route that dropped these would undo at the last hop the one thing
    // `DiscoveryTruncation` exists to prevent: a partial crawl presented as a
    // whole site.
    discoverLinks.mockResolvedValue({
      ...CRAWL,
      truncated: { reason: 'budget', seen: 41 },
      errorsOmitted: 7,
    });

    const body = await (await POST(fromBrowser({ targetUrl: 'https://acme.test/' }))).json();

    expect(body.truncated).toEqual({ reason: 'budget', seen: 41 });
    expect(body.errorsOmitted).toBe(7);
  });

  it('names the host an entry point redirected to, and nothing else', async () => {
    discoverLinks.mockRejectedValue(new EntryPointRedirectedError('www.acme.test'));

    const response = await POST(fromBrowser({ targetUrl: 'https://acme.test/' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('entry_point_redirected');
    expect(body.host).toBe('www.acme.test');
    // No fourth key. The message is the crawler's prose and stays off the
    // wire; `host` is the structured half the screen retries with.
    expect(Object.keys(body).sort()).toEqual(['error', 'host', 'requestId']);
  });

  it('does not report a redirected entry point as a refused navigation', async () => {
    // `EntryPointRedirectedError extends UnsafeTargetError`, so a catch block
    // that checks the generic type first swallows this branch entirely and
    // tells the operator that a perfectly valid address is not allowed. This
    // is the only thing standing between that and a tidying pass that reorders
    // the branches while every type check still passes.
    discoverLinks.mockRejectedValue(new EntryPointRedirectedError('www.acme.test'));

    const body = await (await POST(fromBrowser({ targetUrl: 'https://acme.test/' }))).json();

    expect(body.error).not.toBe('navigation_not_allowed');
  });

  it('answers 502 when the entry point could not be read', async () => {
    // Their server, not our request: a dead host or a typo'd domain is not a
    // 4xx about the body we were handed, and not a 500 about us.
    discoverLinks.mockRejectedValue(
      new EntryPointUnreachableError(new Error('page.goto: net::ERR_NAME_NOT_RESOLVED')),
    );

    const response = await POST(fromBrowser({ targetUrl: 'https://nope.test/' }));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'entry_point_unreachable' });
  });

  it('refuses a target the guard rejects without repeating the address', async () => {
    discoverLinks.mockRejectedValue(
      new UnsafeTargetError('Target URL http://10.0.0.1/ resolves to a private or reserved address'),
    );

    const response = await POST(fromBrowser({ targetUrl: 'http://10.0.0.1/' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('navigation_not_allowed');
    // The refusal message is written for developers and names the address it
    // refused. `run-failure.ts` exists so a code crosses the wire instead.
    expect(JSON.stringify(body)).not.toContain('10.0.0.1');
  });

  it('keeps a call-log secret out of both the response and the log line', async () => {
    // Playwright appends its call log to a navigation failure, and a call log
    // names the URL it was dialling — which on a crawl is a URL harvested from
    // someone else's markup, query string and all.
    const error = new Error(
      'page.goto: net::ERR_ABORTED\n' +
        'Call log:\n' +
        '  - navigating to "https://acme.test/reset?token=hunter2seekrit"',
    );
    discoverLinks.mockRejectedValue(error);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await POST(fromBrowser({ targetUrl: 'https://acme.test/?token=hunter2seekrit' }));
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toMatchObject({ error: 'discovery_failed' });
    expect(text).not.toContain('hunter2seekrit');

    // The log line is not exempt: `services/logger.ts` redacts by field *name*,
    // so a secret inside a value under `reason` or `target` travels whole.
    // `target` is the origin for exactly this reason.
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join('\n')).not.toContain('hunter2seekrit');
  });
});
