import { expect, it } from 'vitest';
import type { RunStore, StoredRunRecord } from '../../src/domain/persistence';
import { RUN_STALE_AFTER_MS } from '../../src/domain/run-staleness';

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
  startedAt: '2026-01-01T00:00:00.000Z',
  phaseMs: { journey: 900, advisory: 200, upload: 100 },
  browserMode: true,
  status: 'complete',
  truncatedPages: 2,
  score: 87,
  scoreVersion: 1,
  pages: [
    {
      url: 'https://app.example.com/login',
      route: '/login',
      title: 'Login',
      evidenceStatus: 'complete',
      artifacts: { screenshotUrl: 'https://blob.test/login.png' },
      checksPassed: 80,
      checksFailed: 10,
      checksIncomplete: 5,
      durationMs: 4200,
      scanMs: 1800,
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
      title: 'Images must have alternate text',
      message: 'Element does not have an alt attribute',
      remediationAnyOf: [
        'Element does not have an alt attribute',
        'aria-label attribute does not exist',
      ],
      remediationAllOf: [],
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

  it('round-trips a finding that has no title', async () => {
    // Every run stored before the column existed has none, and nothing
    // backfilled them — axe's wording changes between releases, so writing
    // today's sentence onto last month's audit would put words in the mouth
    // of a run that never said them. Absent has to come back absent, not as
    // an empty string a screen would render as a blank heading.
    const store = await makeStore();
    const untitled = {
      ...FULL_RECORD,
      requestId: `${FULL_RECORD.requestId}-untitled`,
      findings: [
        {
          code: 'image-alt',
          severity: 'critical',
          source: 'deterministic',
          message: 'Element does not have an alt attribute',
          pageUrl: 'https://app.example.com/checkout',
          selector: '#hero',
        },
      ],
    };

    await store.saveRun(untitled);

    const read = await store.getRun(untitled.requestId);
    expect(read?.findings[0]).not.toHaveProperty('title');
    // Same distinction for the fix list: nothing stored is not an empty fix
    // list, and a screen has to be able to tell them apart.
    expect(read?.findings[0]).not.toHaveProperty('remediationAnyOf');
  });

  it('round-trips the score and the counts behind it', async () => {
    // A score is a claim in a client report. Losing the version would let a
    // formula change silently reinterpret history, and losing the per-page
    // counts would leave the number unexplainable.
    const store = await makeStore();
    await store.saveRun(FULL_RECORD);

    const stored = await store.getRun(FULL_RECORD.requestId);
    expect(stored?.score).toBe(87);
    expect(stored?.scoreVersion).toBe(1);
    expect(stored?.pages?.[0]).toMatchObject({
      checksPassed: 80,
      checksFailed: 10,
      checksIncomplete: 5,
    });
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

  it('keeps findings across the running-to-complete rewrite', async () => {
    // The regression guard for where triage lives. `saveRun` deletes and
    // reinserts a run's children on every write, so anything stored ON a
    // findings row — a dismissal, a note — is destroyed by the ordinary
    // lifecycle of a single run, before any re-audit. Triage therefore lives
    // in `finding_triage`, keyed on the finding's identity. If this test ever
    // starts failing, that decision has been quietly reversed.
    const store = await makeStore();
    await store.saveRun(runRecord({ requestId: 'contract-rewrite', status: 'running' }));
    await store.saveRun({ ...FULL_RECORD, requestId: 'contract-rewrite' });

    const stored = await store.getRun('contract-rewrite');
    expect(stored?.findings).toHaveLength(FULL_RECORD.findings.length);
    expect(stored?.findings[0].selector).toBe('#hero');
    expect(stored?.pages).toHaveLength(2);
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

  /**
   * A run that died mid-flight.
   *
   * `executeRun` is the only thing that overwrites the `running` placeholder,
   * so a timeout or a crash leaves the row `running` forever and the client
   * screen shows a scan that has apparently been going since Tuesday. Both
   * halves are pinned here: reads must never report it as still running, and
   * the sweep must actually write the correction down. A double that did only
   * one of them would make the fast suite green about behaviour production
   * does not have.
   */
  it('reports a run abandoned past the staleness threshold as failed', async () => {
    const store = await makeStore();
    const longAgo = new Date(Date.now() - 3 * RUN_STALE_AFTER_MS).toISOString();

    await store.saveRun(
      runRecord({
        requestId: 'contract-abandoned',
        status: 'running',
        createdAt: longAgo,
        startedAt: longAgo,
      }),
    );

    const read = await store.getRun('contract-abandoned');
    expect(read?.status).toBe('failed');
    expect(read?.failureReason).toBe('run_timed_out');
  });

  it('leaves a run still inside the threshold alone', async () => {
    const store = await makeStore();
    const justNow = new Date().toISOString();

    await store.saveRun(
      runRecord({
        requestId: 'contract-inflight',
        status: 'running',
        createdAt: justNow,
        startedAt: justNow,
      }),
    );

    expect((await store.getRun('contract-inflight'))?.status).toBe('running');
  });

  /**
   * `reconcileStaleRuns` takes no filter that could scope it to `contract-%`,
   * so against Postgres it corrects every abandoned run in the database — the
   * same caveat this file already records for `listClients`/`listEvents`, and
   * the same consequence: assert with `toBeGreaterThanOrEqual`, never an exact
   * count. Correcting real abandoned rows is the sweep doing its job, which is
   * also why the CI job points at a dedicated Neon branch and not production.
   */
  it('sweeps abandoned runs and reports how many it corrected', async () => {
    const store = await makeStore();
    const longAgo = new Date(Date.now() - 3 * RUN_STALE_AFTER_MS).toISOString();

    await store.saveRun(
      runRecord({ requestId: 'contract-sweep-a', status: 'running', createdAt: longAgo, startedAt: longAgo }),
    );
    await store.saveRun(
      runRecord({ requestId: 'contract-sweep-b', status: 'complete', createdAt: longAgo, startedAt: longAgo }),
    );

    expect(await store.reconcileStaleRuns(RUN_STALE_AFTER_MS)).toBeGreaterThanOrEqual(1);
    // A finished run is not touched, whatever its age.
    expect((await store.getRun('contract-sweep-b'))?.status).toBe('complete');
  });


  /**
   * Retention has to reach the database, not only the blob store.
   *
   * `prune-artifacts` deleted the bytes and never touched these columns, so a
   * pruned run kept URLs that 404 forever with nothing to say why. A page with
   * no artifacts now reads as "no evidence" rather than as a broken link.
   */
  it('clears artifact pointers for runs older than the cutoff', async () => {
    const store = await makeStore();
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    await store.saveRun(
      runRecord({
        requestId: 'contract-pruned',
        createdAt: old,
        pages: [
          {
            url: 'https://a.example/',
            route: '/',
            title: 'Home',
            evidenceStatus: 'complete',
            artifacts: { screenshotUrl: 'https://blob.test/old.png' },
          },
        ],
      }),
    );

    const cleared = await store.clearArtifactsBefore(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    );

    expect(cleared).toBeGreaterThanOrEqual(1);
    // Absent, not empty: the page never had evidence as far as anyone reading
    // it later is concerned, and `{}` versus missing is a distinction this
    // store already keeps everywhere else.
    expect((await store.getRun('contract-pruned'))?.pages?.[0]).not.toHaveProperty('artifacts');
  });

  it('leaves evidence inside the retention window alone', async () => {
    const store = await makeStore();

    await store.saveRun(
      runRecord({
        requestId: 'contract-fresh',
        createdAt: new Date().toISOString(),
        pages: [
          {
            url: 'https://a.example/',
            route: '/',
            title: 'Home',
            evidenceStatus: 'complete',
            artifacts: { screenshotUrl: 'https://blob.test/fresh.png' },
          },
        ],
      }),
    );

    await store.clearArtifactsBefore(
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    );

    expect((await store.getRun('contract-fresh'))?.pages?.[0]?.artifacts).toEqual({
      screenshotUrl: 'https://blob.test/fresh.png',
    });
  });
}
