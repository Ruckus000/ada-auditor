import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditReport, criticalFinding } from '../helpers/audit-report';

const { runBrowserAudit } = vi.hoisted(() => ({ runBrowserAudit: vi.fn() }));
vi.mock('../../src/integrations/browser/run-browser-audit', () => ({ runBrowserAudit }));

const { handleAuditRun } = await import('../../src/app/api/_lib/audit-run-handler');
const { createRunStore, resetRunStore, setRunStore } = await import(
  '../../src/integrations/persistence'
);

function runRequest(): Request {
  return new Request('http://localhost/api/audit/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ journeyId: 'demo-login', environment: 'staging' }),
  });
}

describe('handleAuditRun persistence', () => {
  let storeDir: string;

  beforeEach(() => {
    runBrowserAudit.mockReset();
  });

  afterEach(async () => {
    if (storeDir) {
      await rm(storeDir, { recursive: true, force: true });
    }
    resetRunStore();
  });

  it('persists runs and returns regression on a subsequent audit', async () => {
    storeDir = await mkdtemp(join(tmpdir(), 'ada-run-store-'));
    setRunStore(createRunStore(storeDir));

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
    storeDir = await mkdtemp(join(tmpdir(), 'ada-run-store-'));
    const store = createRunStore(storeDir);
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
    storeDir = await mkdtemp(join(tmpdir(), 'ada-run-store-'));
    setRunStore(createRunStore(storeDir));

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
