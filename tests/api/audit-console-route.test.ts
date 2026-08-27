import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditReport } from '../helpers/audit-report';

const { runBrowserAudit } = vi.hoisted(() => ({ runBrowserAudit: vi.fn() }));
vi.mock('../../src/integrations/browser/run-browser-audit', () => ({ runBrowserAudit }));

const { POST } = await import('../../src/app/api/audit/console/route');
const { isSameOriginConsoleRequest } = await import('../../src/app/api/_lib/same-origin');
const { CONSOLE_COOKIE, createSessionValue, createOperatorSessionValue } = await import(
  '../../src/app/api/_lib/console-session'
);
const {
  MemoryPlatformStore,
  MemoryRunStore,
  resetPlatformStore,
  resetRunStore,
  setPlatformStore,
  setRunStore,
} = await import('../../src/integrations/persistence');
const { resetRunCounter } = await import('../../src/app/api/_lib/run-counter');

const TOKEN = 'test-console-token-long-enough';

function runRequest(headers: Record<string, string>) {
  return new Request('http://localhost:3000/api/audit/console', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      journeyId: 'demo-login',
      environment: 'staging',
    }),
  });
}

describe('audit console route', () => {
  beforeEach(() => {
    runBrowserAudit.mockReset();
    runBrowserAudit.mockResolvedValue(auditReport());
    setRunStore(new MemoryRunStore());
    // No platform-store double here on purpose. `resolvePrincipal` takes the
    // store as a factory and calls it only for a v2 cookie, so every test below
    // that uses a v1 cookie or none runs with no database at all — which is the
    // property, asserted directly in `principal.test.ts`. The two v2 tests set
    // their own store.
  });

  afterEach(() => {
    // The run budget counter is a module singleton; without this it
    // accumulates across tests in this file and eventually refuses one.
    resetRunCounter();
    delete process.env.AUDITOR_RUN_TOKEN;
    resetRunStore();
    resetPlatformStore();
  });

  // The route reaches `startRun` in-process now instead of rebuilding the
  // request with the server's own token forged into an Authorization header.
  // A body that never reaches the schema is the route's own 400, not one
  // borrowed from an HTTP handler it no longer calls.
  it('rejects a malformed body itself, without launching a browser', async () => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;

    const response = await POST(
      new Request('http://localhost:3000/api/audit/console', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'sec-fetch-site': 'same-origin',
          cookie: `${CONSOLE_COOKIE}=${createSessionValue(TOKEN)}`,
        },
        body: JSON.stringify({ journeyId: '', environment: 'staging' }),
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_request_body');
    expect(runBrowserAudit).not.toHaveBeenCalled();
  });

  it('accepts same-origin sec-fetch-site', () => {
    const request = new Request('http://localhost:3000/api/audit/console', {
      headers: { 'sec-fetch-site': 'same-origin' },
    });
    expect(isSameOriginConsoleRequest(request)).toBe(true);
  });

  it('accepts matching Origin', () => {
    const request = new Request('http://localhost:3000/api/audit/console', {
      headers: { origin: 'http://localhost:3000' },
    });
    expect(isSameOriginConsoleRequest(request)).toBe(true);
  });

  it('rejects cross-origin callers', () => {
    const request = new Request('http://localhost:3000/api/audit/console', {
      headers: {
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      },
    });
    expect(isSameOriginConsoleRequest(request)).toBe(false);
  });

  it('returns 503 when token is not configured', async () => {
    delete process.env.AUDITOR_RUN_TOKEN;
    const request = new Request('http://localhost:3000/api/audit/console', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({
        journeyId: 'demo-login',
        environment: 'staging',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe('auditor_run_token_not_configured');
  });

  // The status changed from 403 to 401 when this route adopted
  // `authorizePrincipal`, and the property under test did not: a cross-site
  // caller is refused. The shared function answers `Principal | null` and
  // cannot distinguish "blocked by CSRF" from "no valid session", which is the
  // same answer every other route in this codebase gives. Keeping the old 403
  // would have meant calling `isSameOriginConsoleRequest` again alongside it —
  // reinstating the duplicate rule this change removes, and breaking the bearer
  // path, since a token-holding CI caller is never same-origin.
  it('refuses cross-site requests even when the token is set', async () => {
    process.env.AUDITOR_RUN_TOKEN = 'console-secret';
    const request = new Request('http://localhost:3000/api/audit/console', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      },
      body: JSON.stringify({
        journeyId: 'demo-login',
        environment: 'staging',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('console_session_required');
  });

  it('rejects a forged same-origin header with no operator session', async () => {
    // The header is trivially forged outside a browser, so on its own it must
    // not be enough to spend the server's token.
    process.env.AUDITOR_RUN_TOKEN = TOKEN;

    const response = await POST(runRequest({ 'sec-fetch-site': 'same-origin' }));
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('console_session_required');
  });

  it('rejects a session cookie signed with a different token', async () => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;

    const response = await POST(
      runRequest({
        'sec-fetch-site': 'same-origin',
        cookie: `${CONSOLE_COOKIE}=${createSessionValue('some-other-token-entirely')}`,
      }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('console_session_required');
  });

  it('runs the audit when a valid session cookie is present', async () => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;

    const response = await POST(
      runRequest({
        'sec-fetch-site': 'same-origin',
        cookie: `${CONSOLE_COOKIE}=${createSessionValue(TOKEN)}`,
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).ciStatus).toBeDefined();
  });

  // The CSRF case, and the one that matters most: another site riding a real
  // operator's cookie. A cookie travels on cross-site posts, so the session
  // being valid is exactly why the origin still has to be checked.
  it('still requires same-origin even with a valid session', async () => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;

    const response = await POST(
      runRequest({
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
        cookie: `${CONSOLE_COOKIE}=${createSessionValue(TOKEN)}`,
      }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('console_session_required');
    expect(runBrowserAudit).not.toHaveBeenCalled();
  });

  /**
   * The case that was broken, and the reason this route moved onto the shared
   * function.
   *
   * A person who signs in with an email and a password gets the v2 cookie.
   * This route validated only v1, where the first dot-separated field is an
   * expiry — so `Number('v2')` was NaN and every operator account was refused
   * by the one console that exists to be used by people.
   */
  it('accepts a v2 operator session, not just the machine token cookie', async () => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;

    const platform = new MemoryPlatformStore();
    await platform.upsertOperator({
      id: 'op-alex',
      email: 'alex@example.com',
      name: 'Alex Reed',
      passwordHash: 'scrypt$16384$8$1$c2FsdA==$aGFzaA==',
    });
    setPlatformStore(platform);
    const operator = (await platform.getOperator('op-alex'))!;

    const response = await POST(
      runRequest({
        'sec-fetch-site': 'same-origin',
        cookie: `${CONSOLE_COOKIE}=${createOperatorSessionValue(TOKEN, operator)}`,
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).ciStatus).toBeDefined();
  });

  /**
   * Revocation has to reach this route too — a route holding its own copy of
   * the session check would not have known.
   *
   * The cookie is minted first and the stored epoch bumped after, which is the
   * direction a real revocation runs: the cookie keeps the epoch it was signed
   * with and the database moves past it. Minting a *higher* epoch than the
   * stored one would also go red today, because the check is `!==` — and would
   * keep passing if that check were ever narrowed to "reject only cookies from
   * the future", while every genuinely revoked operator stayed signed in.
   */
  it('refuses a v2 cookie after the operator is revoked', async () => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;

    const platform = new MemoryPlatformStore();
    await platform.upsertOperator({
      id: 'op-alex',
      email: 'alex@example.com',
      name: 'Alex Reed',
      passwordHash: 'scrypt$16384$8$1$c2FsdA==$aGFzaA==',
    });
    setPlatformStore(platform);

    const operator = (await platform.getOperator('op-alex'))!;
    const cookie = createOperatorSessionValue(TOKEN, operator);
    await platform.bumpSessionEpoch('op-alex');

    const response = await POST(
      runRequest({ 'sec-fetch-site': 'same-origin', cookie: `${CONSOLE_COOKIE}=${cookie}` }),
    );

    expect(response.status).toBe(401);
    expect(runBrowserAudit).not.toHaveBeenCalled();
  });
});
