import { expect, it } from 'vitest';
import type { RunStore, StoredRunRecord } from '../../src/domain/persistence';

/**
 * The behaviour every `RunStore` owes its callers, run against each
 * implementation.
 *
 * Written once and shared deliberately: the in-memory double exists so the
 * unit suite does not need a database, and a double that quietly disagrees
 * with the real store is worse than no double at all — every handler test
 * would be passing against behaviour production does not have.
 *
 * ## Isolation
 *
 * Every record here uses `CONTRACT_JOURNEY` and a `contract-` request id, and
 * every query scopes itself to that journey. The Postgres suite runs against a
 * database that already holds real runs, and an assertion like "this is the
 * latest run" is only true of an empty table — the first real audit recorded
 * against `demo-login` turned this suite red for reasons that had nothing to
 * do with the store.
 */

export const CONTRACT_JOURNEY = 'contract-journey';

export function runRecord(
  overrides: Partial<StoredRunRecord> & Pick<StoredRunRecord, 'requestId'>,
): StoredRunRecord {
  return {
    journeyId: CONTRACT_JOURNEY,
    environment: 'staging',
    platform: 'generic',
    evidenceStatus: 'complete',
    ciStatus: 'pass',
    findings: [],
    durationMs: 10,
    createdAt: '2026-08-08T12:00:00.000Z',
    ...overrides,
  };
}

const FULL_RECORD = runRecord({
  requestId: 'contract-full',
  ciStatus: 'fail',
  evidenceStatus: 'complete',
  durationMs: 1234,
  browserMode: true,
  status: 'complete',
  truncatedPages: 2,
  pages: [
    {
      url: 'https://app.example.com/login',
      route: '/login',
      title: 'Login',
      evidenceStatus: 'complete',
      artifacts: { screenshotUrl: 'https://blob.test/login.png' },
    },
    {
      url: 'https://app.example.com/checkout',
      route: '/checkout',
      title: 'Checkout',
      evidenceStatus: 'degraded',
    },
  ],
  findings: [
    {
      code: 'image-alt',
      severity: 'critical',
      source: 'deterministic',
      message: 'Images must have alternate text',
      wcagCriteria: ['1.1.1'],
      conformanceLevel: 'A',
      pageUrl: 'https://app.example.com/checkout',
      selector: '#hero',
      htmlSnippet: '<img src="hero.png">',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
    },
    {
      code: 'ai-advisory',
      severity: 'advisory',
      source: 'ai-advisory',
      message: 'Navigation is labelled differently on two pages.',
      gateable: false,
      confidence: 0.84,
    },
  ],
});

/**
 * `makeStore` returns a store that is empty for each test. Implementations
 * that share durable state are responsible for isolating themselves (the
 * Postgres suite namespaces its request ids and deletes them afterwards).
 */
