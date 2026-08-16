import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunStore } from '../../src/domain/persistence';
import { auditReport, criticalFinding } from '../helpers/audit-report';

const { runBrowserAudit } = vi.hoisted(() => ({ runBrowserAudit: vi.fn() }));
vi.mock('../../src/integrations/browser/run-browser-audit', () => ({ runBrowserAudit }));

const { PartialAuditError } = await import('../../src/integrations/browser/partial-run');

const { handleAuditRun } = await import('../../src/app/api/_lib/audit-run-handler');
const { MemoryRunStore, resetRunStore, setRunStore } = await import(
  '../../src/integrations/persistence'
);

function runRequest(): Request {
  return new Request('http://localhost/api/audit/run?wait=1', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ journeyId: 'demo-login', environment: 'staging' }),
  });
}

describe('handleAuditRun persistence', () => {
  beforeEach(() => {
    runBrowserAudit.mockReset();
    setRunStore(new MemoryRunStore());
  });

  afterEach(async () => {
    resetRunStore();
  });

  it('persists runs and returns regression on a subsequent audit', async () => {

    runBrowserAudit.mockResolvedValue(auditReport({ findings: [] }));
    const baseline = await handleAuditRun(runRequest(), 'req-persist-1');
    expect(baseline.ok).toBe(true);
    expect(baseline.body.regression).toBeUndefined();

    runBrowserAudit.mockResolvedValue(auditReport({ findings: [criticalFinding()] }));
    const regression = await handleAuditRun(runRequest(), 'req-persist-2');

    expect(regression.ok).toBe(true);
    expect(regression.body.regression).toMatchObject({
      status: 'fail',
      baselineRequestId: 'req-persist-1',
    });
  });

  it('persists the fields needed to act on a finding later', async () => {
    // A stored finding used to keep only {code, severity, source}, which meant a
    // saved run could not say which element failed or which criterion it broke.
    const store = new MemoryRunStore();
    setRunStore(store);

    runBrowserAudit.mockResolvedValue(auditReport({ findings: [criticalFinding()] }));
    await handleAuditRun(runRequest(), 'req-persist-3');

    const stored = await store.getRun('req-persist-3');

    expect(stored?.findings[0]).toMatchObject({
      code: 'image-alt',
      severity: 'critical',
      selector: '#hero',
      wcagCriteria: ['1.1.1'],
      conformanceLevel: 'A',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
      htmlSnippet: '<img src="hero.png">',
    });
  });

  it('distinguishes two occurrences of the same rule on different elements', async () => {
    // Regression diffing keys on rule + selector. Keying on the rule alone
    // would collapse every occurrence into one entry and lose the diff.

    runBrowserAudit.mockResolvedValue(
      auditReport({ findings: [criticalFinding({ selector: '#a' })] }),
    );
    await handleAuditRun(runRequest(), 'req-persist-4');

    runBrowserAudit.mockResolvedValue(
      auditReport({
        findings: [criticalFinding({ selector: '#a' }), criticalFinding({ selector: '#b' })],
      }),
    );
    const second = await handleAuditRun(runRequest(), 'req-persist-5');

    const regression = second.body.regression as {
      status: string;
      newFindings: Array<{ selector?: string }>;
      unchangedCount: number;
    };

    expect(regression.newFindings).toHaveLength(1);
    expect(regression.newFindings[0].selector).toBe('#b');
    expect(regression.unchangedCount).toBe(1);
  });
});

