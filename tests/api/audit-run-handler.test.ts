import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditReport, criticalFinding } from '../helpers/audit-report';

const { runBrowserAudit } = vi.hoisted(() => ({ runBrowserAudit: vi.fn() }));
vi.mock('../../src/integrations/browser/run-browser-audit', () => ({ runBrowserAudit }));

const { handleAuditRun, startRun } = await import('../../src/app/api/_lib/audit-run-handler');
const { MemoryRunStore, resetRunStore, setRunStore } = await import(
  '../../src/integrations/persistence'
);

/** Synchronous mode: these assert on the run's outcome, not on the 202 shape. */
function runRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/audit/run?wait=1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('handleAuditRun', () => {
  beforeEach(() => {
    runBrowserAudit.mockReset();
    runBrowserAudit.mockResolvedValue(auditReport());
    // The store used to fall back to the filesystem when nothing was
    // configured. It fails loudly without a database now, so every test that
    // reaches persistence injects the in-process double explicitly.
    setRunStore(new MemoryRunStore());
  });

  afterEach(() => {
    delete process.env.CHAOS_ENABLED;
    resetRunStore();
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

  it('passes a target URL and custom steps through to the run', async () => {
    await handleAuditRun(
      runRequest({
        journeyId: 'acme-checkout',
        environment: 'staging',
        targetUrl: 'https://staging.acme.example/app',
        steps: [{ action: 'navigate', type: 'goto', path: 'cart' }],
      }),
      'req-target-1',
    );

    const call = runBrowserAudit.mock.calls[0][0];
    expect(call.targetUrl).toBe('https://staging.acme.example/app');
    expect(call.steps).toEqual([{ action: 'navigate', type: 'goto', path: 'cart' }]);
  });

  it('rejects a target URL that is not a URL', async () => {
    const result = await handleAuditRun(
      runRequest({ journeyId: 'demo-login', environment: 'staging', targetUrl: 'not-a-url' }),
      'req-target-2',
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(runBrowserAudit).not.toHaveBeenCalled();
  });

  it('accepts a credential reference on a fill step but never a raw secret alongside it', async () => {
    await handleAuditRun(
      runRequest({
        journeyId: 'acme-checkout',
        environment: 'staging',
        targetUrl: 'https://staging.acme.example/',
        steps: [
          { action: 'login', type: 'fill', selector: '#u', credentialRef: 'acme', field: 'user' },
          { action: 'login', type: 'fill', selector: '#p', credentialRef: 'acme', field: 'pass' },
        ],
      }),
      'req-target-3',
    );

    const steps = runBrowserAudit.mock.calls[0][0].steps;
    expect(steps).toHaveLength(2);
    // The reference travels; the secret does not.
    expect(JSON.stringify(steps)).not.toContain('password');
    expect(steps[1]).toMatchObject({ credentialRef: 'acme', field: 'pass' });
  });

  it('rejects a credential reference that could forge an environment key', async () => {
    const result = await handleAuditRun(
      runRequest({
        journeyId: 'acme',
        environment: 'staging',
        steps: [
          { action: 'login', type: 'fill', selector: '#p', credentialRef: '../../x', field: 'pass' },
        ],
      }),
      'req-target-4',
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it('caps how many steps a single journey can carry', async () => {
    const result = await handleAuditRun(
      runRequest({
        journeyId: 'demo-login',
        environment: 'staging',
        steps: Array.from({ length: 51 }, () => ({
          action: 'navigate',
          type: 'goto',
          path: 'x',
        })),
      }),
      'req-target-5',
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it('ignores a caller target when running a chaos scenario', async () => {
    // Chaos runs are platform self-tests against local fixtures; letting a
    // caller redirect one at an arbitrary origin would turn a debug affordance
    // into a request-forgery primitive.
    process.env.CHAOS_ENABLED = 'true';

    await handleAuditRun(
      runRequest({
        journeyId: 'demo-login',
        environment: 'staging',
        chaosScenario: 'browser_complete_clean',
        targetUrl: 'https://attacker.example/',
      }),
      'req-target-6',
    );

    expect(runBrowserAudit.mock.calls[0][0].targetUrl).toBeUndefined();
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

/**
 * `startRun` is the seam every server-side caller uses. Its whole point is that
 * reaching a run no longer requires a `Request` — before it existed,
 * /api/audit/console had to manufacture one with the server's own token forged
 * into an Authorization header, because an HTTP handler was the only door.
 *
 * These tests therefore pass params directly and never build a Request.
 */
describe('startRun', () => {
  beforeEach(() => {
    runBrowserAudit.mockReset();
    runBrowserAudit.mockResolvedValue(auditReport());
    setRunStore(new MemoryRunStore());
  });

  afterEach(() => {
    delete process.env.CHAOS_ENABLED;
    resetRunStore();
  });

  it('runs synchronously when asked to wait', async () => {
    const result = await startRun(
      { journeyId: 'demo-login', environment: 'staging', wait: true },
      'req-start-sync',
    );

    expect(result.status).toBe(200);
    expect(result.body.ciStatus).toBe('pass');
    expect(result.body.requestId).toBe('req-start-sync');
  });

  it('returns 202 and a poll URL by default', async () => {
    const result = await startRun(
      { journeyId: 'demo-login', environment: 'staging' },
      'req-start-async',
    );

    expect(result.status).toBe(202);
    expect(result.body.status).toBe('running');
    expect(result.body.pollUrl).toBe('/api/audit/runs/req-start-async');
  });

  // The placeholder is what makes a run that dies mid-flight distinguishable
  // from one that never happened. It must be written before the work starts,
  // not after it finishes.
  it('persists a running placeholder before the work starts', async () => {
    const store = new MemoryRunStore();
    setRunStore(store);

    await startRun({ journeyId: 'demo-login', environment: 'staging' }, 'req-start-placeholder');

    const stored = await store.getRun('req-start-placeholder');
    expect(stored?.journeyId).toBe('demo-login');
  });

  // Chaos gating lives in startRun rather than in the HTTP handler, so every
  // caller inherits it — a server-side caller cannot reach a chaos scenario on
  // a deployment where chaos is switched off.
  it('refuses a chaos scenario when chaos is disabled, whoever the caller is', async () => {
    delete process.env.CHAOS_ENABLED;

    const result = await startRun(
      {
        journeyId: 'demo-login',
        environment: 'staging',
        chaosScenario: 'browser_complete_clean',
        wait: true,
      },
      'req-start-chaos',
    );

    expect(result.status).toBe(403);
    expect(result.body.error).toBe('chaos_not_enabled');
    expect(runBrowserAudit).not.toHaveBeenCalled();
  });
});