export function runStoreContract(makeStore: () => Promise<RunStore> | RunStore): void {
  it('round-trips a run without losing a field', async () => {
    // Fields have been dropped silently here before — a stored finding once
    // kept only {code, severity, source}, which left a saved run unable to say
    // which element failed or which criterion it broke.
    const store = await makeStore();
    await store.saveRun(FULL_RECORD);

    expect(await store.getRun(FULL_RECORD.requestId)).toEqual(FULL_RECORD);
  });

  it('keeps pages in visit order, not in whatever order they come back', async () => {
    const store = await makeStore();
    await store.saveRun(FULL_RECORD);

    const stored = await store.getRun(FULL_RECORD.requestId);
    expect(stored?.pages?.map((page) => page.route)).toEqual(['/login', '/checkout']);
  });

  it('keeps each finding attached to its page', async () => {
    const store = await makeStore();
    await store.saveRun(FULL_RECORD);

    const stored = await store.getRun(FULL_RECORD.requestId);
    expect(stored?.findings[0].pageUrl).toBe('https://app.example.com/checkout');
    // Advisory findings cover the whole journey, so they carry no page.
    expect(stored?.findings[1].pageUrl).toBeUndefined();
  });

  it('returns null for a run that does not exist', async () => {
    const store = await makeStore();
    expect(await store.getRun('contract-missing')).toBeNull();
  });

  it('overwrites the running placeholder rather than colliding with it', async () => {
    // A run is recorded as `running` before the audit starts and rewritten
    // when it finishes. If the second write did not replace the first, every
    // poll would see a run stuck at `running` forever.
    const store = await makeStore();
    await store.saveRun(runRecord({ requestId: 'contract-upsert', status: 'running' }));
    await store.saveRun(
      runRecord({
        requestId: 'contract-upsert',
        status: 'complete',
        ciStatus: 'fail',
        pages: [
          {
            url: 'https://app.example.com/a',
            route: '/a',
            title: 'A',
            evidenceStatus: 'complete',
          },
        ],
      }),
    );

    const stored = await store.getRun('contract-upsert');
    expect(stored?.status).toBe('complete');
    expect(stored?.ciStatus).toBe('fail');
    expect(stored?.pages).toHaveLength(1);
  });

  it('does not leave children behind from an earlier write', async () => {
    // The placeholder has no pages and the finished record has several. A
    // rewrite that only upserts the parent leaves a run holding pages from an
    // attempt that no longer exists.
    const store = await makeStore();
    await store.saveRun(FULL_RECORD);
    await store.saveRun(runRecord({ requestId: FULL_RECORD.requestId }));

    const stored = await store.getRun(FULL_RECORD.requestId);
    expect(stored?.pages).toBeUndefined();
    expect(stored?.findings).toEqual([]);
  });

  it('finds the most recent run for a journey and environment', async () => {
    const store = await makeStore();
    await store.saveRun(
      runRecord({ requestId: 'contract-old', createdAt: '2026-08-08T10:00:00.000Z' }),
    );
    await store.saveRun(
      runRecord({ requestId: 'contract-new', createdAt: '2026-08-08T11:00:00.000Z' }),
    );

    const latest = await store.getLatestRun(CONTRACT_JOURNEY, 'staging');
    expect(latest?.requestId).toBe('contract-new');
  });

  it('excludes the current run so a baseline is the one before it', async () => {
    const store = await makeStore();
    await store.saveRun(
      runRecord({ requestId: 'contract-old', createdAt: '2026-08-08T10:00:00.000Z' }),
    );
    await store.saveRun(
      runRecord({ requestId: 'contract-new', createdAt: '2026-08-08T11:00:00.000Z' }),
    );

    const baseline = await store.getLatestRun(CONTRACT_JOURNEY, 'staging', 'contract-new');
    expect(baseline?.requestId).toBe('contract-old');
  });

  it('does not mistake another journey or environment for this one', async () => {
    const store = await makeStore();
    await store.saveRun(
      runRecord({ requestId: 'contract-other-journey', journeyId: 'contract-other' }),
    );
    await store.saveRun(
      runRecord({ requestId: 'contract-other-env', environment: 'production' }),
    );

    expect(await store.getLatestRun(CONTRACT_JOURNEY, 'staging')).toBeNull();
  });

  it('lists run history newest first', async () => {
    // Called out in the Phase 1 plan and never delivered, so until now there
    // was no way to enumerate history at all.
    const store = await makeStore();
    for (const [i, id] of ['contract-1', 'contract-2', 'contract-3'].entries()) {
      await store.saveRun(
        runRecord({ requestId: id, createdAt: `2026-08-08T1${i}:00:00.000Z` }),
      );
    }

    const runs = await store.list({ journeyId: CONTRACT_JOURNEY });
    expect(runs.map((run) => run.requestId)).toEqual([
      'contract-3',
      'contract-2',
      'contract-1',
    ]);
  });

  it('filters a listing by journey and environment', async () => {
    const store = await makeStore();
    await store.saveRun(runRecord({ requestId: 'contract-a' }));
    await store.saveRun(
      runRecord({ requestId: 'contract-b', journeyId: 'contract-other' }),
    );
    await store.saveRun(runRecord({ requestId: 'contract-c', environment: 'production' }));

    const runs = await store.list({ journeyId: CONTRACT_JOURNEY, environment: 'staging' });
    expect(runs.map((run) => run.requestId)).toEqual(['contract-a']);
  });

  it('caps a listing so one call cannot pull the whole table', async () => {
    const store = await makeStore();
    for (const [i, id] of ['contract-1', 'contract-2', 'contract-3'].entries()) {
      await store.saveRun(
        runRecord({ requestId: id, createdAt: `2026-08-08T1${i}:00:00.000Z` }),
      );
    }

    expect(await store.list({ journeyId: CONTRACT_JOURNEY, limit: 2 })).toHaveLength(2);
    // An absurd limit is clamped, not honoured.
    expect((await store.list({ limit: 100_000 })).length).toBeLessThanOrEqual(100);
  });

  it('lists a run with its pages and findings, not a bare header', async () => {
    const store = await makeStore();
    await store.saveRun(FULL_RECORD);

    const [run] = await store.list({ journeyId: CONTRACT_JOURNEY });
    expect(run.pages).toHaveLength(2);
    expect(run.findings).toHaveLength(2);
  });
}
