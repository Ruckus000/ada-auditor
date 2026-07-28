import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { handleAuditRun } from '../../src/app/api/_lib/audit-run-handler';

describe('handleAuditRun', () => {
  afterEach(() => {
    delete process.env.CHAOS_ENABLED;
  });

  it('runs audit and returns structured response', async () => {
    const request = new Request('http://localhost/api/audit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        journeyId: 'demo-login',
        environment: 'staging',
        html: '<main><img src="hero.png" alt="Hero"></main>',
      }),
    });

    const result = await handleAuditRun(request, 'req-test-1');

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body.ciStatus).toBe('pass');
    expect(result.body.requestId).toBe('req-test-1');
    expect(result.body.durationMs).toBeTypeOf('number');
  });

  it('returns inconclusive for omit_ax_tree chaos scenario when enabled', async () => {
    process.env.CHAOS_ENABLED = 'true';

    const request = new Request('http://localhost/api/audit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        journeyId: 'demo-login',
        environment: 'staging',
        html: '<main></main>',
        chaosScenario: 'omit_ax_tree',
      }),
    });

    const result = await handleAuditRun(request, 'req-chaos-1');

    expect(result.ok).toBe(true);
    expect(result.body.ciStatus).toBe('inconclusive');
    expect(result.body.evidenceStatus).toBe('degraded');
  });

  it('rejects chaos scenario when CHAOS_ENABLED is false', async () => {
    const request = new Request('http://localhost/api/audit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        journeyId: 'demo-login',
        environment: 'staging',
        html: '<main></main>',
        chaosScenario: 'omit_ax_tree',
      }),
    });

    const result = await handleAuditRun(request, 'req-chaos-2');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.body.error).toBe('chaos_not_enabled');
  });

  it('runs browser journey when browserMode is true', async () => {
    const requestId = 'req-browser-1';

    const request = new Request('http://localhost/api/audit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        journeyId: 'demo-login',
        environment: 'staging',
        browserMode: true,
      }),
    });

    const result = await handleAuditRun(request, requestId);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body.browserMode).toBe(true);
    expect(result.body.evidenceStatus).toBe('complete');
    expect(result.body.ciStatus).toBe('fail');
    expect(result.body.requestId).toBe(requestId);

    await rm(join(process.cwd(), 'artifacts', requestId), {
      recursive: true,
      force: true,
    });
  }, 60_000);

  it('returns inconclusive for browserMode with omitAxTree', async () => {
    const requestId = 'req-browser-2';

    const request = new Request('http://localhost/api/audit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        journeyId: 'demo-login',
        environment: 'staging',
        browserMode: true,
        omitAxTree: true,
      }),
    });

    const result = await handleAuditRun(request, requestId);

    expect(result.ok).toBe(true);
    expect(result.body.ciStatus).toBe('inconclusive');
    expect(result.body.evidenceStatus).toBe('degraded');

    await rm(join(process.cwd(), 'artifacts', requestId), {
      recursive: true,
      force: true,
    });
  }, 60_000);

  it('rejects browserMode combined with chaosScenario', async () => {
    process.env.CHAOS_ENABLED = 'true';

    const request = new Request('http://localhost/api/audit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        journeyId: 'demo-login',
        environment: 'staging',
        browserMode: true,
        chaosScenario: 'omit_ax_tree',
      }),
    });

    const result = await handleAuditRun(request, 'req-browser-3');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_request_body');
  });
});
