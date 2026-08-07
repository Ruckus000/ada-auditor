import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditReport, criticalFinding } from '../helpers/audit-report';

const { runBrowserAudit } = vi.hoisted(() => ({ runBrowserAudit: vi.fn() }));
vi.mock('../../src/integrations/browser/run-browser-audit', () => ({ runBrowserAudit }));

const { handleAuditRun } = await import('../../src/app/api/_lib/audit-run-handler');

function runRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/audit/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('handleAuditRun', () => {
  beforeEach(() => {
    runBrowserAudit.mockReset();
    runBrowserAudit.mockResolvedValue(auditReport());
  });

  afterEach(() => {
    delete process.env.CHAOS_ENABLED;
  });

  it('runs an audit and returns a structured response', async () => {
    const result = await handleAuditRun(
      runRequest({ journeyId: 'demo-login', environment: 'staging' }),
      'req-test-1',
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body.ciStatus).toBe('pass');
    expect(result.body.requestId).toBe('req-test-1');
    expect(result.body.durationMs).toBeTypeOf('number');
  });

  it('returns the locating fields on each finding', async () => {
    runBrowserAudit.mockResolvedValue(auditReport({ findings: [criticalFinding()] }));

    const result = await handleAuditRun(
      runRequest({ journeyId: 'demo-login', environment: 'staging' }),
      'req-test-2',
    );

    expect(result.body.ciStatus).toBe('fail');
    expect(result.body.findings).toMatchObject([
      { code: 'image-alt', selector: '#hero', wcagCriteria: ['1.1.1'], conformanceLevel: 'A' },
    ]);
  });

  it('runs the browser journey with the built-in fixtures', async () => {
    await handleAuditRun(
      runRequest({ journeyId: 'demo-login', environment: 'staging' }),
      'req-browser-1',
    );

    expect(runBrowserAudit).toHaveBeenCalledOnce();
    const call = runBrowserAudit.mock.calls[0][0];
    expect(call.journeyId).toBe('demo-login');
    expect(call.fixtureDir).toContain('fixtures/journey-app');
    expect(call.artifactsDir).toContain('req-browser-1');
  });

  it('ignores a caller-supplied fixtureDir rather than passing it to the browser', async () => {
    // fixtureDir feeds page.goto(file://...), so accepting it over HTTP would
    // make an audit run a local file read. Zod strips the unknown key.
    await handleAuditRun(
      runRequest({ journeyId: 'demo-login', environment: 'staging', fixtureDir: '/etc' }),
      'req-fixturedir',
    );

    expect(runBrowserAudit.mock.calls[0][0].fixtureDir).not.toBe('/etc');
    expect(runBrowserAudit.mock.calls[0][0].fixtureDir).toContain('fixtures/journey-app');
  });

  it('passes omitAxTree through so evidence degrades to inconclusive', async () => {
    runBrowserAudit.mockResolvedValue(
      auditReport({ evidenceStatus: 'degraded', findings: [criticalFinding()] }),
    );

    const result = await handleAuditRun(
      runRequest({ journeyId: 'demo-login', environment: 'staging', omitAxTree: true }),
      'req-browser-2',
    );

    expect(runBrowserAudit.mock.calls[0][0].omitAxTree).toBe(true);
    expect(result.body.ciStatus).toBe('inconclusive');
    expect(result.body.evidenceStatus).toBe('degraded');
  });

  it('resolves a chaos scenario into browser steps when enabled', async () => {
    process.env.CHAOS_ENABLED = 'true';
    runBrowserAudit.mockResolvedValue(auditReport({ evidenceStatus: 'degraded' }));

    const result = await handleAuditRun(
      runRequest({
        journeyId: 'demo-login',
        environment: 'staging',
        chaosScenario: 'browser_omit_ax_tree',
      }),
      'req-chaos-1',
    );

    expect(result.ok).toBe(true);
    expect(runBrowserAudit.mock.calls[0][0].omitAxTree).toBe(true);
    expect(runBrowserAudit.mock.calls[0][0].steps?.length).toBeGreaterThan(0);
    expect(result.body.ciStatus).toBe('inconclusive');
  });

  it('rejects a chaos scenario when CHAOS_ENABLED is false', async () => {
    const result = await handleAuditRun(
      runRequest({
        journeyId: 'demo-login',
        environment: 'staging',
        chaosScenario: 'browser_omit_ax_tree',
      }),
      'req-chaos-2',
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.body.error).toBe('chaos_not_enabled');
    expect(runBrowserAudit).not.toHaveBeenCalled();
  });

  it('rejects an unknown chaos scenario', async () => {
    process.env.CHAOS_ENABLED = 'true';

    const result = await handleAuditRun(
      runRequest({
        journeyId: 'demo-login',
        environment: 'staging',
        chaosScenario: 'omit_ax_tree',
      }),
      'req-chaos-3',
    );

    // The old HTML-path scenario names are no longer part of the schema.
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_request_body');
  });

  it('rejects a stepId that could escape the artifacts directory', async () => {
    // stepId is concatenated onto the artifacts path, so anything other than a
    // bare filename segment is an arbitrary file write.
    const traversals = ['../../pwned', '../pwned', '/tmp/pwned', 'nested/../../pwned', 'a/b', '..', '.'];

    for (const stepId of traversals) {
      const result = await handleAuditRun(
        runRequest({ journeyId: 'demo-login', environment: 'staging', stepId }),
        `req-stepid-${traversals.indexOf(stepId)}`,
      );

      expect(result.ok, `stepId ${JSON.stringify(stepId)} should be rejected`).toBe(false);
      expect(result.status).toBe(400);
      expect(result.body.error).toBe('invalid_request_body');
    }

    expect(runBrowserAudit).not.toHaveBeenCalled();
  });

  it('rejects an over-long stepId', async () => {
    const result = await handleAuditRun(
      runRequest({ journeyId: 'demo-login', environment: 'staging', stepId: 'a'.repeat(65) }),
      'req-stepid-long',
    );

    expect(result.ok).toBe(false);
    expect(result.body.error).toBe('invalid_request_body');
  });

  it('returns a stable code, not the exception text, when a run throws', async () => {
    // The message carries a filesystem path. Echoing error.message straight to
    // the caller, as the handler used to, leaks it.
    runBrowserAudit.mockRejectedValue(
      new Error('ENOENT: no such file or directory, open /Users/someone/.secrets/db.json'),
    );

    const result = await handleAuditRun(
      runRequest({ journeyId: 'demo-login', environment: 'staging' }),
      'req-failure-code',
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
    expect(result.body.error).toBe('audit_run_failed');
    expect(JSON.stringify(result.body)).not.toContain('.secrets');
    expect(JSON.stringify(result.body)).not.toContain('ENOENT');
  });

  it('rejects a malformed body before touching the browser', async () => {
    const result = await handleAuditRun(
      runRequest({ journeyId: '', environment: 'staging' }),
      'req-bad-body',
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(runBrowserAudit).not.toHaveBeenCalled();
  });
});
