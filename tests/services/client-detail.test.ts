import { beforeEach, describe, expect, it } from 'vitest';
import type { StoredFinding, StoredRunRecord } from '../../src/domain/persistence';
import { MemoryPlatformStore } from '../../src/integrations/persistence/memory-platform-store';
import { MemoryRunStore } from '../../src/integrations/persistence/memory-run-store';
import { buildClientDetail } from '../../src/services/client-detail';

let platform: MemoryPlatformStore;
let runs: MemoryRunStore;

beforeEach(() => {
  platform = new MemoryPlatformStore();
  runs = new MemoryRunStore();
});

function deps() {
  return { clients: platform, journeys: platform, runs };
}

function finding(overrides: Partial<StoredFinding> = {}): StoredFinding {
  return { code: 'image-alt', severity: 'critical', source: 'deterministic', ...overrides };
}

function run(overrides: Partial<StoredRunRecord> & Pick<StoredRunRecord, 'requestId'>) {
  return {
    journeyId: 'j1',
    environment: 'staging' as const,
    platform: 'generic',
    evidenceStatus: 'complete',
    ciStatus: 'pass',
    findings: [],
    durationMs: 10,
    createdAt: '2026-08-10T10:00:00.000Z',
    status: 'complete' as const,
    ...overrides,
  };
}

describe('buildClientDetail', () => {
  it('returns null for a client that does not exist', async () => {
    // The route answers 404 from this. The fixture code it replaces fell back
    // to the first client, which showed one client's findings under another
    // client's address.
    expect(await buildClientDetail('nobody', deps())).toBeNull();
  });

  it('describes a client with no journeys yet', async () => {
    // Adding a client and recording a journey are separate acts, so this is a
    // normal state and the page has to render it rather than treat it as empty.
    await platform.upsertClient({ id: 'acme', name: 'Acme', owner: 'Alex Reed' });

    const detail = await buildClientDetail('acme', deps());

    expect(detail).toMatchObject({ id: 'acme', name: 'Acme', owner: 'Alex Reed', lastRun: null });
    expect(detail?.journeys).toEqual([]);
  });

  it('summarises each journey and the newest run across them', async () => {
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
    await platform.upsertJourney({
      id: 'j1',
      clientId: 'acme',
      name: 'Checkout',
      targetUrl: 'https://acme.test/cart',
      steps: [{ action: 'goto' }, { action: 'click' }],
    });
    await platform.upsertJourney({ id: 'j2', clientId: 'acme', name: 'Login', steps: [] });

    await runs.saveRun(run({ requestId: 'old', journeyId: 'j1', createdAt: '2026-08-01T00:00:00.000Z' }));
    await runs.saveRun(
      run({
        requestId: 'new',
        journeyId: 'j2',
        createdAt: '2026-08-09T00:00:00.000Z',
        ciStatus: 'fail',
        score: 72,
        findings: [finding(), finding({ severity: 'major' })],
        pages: [{ url: 'https://a/1', route: '/1', title: 'One', evidenceStatus: 'complete' }],
      }),
    );

    const detail = await buildClientDetail('acme', deps());

    const checkout = detail?.journeys.find((journey) => journey.id === 'j1');
    expect(checkout).toMatchObject({
      name: 'Checkout',
      targetUrl: 'https://acme.test/cart',
    });
    // The steps themselves now, not a count of them: the screen shows what the
    // journey does, and a count is `steps.length`.
    expect(checkout?.steps).toHaveLength(2);
    expect(checkout?.lastRun?.requestId).toBe('old');

    expect(detail?.lastRun).toMatchObject({
      requestId: 'new',
      verdict: 'fail',
      score: 72,
      mustFix: 1,
      shouldFix: 1,
      pagesAudited: 1,
    });
  });

  it('reports an unscored run as null rather than zero', async () => {
    // Zero is the worst real score. "We could not measure this" has to stay
    // distinguishable from "this measured terribly".
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
    await platform.upsertJourney({ id: 'j1', clientId: 'acme', name: 'Checkout', steps: [] });
    await runs.saveRun(run({ requestId: 'r1', evidenceStatus: 'degraded', ciStatus: 'inconclusive' }));

    expect(detailRun(await buildClientDetail('acme', deps()))?.score).toBeNull();
    expect(detailRun(await buildClientDetail('acme', deps()))?.verdict).toBe('inconclusive');
  });

  it('counts only deterministic findings toward the fix counts', async () => {
    // Advisory findings are `gateable: false`. Counting them in a column an
    // operator triages from would contradict that.
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
    await platform.upsertJourney({ id: 'j1', clientId: 'acme', name: 'Checkout', steps: [] });
    await runs.saveRun(
      run({
        requestId: 'r1',
        findings: [finding(), { code: 'ai', severity: 'advisory', source: 'ai-advisory' }],
      }),
    );

    expect(detailRun(await buildClientDetail('acme', deps()))?.mustFix).toBe(1);
  });

  it("does not show another client's journeys", async () => {
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
    await platform.upsertClient({ id: 'other', name: 'Other' });
    await platform.upsertJourney({ id: 'j1', clientId: 'other', name: 'Theirs', steps: [] });

    expect((await buildClientDetail('acme', deps()))?.journeys).toEqual([]);
  });

  it('ignores an archived journey', async () => {
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
    await platform.upsertJourney({ id: 'j1', clientId: 'acme', name: 'Retired', steps: [] });
    await platform.archiveJourney('j1');

    expect((await buildClientDetail('acme', deps()))?.journeys).toEqual([]);
  });

  /**
   * `steps` is jsonb that predates any validation, so a row can hold something
   * that is not an array at all — the Postgres claim query carries a guard for
   * exactly that value. Here it reached the screen: `.length` on an object is
   * `undefined`, and `client-journeys.tsx` renders it straight into the words
   * "undefined steps" beside the journey's name.
   */
  it('says a malformed steps column has no steps rather than putting "undefined" on screen', async () => {
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
    await platform.upsertJourney({
      id: 'j1',
      clientId: 'acme',
      name: 'Malformed',
      targetUrl: 'https://acme.test/',
      steps: { banana: 1 } as unknown as unknown[],
    });

    const [journey] = (await buildClientDetail('acme', deps()))?.journeys ?? [];

    // `toStepViews` carries the guard the old `stepCount` did — a jsonb column
    // can hold something that is not an array, and `undefined` must not reach
    // the screen as "undefined steps".
    expect(journey?.steps).toEqual([]);
    expect(journey?.runRefusal).toBe('journey_has_no_steps');
  });
});

