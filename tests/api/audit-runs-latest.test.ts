import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from '../../src/app/api/audit/runs/latest/route';
import type { StoredRunRecord } from '../../src/domain/persistence';
import { createRunStore, resetRunStore, setRunStore } from '../../src/integrations/persistence';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeRecord(overrides: Partial<StoredRunRecord> & Pick<StoredRunRecord, 'requestId'>): StoredRunRecord {
  return {
    journeyId: 'demo-login',
    environment: 'staging',
    platform: 'generic',
    evidenceStatus: 'complete',
    ciStatus: 'pass',
    findings: [],
    durationMs: 10,
    createdAt: '2026-07-28T12:00:00.000Z',
    ...overrides,
  };
}

describe('GET /api/audit/runs/latest', () => {
  const originalToken = process.env.AUDITOR_RUN_TOKEN;
  let storeDir: string;

  beforeEach(async () => {
    process.env.AUDITOR_RUN_TOKEN = 'test-token-16chars';
    storeDir = await mkdtemp(join(tmpdir(), 'ada-latest-run-'));
    setRunStore(createRunStore(storeDir));
  });

  afterEach(async () => {
    if (originalToken === undefined) delete process.env.AUDITOR_RUN_TOKEN;
    else process.env.AUDITOR_RUN_TOKEN = originalToken;
    resetRunStore();
    if (storeDir) {
      await rm(storeDir, { recursive: true, force: true });
    }
  });

  it('rejects unauthorized requests', async () => {
    const response = await GET(
      new Request('http://localhost/api/audit/runs/latest?journeyId=demo-login&environment=staging'),
    );
    expect(response.status).toBe(401);
  });

  it('requires journeyId and environment', async () => {
    const response = await GET(
      new Request('http://localhost/api/audit/runs/latest', {
        headers: { Authorization: 'Bearer test-token-16chars' },
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('invalid_query');
  });

  it('returns 404 when no run exists', async () => {
    const response = await GET(
      new Request('http://localhost/api/audit/runs/latest?journeyId=demo-login&environment=staging', {
        headers: { Authorization: 'Bearer test-token-16chars' },
      }),
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('run_not_found');
  });

  it('returns the latest stored run for CI/executive consumers', async () => {
    const store = createRunStore(storeDir);
    setRunStore(store);
    await store.saveRun(
      makeRecord({
        requestId: 'req-old',
        createdAt: '2026-07-28T10:00:00.000Z',
        ciStatus: 'fail',
      }),
    );
    await store.saveRun(
      makeRecord({
        requestId: 'req-new',
        createdAt: '2026-07-28T11:00:00.000Z',
        ciStatus: 'pass',
        findings: [{ code: 'missing-image-alt', severity: 'critical', source: 'deterministic' }],
      }),
    );

    const response = await GET(
      new Request('http://localhost/api/audit/runs/latest?journeyId=demo-login&environment=staging', {
        headers: { Authorization: 'Bearer test-token-16chars' },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.run.requestId).toBe('req-new');
    expect(body.run.ciStatus).toBe('pass');
    expect(body.regression).toBeDefined();
    expect(body.regression.baselineRequestId).toBe('req-old');
  });
});
