import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditReport } from '../helpers/audit-report';

const { runBrowserAudit } = vi.hoisted(() => ({ runBrowserAudit: vi.fn() }));
vi.mock('../../src/integrations/browser/run-browser-audit', () => ({ runBrowserAudit }));

const { POST } = await import('../../src/app/api/audit/console/route');
const { isSameOriginConsoleRequest } = await import('../../src/app/api/_lib/same-origin');
const { CONSOLE_COOKIE, createSessionValue } = await import(
  '../../src/app/api/_lib/console-session'
);

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
  });

  afterEach(() => {
    delete process.env.AUDITOR_RUN_TOKEN;
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

  it('returns 403 for cross-site requests even when token is set', async () => {
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
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('console_same_origin_required');
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

  it('still requires same-origin even with a valid session', async () => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;

    const response = await POST(
      runRequest({
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
        cookie: `${CONSOLE_COOKIE}=${createSessionValue(TOKEN)}`,
      }),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('console_same_origin_required');
  });
});
