import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('rejects a stepId that could escape the artifacts directory', async () => {
    // stepId is concatenated onto the artifacts path, so anything other than a
    // bare filename segment is an arbitrary file write.
    const traversals = [
      '../../pwned',
      '../pwned',
      '/tmp/pwned',
      'nested/../../pwned',
      'a/b',
      '..',
      '.',
    ];

    for (const stepId of traversals) {
      const request = new Request('http://localhost/api/audit/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          journeyId: 'demo-login',
          environment: 'staging',
          browserMode: true,
          stepId,
        }),
      });

      const result = await handleAuditRun(request, `req-stepid-${traversals.indexOf(stepId)}`);

      expect(result.ok, `stepId ${JSON.stringify(stepId)} should be rejected`).toBe(false);
      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_request_body');
    }
  });

  it('returns a stable code, not the exception text, when a run throws', async () => {
    // The message carries a filesystem path. Echoing error.message straight to
    // the caller, as the handler used to, leaks it.
    vi.resetModules();
    vi.doMock('../../src/services/run-audit', () => ({
      runAudit: async () => {
        throw new Error('ENOENT: no such file or directory, open /Users/someone/.secrets/db.json');
      },
    }));

    const { handleAuditRun: handler } = await import('../../src/app/api/_lib/audit-run-handler');

    const request = new Request('http://localhost/api/audit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        journeyId: 'demo-login',
        environment: 'staging',
        html: '<main></main>',
      }),
    });

    const result = await handler(request, 'req-failure-code');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.body.error).toBe('audit_run_failed');
    expect(JSON.stringify(result.body)).not.toContain('.secrets');
    expect(JSON.stringify(result.body)).not.toContain('ENOENT');

    vi.doUnmock('../../src/services/run-audit');
    vi.resetModules();
  });

  it('ignores a caller-supplied fixtureDir rather than passing it to the browser', async () => {
    // fixtureDir feeds page.goto(file://...), so accepting it over HTTP would
    // make an audit run a local file read. Zod strips the unknown key and the
    // run proceeds against the built-in fixtures.
    const request = new Request('http://localhost/api/audit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        journeyId: 'demo-login',
        environment: 'staging',
        html: '<main><img src="hero.png" alt="Hero"></main>',
        fixtureDir: '/etc',
      }),
    });

    const result = await handleAuditRun(request, 'req-fixturedir');

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it('rejects an over-long stepId', async () => {
    const request = new Request('http://localhost/api/audit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        journeyId: 'demo-login',
        environment: 'staging',
        browserMode: true,
        stepId: 'a'.repeat(65),
      }),
    });

    const result = await handleAuditRun(request, 'req-stepid-long');

    expect(result.ok).toBe(false);
    expect(result.body.error).toBe('invalid_request_body');
  });
});
