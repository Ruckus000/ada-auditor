import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { handleAuditRun } from '../../src/app/api/_lib/audit-run-handler';
import { createRunStore, resetRunStore, setRunStore } from '../../src/integrations/persistence';

describe('handleAuditRun persistence', () => {
  let storeDir: string;

  afterEach(async () => {
    if (storeDir) {
      await rm(storeDir, { recursive: true, force: true });
    }
    resetRunStore();
  });

  it('persists runs and returns regression on subsequent audit', async () => {
    storeDir = await mkdtemp(join(tmpdir(), 'ada-run-store-'));
    setRunStore(createRunStore(storeDir));

    const baselineRequest = new Request('http://localhost/api/audit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        journeyId: 'demo-login',
        environment: 'staging',
        html: '<main><img src="hero.png" alt="Hero"></main>',
      }),
    });

    const baselineResult = await handleAuditRun(baselineRequest, 'req-persist-1');
    expect(baselineResult.ok).toBe(true);
    expect(baselineResult.body.regression).toBeUndefined();

    const regressionRequest = new Request('http://localhost/api/audit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        journeyId: 'demo-login',
        environment: 'staging',
        html: '<main><img src="hero.png"></main>',
      }),
    });

    const regressionResult = await handleAuditRun(regressionRequest, 'req-persist-2');
    expect(regressionResult.ok).toBe(true);
    expect(regressionResult.body.regression).toMatchObject({
      status: 'fail',
      baselineRequestId: 'req-persist-1',
    });
  });
});