function detailRun(detail: Awaited<ReturnType<typeof buildClientDetail>>) {
  return detail?.lastRun;
}

describe('buildClientDetail, for a journey whose last run failed', () => {
  /**
   * `failureReason` has been stored since failures were first classified and
   * read by nothing, so every failure rendered as `? INCONCLUSIVE` with no
   * explanation. A stale selector, a browser crash and a journey walked out of
   * scope looked identical on the screen, and each needs a different person to
   * do a different thing.
   */
  it('carries the reason through so a screen can say it', async () => {
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
    await platform.upsertJourney({
      id: 'j1',
      clientId: 'acme',
      name: 'Checkout',
      targetUrl: 'https://acme.test/',
      steps: [{ action: 'navigate', type: 'goto', path: '/' }],
    });
    await runs.saveRun(
      run({
        requestId: 'failed-run',
        journeyId: 'j1',
        status: 'failed',
        failureReason: 'journey_step_failed',
        ciStatus: 'inconclusive',
      }),
    );

    const [journey] = (await buildClientDetail('acme', deps()))?.journeys ?? [];

    expect(journey?.lastRun?.failureReason).toBe('journey_step_failed');
  });

  it('does not carry one on a run that finished', async () => {
    // A reason on a completed run would be a leftover from an earlier attempt
    // at the same request id, and the screen would report a failure that was
    // subsequently fixed.
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
    await platform.upsertJourney({
      id: 'j1',
      clientId: 'acme',
      name: 'Checkout',
      targetUrl: 'https://acme.test/',
      steps: [{ action: 'navigate', type: 'goto', path: '/' }],
    });
    await runs.saveRun(
      run({ requestId: 'ok-run', journeyId: 'j1', failureReason: 'journey_step_failed' }),
    );

    const [journey] = (await buildClientDetail('acme', deps()))?.journeys ?? [];

    expect(journey?.lastRun?.failureReason).toBeUndefined();
  });
});

