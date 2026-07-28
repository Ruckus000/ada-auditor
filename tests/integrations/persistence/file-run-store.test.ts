import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoredRunRecord } from '../../../src/domain/persistence';
import { FileRunStore } from '../../../src/integrations/persistence/file-run-store';
import { resetRunStore } from '../../../src/integrations/persistence';

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

describe('FileRunStore', () => {
  let storeDir: string;

  afterEach(async () => {
    if (storeDir) {
      await rm(storeDir, { recursive: true, force: true });
    }
    resetRunStore();
  });

  it('saves and retrieves runs by request id', async () => {
    storeDir = await mkdtemp(join(tmpdir(), 'ada-run-store-'));
    const store = new FileRunStore(storeDir);
    const record = makeRecord({ requestId: 'req-1' });

    await store.saveRun(record);

    expect(await store.getRun('req-1')).toEqual(record);
  });

  it('returns latest run for journey and environment', async () => {
    storeDir = await mkdtemp(join(tmpdir(), 'ada-run-store-'));
    const store = new FileRunStore(storeDir);

    await store.saveRun(
      makeRecord({
        requestId: 'req-old',
        createdAt: '2026-07-28T10:00:00.000Z',
      }),
    );
    await store.saveRun(
      makeRecord({
        requestId: 'req-new',
        createdAt: '2026-07-28T11:00:00.000Z',
      }),
    );

    const latest = await store.getLatestRun('demo-login', 'staging');
    expect(latest?.requestId).toBe('req-new');
  });

  it('excludes the current request id when finding baseline', async () => {
    storeDir = await mkdtemp(join(tmpdir(), 'ada-run-store-'));
    const store = new FileRunStore(storeDir);

    await store.saveRun(
      makeRecord({
        requestId: 'req-baseline',
        createdAt: '2026-07-28T10:00:00.000Z',
      }),
    );
    await store.saveRun(
      makeRecord({
        requestId: 'req-current',
        createdAt: '2026-07-28T11:00:00.000Z',
      }),
    );

    const baseline = await store.getLatestRun('demo-login', 'staging', 'req-current');
    expect(baseline?.requestId).toBe('req-baseline');
  });
});
