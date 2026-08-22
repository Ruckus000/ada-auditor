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
  intent: { steps: [{ action: 'navigate', type: 'goto', path: '/login' }] },
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
      statusCode: 200,
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
  it('reads a run back with no notion of who is asking', async () => {
    // There is no tenancy, and that is the design rather than an oversight:
    // one organisation, every operator sees every client, no table carries a
    // tenant column. "Any authenticated caller can read any run" is intended.
    //
    // Pinned here because the dangerous version of this is not the design — it
    // is somebody later *assuming* isolation exists, or half-introducing it.
    // `getRun` takes a request id and nothing else, and this test fails the
    // moment it grows a second parameter, which is the point at which the
    // decision has to be made in `schema.sql` first.
    const store = await makeStore();
    await store.saveRun(FULL_RECORD);

    expect(await store.getRun(FULL_RECORD.requestId)).not.toBeNull();
    expect(store.getRun.length).toBe(1);
  });

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

  it('leaves an unrecorded gate version absent rather than inventing one', async () => {
    // `FULL_RECORD` carries no gate version, and it must come back carrying
    // none. The first version of this column was `not null default 1`, so
    // Postgres answered `gateVersion: 1` for a record that never had one while
    // `MemoryRunStore` answered nothing — a store that invents a field the
    // other does not is exactly the drift this contract exists to catch, and
    // `round-trips a run without losing a field` caught it.
    const store = await makeStore();
    await store.saveRun(FULL_RECORD);

    expect(await store.getRun(FULL_RECORD.requestId)).not.toHaveProperty('gateVersion');
  });

  it('round-trips which gate produced the verdict', async () => {
    // `ciStatus` is the other claim in a client report, and it moved once
    // already: version 1 failed a run on an axe `critical` impact, version 2
    // on an unmet WCAG success criterion. A stored `pass` cannot be compared
    // across that change without knowing which question it answered.
    const store = await makeStore();
    await store.saveRun({ ...FULL_RECORD, gateVersion: 2 });

    const stored = await store.getRun(FULL_RECORD.requestId);
    expect(stored?.gateVersion).toBe(2);
  });

  it('round-trips the page HTTP status, and leaves absent absent', async () => {
    // The fact behind the judgement. A page degraded by a missing screenshot
    // and a page degraded by a 500 read identically without it, and they need
    // different people to do different things.
    const store = await makeStore();
    await store.saveRun(FULL_RECORD);

    const stored = await store.getRun(FULL_RECORD.requestId);
    expect(stored?.pages?.[0].statusCode).toBe(200);

    // Not zero, and not 200. The second page never carried a status — a
    // `file://` run has none — and a store that invented one here would be
    // asserting a measurement nobody took, on the field that decides whether
    // the page counted.
    expect(stored?.pages?.[1]).not.toHaveProperty('statusCode');
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

  it('filters by status, so "a completed run exists" is one query', async () => {
    const store = await makeStore();
    await store.saveRun(
      runRecord({
        requestId: 'contract-rsc-complete-1',
        journeyId: 'contract-rsc-journey',
        status: 'complete',
      }),
    );
    await store.saveRun(
      runRecord({
        requestId: 'contract-rsc-failed-1',
        journeyId: 'contract-rsc-journey',
        status: 'failed',
      }),
    );

    const completed = await store.list({ journeyId: 'contract-rsc-journey', status: 'complete' });

    expect(completed.map((run) => run.requestId)).toContain('contract-rsc-complete-1');
    expect(completed.map((run) => run.requestId)).not.toContain('contract-rsc-failed-1');
    expect(completed.every((run) => run.status === 'complete')).toBe(true);
  });

  /**
   * A run that died mid-flight: stored `running`, stale past the threshold.
   * The filter matches the STORED status; the record handed back reads as
   * every other read path reports it — reconciled to failed.
   */
  it('filters on the stored status, then reconciles what it returns', async () => {
    const store = await makeStore();
    const longAgo = new Date(Date.now() - 3 * RUN_STALE_AFTER_MS).toISOString();

    await store.saveRun(
      runRecord({
        requestId: 'contract-stale-filter-1',
        journeyId: 'contract-stale-filter-j',
        status: 'running',
        createdAt: longAgo,
        startedAt: longAgo,
      }),
    );

    const runs = await store.list({ journeyId: 'contract-stale-filter-j', status: 'running' });
    expect(runs.map((run) => run.requestId)).toContain('contract-stale-filter-1');
    expect(runs.find((run) => run.requestId === 'contract-stale-filter-1')?.status).toBe('failed');
    expect(runs.find((run) => run.requestId === 'contract-stale-filter-1')?.failureReason).toBe(
      'run_timed_out',
    );
  });

  /**
   * That a store honours a limit at all. The *clamp* is tested elsewhere, and
   * moving it there is what makes this test both meaningful and quick.
   *
   * It used to end with `store.list({ limit: 100_000 })` and assert the result
   * was at most 100. Two things were wrong with that. It is vacuous on a clean
   * database — three rows satisfy "at most 100" — so it proved the clamp only
   * when the shared dev database happened to be full. And when the database
   * *was* full it hydrated a hundred runs with all their pages and findings
   * over the network, which is why this one test timed out at five seconds
   * locally and passed in twenty in CI. A suite that cries wolf stops being
   * run, which is the same reasoning that put the db suite in its own config.
   *
   * `clampRunListLimit` is now one function in `domain/persistence`, shared by
   * both stores and tested against its boundaries in the fast suite.
   */
  it('honours a listing limit', async () => {
    const store = await makeStore();
    // Two, not three. Each `saveRun` writes a run, its pages and its findings,
    // and against a hosted Postgres that is a second of pure latency for a row
    // this test does not need — the pair below proves the limit truncates just
    // as well as a trio would.
    for (const [i, id] of ['contract-1', 'contract-2'].entries()) {
      await store.saveRun(
        runRecord({ requestId: id, createdAt: `2026-08-08T1${i}:00:00.000Z` }),
      );
    }

    // Scoped to this contract's own journey, so the assertion cannot be
    // changed by whatever else is in the database.
    expect(await store.list({ journeyId: CONTRACT_JOURNEY, limit: 1 })).toHaveLength(1);
    expect(await store.list({ journeyId: CONTRACT_JOURNEY })).toHaveLength(2);
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

  /**
   * Absent has to survive as absent.
   *
   * `compareToBaseline` reads a missing `intent` as "this run never recorded
   * what it was asked to walk", and withholds the diff rather than guessing. A
   * store that helpfully defaulted the column to `{steps: []}` would turn every
   * pre-existing run into one that claims to have walked nothing — and two of
   * those compare as equal, which is the false all-clear the column exists to
   * prevent.
   */
  it('keeps a run that recorded no intent distinguishable from one that did', async () => {
    const store = await makeStore();
    await store.saveRun(runRecord({ requestId: 'contract-no-intent' }));

    const read = await store.getRun('contract-no-intent');

    expect(read).not.toBeNull();
    expect(read).not.toHaveProperty('intent');
  });

  it('round-trips the steps a run was given, in order', async () => {
    const store = await makeStore();
    const steps = [
      { action: 'navigate', type: 'goto', path: '/' },
      { action: 'login', type: 'fill', selector: '#user', credentialRef: 'acme', field: 'user' },
      { action: 'navigate', type: 'click', selector: '#submit' },
    ];
    // With the rule set, because that is the half that was silently dropped.
    // `redactIntent` rebuilt the intent as `{steps}` alone, so no run ever
    // stored a `ruleset` and `walkedTheSamePath` compared two undefineds and
    // answered "same rules" every time. This assertion previously asserted
    // exactly the broken shape — `toEqual({ steps })` — and so agreed with the
    // bug rather than catching it.
    const ruleset = 'axe-core@4.12.1+target-size';
    await store.saveRun(
      runRecord({ requestId: 'contract-intent', intent: { steps, ruleset } }),
    );

    // Order and shape both, because the comparison serialises: a store that
    // reordered keys or entries would make two identical runs incomparable.
    expect((await store.getRun('contract-intent'))?.intent).toEqual({ steps, ruleset });
  });

  /**
   * A re-save that carries no intent must not erase the one already recorded.
   *
   * The reachable second write is `executeRun`'s catch: a run that failed late
   * records a failure with no intent, over a row that already has one. Losing
   * it there would leave a run that cannot be compared and cannot say why —
   * and the two stores disagreed about this, Postgres coalescing while the
   * memory double overwrote wholesale, with nothing here to notice.
   */
  it('keeps a recorded intent when a later save omits it', async () => {
    const store = await makeStore();
    const steps = [{ action: 'navigate', type: 'goto', path: '/checkout' }];

    await store.saveRun(runRecord({ requestId: 'contract-intent-resave', intent: { steps } }));
    await store.saveRun(
      runRecord({ requestId: 'contract-intent-resave', status: 'failed', failureReason: 'x' }),
    );

    const read = await store.getRun('contract-intent-resave');

    expect(read?.status).toBe('failed');
    expect(read?.intent).toEqual({ steps });
  });
}