describe('handleAuditRun async mode', () => {
  beforeEach(() => {
    runBrowserAudit.mockReset();
    setRunStore(new MemoryRunStore());
  });

  afterEach(async () => {
    resetRunStore();
  });

  /**
   * Waits for a background run to reach a terminal state.
   *
   * `waitUntil` work outlives the request by design, so a test that returns
   * as soon as it has its 202 leaves a promise still writing to the store —
   * which then lands in whatever fixture the next test set up.
   */
  async function settle(store: RunStore, requestId: string): Promise<void> {
    await vi.waitFor(async () => {
      const run = await store.getRun(requestId);
      expect(run?.status === 'complete' || run?.status === 'failed').toBe(true);
    });
  }

  function asyncRequest(): Request {
    return new Request('http://localhost/api/audit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ journeyId: 'demo-login', environment: 'staging' }),
    });
  }

  it('returns 202 with a poll URL instead of blocking', async () => {
    const store = new MemoryRunStore();
    setRunStore(store);
    runBrowserAudit.mockResolvedValue(auditReport());

    const result = await handleAuditRun(asyncRequest(), 'req-async-1');

    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({
      requestId: 'req-async-1',
      status: 'running',
      pollUrl: '/api/audit/runs/req-async-1',
    });

    // Let the background work settle before the store is torn down, so it
    // cannot write into a later test's fixture.
    await settle(store, 'req-async-1');
  });

  it('records the run as running before the work starts', async () => {
    // A run that times out or crashes must leave a trace. Records used to be
    // written only on success, so a run that died mid-flight was
    // indistinguishable from one that never happened.
    const store = new MemoryRunStore();
    setRunStore(store);

    let release: () => void = () => {};
    runBrowserAudit.mockImplementation(
      () => new Promise((resolve) => {
        release = () => resolve(auditReport());
      }),
    );

    await handleAuditRun(asyncRequest(), 'req-async-2');

    const inFlight = await store.getRun('req-async-2');
    expect(inFlight?.status).toBe('running');

    release();
    await settle(store, 'req-async-2');
  });

  it('a poll eventually sees the completed run', async () => {
    const store = new MemoryRunStore();
    setRunStore(store);
    runBrowserAudit.mockResolvedValue(auditReport({ findings: [criticalFinding()] }));

    await handleAuditRun(asyncRequest(), 'req-async-3');
    await vi.waitFor(async () => {
      expect((await store.getRun('req-async-3'))?.status).toBe('complete');
    });

    const finished = await store.getRun('req-async-3');
    expect(finished?.ciStatus).toBe('fail');
    expect(finished?.findings[0].selector).toBe('#hero');
  });

  it('records a failed run so a poll gets an answer rather than hanging', async () => {
    const store = new MemoryRunStore();
    setRunStore(store);
    runBrowserAudit.mockRejectedValue(
      new Error('ENOENT: no such file, open /Users/someone/.secrets/db.json'),
    );

    await handleAuditRun(asyncRequest(), 'req-async-4');
    await vi.waitFor(async () => {
      expect((await store.getRun('req-async-4'))?.status).toBe('failed');
    });

    const failed = await store.getRun('req-async-4');
    // The stored reason is the stable code, not the raw message with its path.
    expect(failed?.failureReason).toBe('audit_run_failed');
    expect(JSON.stringify(failed)).not.toContain('.secrets');
  });

  /**
   * A run that died partway still audited pages, and they are the point.
   *
   * This path stored `findings: []` and no pages, so a journey that found real
   * violations and then hit a stale selector reported nothing at all —
   * indistinguishable from one that walked cleanly and found nothing. The
   * difference between those two is the difference an auditor exists to
   * report.
   */
  it('keeps the pages and findings a failed run had already captured', async () => {
    const store = new MemoryRunStore();
    setRunStore(store);

    const captured = {
      page: { url: 'https://acme.test/cart', route: '/cart', title: 'Cart' },
      pageKey: '01-cart',
      evidenceStatus: 'complete' as const,
      artifacts: {},
      checks: { passed: 3, failed: 1, incomplete: 0 },
      timing: { totalMs: 120, scanMs: 90 },
      axe: { violations: [], incomplete: [], passCount: 3 },
      html: '',
      axTree: [],
      findings: [criticalFinding({ pageUrl: 'https://acme.test/cart' })],
    };

    runBrowserAudit.mockRejectedValue(
      new PartialAuditError(
        new Error('Step 2 ("login") could not fill "#gone": the selector never matched anything.'),
        [captured] as never,
        2,
      ),
    );

    await handleAuditRun(asyncRequest(), 'req-async-partial');
    await vi.waitFor(async () => {
      expect((await store.getRun('req-async-partial'))?.status).toBe('failed');
    });

    const failed = await store.getRun('req-async-partial');

    // It still failed, and still says why.
    expect(failed?.status).toBe('failed');
    expect(failed?.failureReason).toBe('journey_step_failed');
    expect(failed?.ciStatus).toBe('inconclusive');

    // And it kept what it saw.
    expect(failed?.pages?.map((page) => page.route)).toEqual(['/cart']);
    expect(failed?.findings).toHaveLength(1);
    expect(failed?.findings[0].code).toBe('image-alt');

    // Never a score. An incomplete walk has no denominator, and a number here
    // would let a partial run read as a graded one.
    expect(failed?.score).toBeUndefined();

    // Truncated *and* failed. Reported as 0 this reads as "we audited
    // everything" about a walk that was cut short twice over.
    expect(failed?.truncatedPages).toBe(2);

    // And the counts behind a score travel with the page. These persisted as
    // null on every partial run, because only the success path computed them.
    expect(failed?.pages?.[0]?.checksPassed).toBe(3);
  });
});
