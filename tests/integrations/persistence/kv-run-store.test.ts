import { afterEach, describe, expect, it } from 'vitest';
import type { StoredRunRecord } from '../../../src/domain/persistence';
import { KvRunStore, type KvClient } from '../../../src/integrations/persistence/kv-run-store';
import { createRunStore, isKvConfigured, resetRunStore } from '../../../src/integrations/persistence';

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

function createMemoryKv(seed?: Record<string, unknown>): KvClient {
  const map = new Map<string, unknown>(Object.entries(seed ?? {}));
  return {
    async get<T>(key: string): Promise<T | null> {
      if (!map.has(key)) return null;
      return map.get(key) as T;
    },
    async set(key: string, value: unknown): Promise<'OK'> {
      map.set(key, value);
      return 'OK';
    },
  };
}

describe('KvRunStore', () => {
  afterEach(() => {
    resetRunStore();
  });

  it('saves and retrieves runs by request id', async () => {
    const store = new KvRunStore(createMemoryKv());
    const record = makeRecord({ requestId: 'req-1' });

    await store.saveRun(record);

    expect(await store.getRun('req-1')).toEqual(record);
  });

  it('returns latest run for journey and environment via pointer', async () => {
    const store = new KvRunStore(createMemoryKv());

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
    const store = new KvRunStore(createMemoryKv());

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

  it('falls back to previous when latest points at a missing run', async () => {
    const previous = makeRecord({
      requestId: 'req-previous',
      createdAt: '2026-07-28T10:00:00.000Z',
    });
    const store = new KvRunStore(
      createMemoryKv({
        'run:req-previous': previous,
        'latest:demo-login:staging': 'req-missing',
        'previous:demo-login:staging': 'req-previous',
      }),
    );

    const latest = await store.getLatestRun('demo-login', 'staging');
    expect(latest?.requestId).toBe('req-previous');
  });
});

describe('createRunStore factory', () => {
  const originalUrl = process.env.KV_REST_API_URL;
  const originalToken = process.env.KV_REST_API_TOKEN;
  const originalUpstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const originalVercel = process.env.VERCEL;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = originalUrl;
    if (originalToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = originalToken;
    if (originalUpstashUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalUpstashUrl;
    if (originalUpstashToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalUpstashToken;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
    resetRunStore();
  });

  it('detects KV configuration from REST env vars', () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    expect(isKvConfigured()).toBe(false);

    process.env.KV_REST_API_URL = 'https://example.upstash.io';
    process.env.KV_REST_API_TOKEN = 'token';
    expect(isKvConfigured()).toBe(true);
  });

  it('prefers filesystem when an explicit storeDir is provided', () => {
    process.env.KV_REST_API_URL = 'https://example.upstash.io';
    process.env.KV_REST_API_TOKEN = 'token';
    const store = createRunStore('/tmp/ada-runs-test');
    expect(store.constructor.name).toBe('FileRunStore');
  });

  it('fails closed on Vercel when KV is not configured', () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.VERCEL = '1';

    expect(() => createRunStore()).toThrow(/Durable run store required on Vercel/);
  });

  it('uses FileRunStore locally when KV is not configured', () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.VERCEL;

    const store = createRunStore();
    expect(store.constructor.name).toBe('FileRunStore');
  });
});
