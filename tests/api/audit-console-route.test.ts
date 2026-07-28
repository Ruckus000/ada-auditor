import { afterEach, describe, expect, it } from 'vitest';
import { isSameOriginConsoleRequest, POST } from '../../src/app/api/audit/console/route';

describe('audit console route', () => {
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
        html: '<main></main>',
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
        html: '<main></main>',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('console_same_origin_required');
  });
});