/**
 * The credentials a journey names, carried through to the screen.
 *
 * `credentialsForSteps` has its own tests; this is the other half, and the
 * half three separate guards in this repo have shipped without. A rule with no
 * caller is green forever.
 */
describe('buildClientDetail, on credentials', () => {
  it('reports which of a journey’s credentials are configured', async () => {
    const previous = process.env.AUDIT_CREDENTIAL_ACME_USER;
    process.env.AUDIT_CREDENTIAL_ACME_USER = 'auditor@acme.test';

    try {
      await platform.upsertClient({ id: 'acme', name: 'Acme' });
      await platform.upsertJourney({
        id: 'j1',
        clientId: 'acme',
        name: 'Login',
        targetUrl: 'https://acme.test/',
        steps: [
          { action: 'login', type: 'fill', selector: '#u', credentialRef: 'acme', field: 'user' },
        ],
      });

      const detail = await buildClientDetail('acme', deps());

      // The username is set in the environment above; the password is not, and
      // half-configured is the state an operator most needs told.
      expect(detail?.journeys[0].credentials).toEqual([
        { ref: 'acme', user: true, pass: false },
      ]);
    } finally {
      if (previous === undefined) delete process.env.AUDIT_CREDENTIAL_ACME_USER;
      else process.env.AUDIT_CREDENTIAL_ACME_USER = previous;
    }
  });

  it('says nothing for a journey that names none', async () => {
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
    await platform.upsertJourney({
      id: 'j1',
      clientId: 'acme',
      name: 'Plain',
      steps: [{ action: 'navigate', type: 'goto', path: '/' }],
    });

    expect((await buildClientDetail('acme', deps()))?.journeys[0].credentials).toEqual([]);
  });
});

/**
 * Whether this client has ever finished a run — what the setup screens key
 * their terminal stage on. A per-journey newest-run check cannot answer this:
 * a failed retry sits on top of an old success and must not un-onboard a
 * client who already cleared setup once.
 */
describe('buildClientDetail, on hasCompletedRun', () => {
  it('reports whether any journey ever completed a run', async () => {
    await platform.upsertClient({ id: 'cd-hcr-client', name: 'Has Completed Run' });
    await platform.upsertJourney({
      id: 'cd-hcr-j',
      clientId: 'cd-hcr-client',
      name: 'Checkout',
      steps: [],
    });

    // One journey whose newest run failed but an older one completed.
    await runs.saveRun(
      run({
        requestId: 'cd-hcr-old',
        journeyId: 'cd-hcr-j',
        status: 'complete',
        createdAt: '2026-08-01T00:00:00.000Z',
      }),
    );
    await runs.saveRun(
      run({
        requestId: 'cd-hcr-new',
        journeyId: 'cd-hcr-j',
        status: 'failed',
        createdAt: '2026-08-02T00:00:00.000Z',
      }),
    );

    const detail = await buildClientDetail('cd-hcr-client', deps());

    expect(detail?.hasCompletedRun).toBe(true);
  });

  it('a failed-only history is not a completed run', async () => {
    await platform.upsertClient({ id: 'cd-hcr2-client', name: 'No Completed Run' });
    await platform.upsertJourney({
      id: 'cd-hcr2-j',
      clientId: 'cd-hcr2-client',
      name: 'Checkout',
      steps: [],
    });

    await runs.saveRun(run({ requestId: 'cd-hcr-f', journeyId: 'cd-hcr2-j', status: 'failed' }));

    const detail = await buildClientDetail('cd-hcr2-client', deps());

    expect(detail?.hasCompletedRun).toBe(false);
  });
});
