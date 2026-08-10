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
      stepCount: 2,
    });
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
});

function detailRun(detail: Awaited<ReturnType<typeof buildClientDetail>>) {
  return detail?.lastRun;
}
