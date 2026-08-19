import { beforeEach, describe, expect, it } from 'vitest';
import { buildPortfolio, clientIdFromName } from '../../src/services/portfolio';
import { MemoryPlatformStore } from '../../src/integrations/persistence/memory-platform-store';
import { MemoryRunStore } from '../../src/integrations/persistence/memory-run-store';
import type { StoredFinding, StoredRunRecord } from '../../src/domain/persistence';

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

async function seedClient(id: string, name: string, owner?: string) {
  await platform.upsertClient({ id, name, ...(owner ? { owner } : {}) });
}

describe('buildPortfolio', () => {
  it('is empty when no client has been added', async () => {
    // The product decision: operators add clients, nothing is seeded. The
    // empty portfolio is the normal first screen, not an error state.
    expect(await buildPortfolio(deps())).toEqual([]);
  });

  it('leaves out the placeholder that anchors unowned journeys', async () => {
    // A run posted straight to /api/audit/run materialises its journey under
    // `client-unassigned` so the foreign key holds. That is plumbing, not a
    // client somebody added, and it was appearing on the portfolio as a row
    // with its own verdict on a deployment where nobody had added anything.
    await platform.upsertClient({ id: 'client-unassigned', name: 'Unassigned' });
    await platform.upsertJourney({
      id: 'stray',
      clientId: 'client-unassigned',
      name: 'stray',
      steps: [],
    });
    await runs.saveRun(run({ requestId: 'r1', journeyId: 'stray' }));

    expect(await buildPortfolio(deps())).toEqual([]);
  });

  it('lists a client that has never been audited', async () => {
    // Adding a client and running an audit are separate acts. A client with no
    // run yet is a normal state, not a broken row.
    await seedClient('acme', 'Acme Outfitters', 'Alex Reed');

    expect(await buildPortfolio(deps())).toEqual([
      {
        id: 'acme',
        name: 'Acme Outfitters',
        owner: 'Alex Reed',
        journeyCount: 0,
        lastRun: null,
        setupIncomplete: true,
      },
    ]);
  });

  it("summarises the newest run across all of a client's journeys", async () => {
    await seedClient('acme', 'Acme');
    await platform.upsertJourney({ id: 'j1', clientId: 'acme', name: 'Checkout', steps: [] });
    await platform.upsertJourney({ id: 'j2', clientId: 'acme', name: 'Login', steps: [] });

    await runs.saveRun(run({ requestId: 'old', journeyId: 'j1', createdAt: '2026-08-01T00:00:00.000Z' }));
    await runs.saveRun(
      run({
        requestId: 'new',
        journeyId: 'j2',
        createdAt: '2026-08-09T00:00:00.000Z',
        ciStatus: 'fail',
        score: 72,
        pages: [
          { url: 'https://a/1', route: '/1', title: 'One', evidenceStatus: 'complete' },
          { url: 'https://a/2', route: '/2', title: 'Two', evidenceStatus: 'complete' },
        ],
        findings: [finding(), finding({ severity: 'major' }), finding({ severity: 'minor' })],
      }),
    );

    const [row] = await buildPortfolio(deps());

    expect(row.journeyCount).toBe(2);
    expect(row.lastRun).toMatchObject({
      requestId: 'new',
      verdict: 'fail',
      score: 72,
      mustFix: 1,
      shouldFix: 1,
      pagesAudited: 2,
    });
  });

  it('reports an unscored run as null rather than zero', async () => {
    // Zero is a real score — the worst one. "We could not measure this" has to
    // stay distinguishable from "this measured terribly".
    await seedClient('acme', 'Acme');
    await platform.upsertJourney({ id: 'j1', clientId: 'acme', name: 'Checkout', steps: [] });
    await runs.saveRun(
      run({ requestId: 'r1', evidenceStatus: 'degraded', ciStatus: 'inconclusive' }),
    );

    const [row] = await buildPortfolio(deps());

    expect(row.lastRun?.score).toBeNull();
    expect(row.lastRun?.verdict).toBe('inconclusive');
  });

  it('shows a run still in flight as scanning', async () => {
    // Yesterday's verdict beside a running audit reads as current. It is not.
    //
    // The timestamp has to be *now*, not the fixture's fixed date: a run left
    // `running` past the staleness threshold is reconciled to failed on read,
    // which is a different (and also correct) answer. This test is about a run
    // that is genuinely still going.
    await seedClient('acme', 'Acme');
    await platform.upsertJourney({ id: 'j1', clientId: 'acme', name: 'Checkout', steps: [] });
    const startedAt = new Date().toISOString();
    await runs.saveRun(
      run({
        requestId: 'r1',
        status: 'running',
        ciStatus: 'inconclusive',
        createdAt: startedAt,
        startedAt,
      }),
    );

    expect((await buildPortfolio(deps()))[0].lastRun?.verdict).toBe('scan');
  });

  // The other half of the same rule: a run nothing ever finished must stop
  // claiming to be in progress, or the screen shows a scan that has apparently
  // been going since Tuesday.
  it('shows a run abandoned mid-flight as inconclusive, not scanning', async () => {
    await seedClient('acme', 'Acme');
    await platform.upsertJourney({ id: 'j1', clientId: 'acme', name: 'Checkout', steps: [] });
    const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await runs.saveRun(
      run({
        requestId: 'r1',
        status: 'running',
        ciStatus: 'inconclusive',
        createdAt: longAgo,
        startedAt: longAgo,
      }),
    );

    expect((await buildPortfolio(deps()))[0].lastRun?.verdict).toBe('inconclusive');
  });

  it('counts only deterministic findings toward the fix counts', async () => {
    // Advisory findings are `gateable: false`. Counting them in a column an
    // operator triages from would contradict that.
    await seedClient('acme', 'Acme');
    await platform.upsertJourney({ id: 'j1', clientId: 'acme', name: 'Checkout', steps: [] });
    await runs.saveRun(
      run({
        requestId: 'r1',
        findings: [
          finding(),
          { code: 'ai-advisory', severity: 'advisory', source: 'ai-advisory' },
        ],
      }),
    );

    expect((await buildPortfolio(deps()))[0].lastRun?.mustFix).toBe(1);
  });

  it("does not attribute one client's runs to another", async () => {
    await seedClient('acme', 'Acme');
    await seedClient('other', 'Other');
    await platform.upsertJourney({ id: 'j1', clientId: 'acme', name: 'Checkout', steps: [] });
    await runs.saveRun(run({ requestId: 'r1' }));

    const rows = await buildPortfolio(deps());
    const other = rows.find((row) => row.id === 'other');

    expect(other?.lastRun).toBeNull();
    expect(other?.journeyCount).toBe(0);
  });

  it('ignores an archived journey', async () => {
    await seedClient('acme', 'Acme');
    await platform.upsertJourney({ id: 'j1', clientId: 'acme', name: 'Retired', steps: [] });
    await platform.archiveJourney('j1');

    expect((await buildPortfolio(deps()))[0].journeyCount).toBe(0);
  });
});

/**
 * True until the first completed run — what the portfolio's "Finish setup"
 * hint reads. A journey that has only ever failed has not finished setup
 * either; the flag has to look past the newest attempt.
 */
describe('buildPortfolio, on setupIncomplete', () => {
  it('marks a client with no completed run as setup incomplete', async () => {
    await seedClient('pf-fresh-client', 'Fresh Client');
    await platform.upsertJourney({
      id: 'pf-fresh-j',
      clientId: 'pf-fresh-client',
      name: 'Checkout',
      steps: [],
    });
    await runs.saveRun(run({ requestId: 'pf-fresh-r', journeyId: 'pf-fresh-j', status: 'failed' }));

    const rows = await buildPortfolio(deps());
    const fresh = rows.find((row) => row.id === 'pf-fresh-client');

    expect(fresh?.setupIncomplete).toBe(true);
  });

  it('marks a client with a completed run as setup complete', async () => {
    await seedClient('pf-done-client', 'Done Client');
    await platform.upsertJourney({
      id: 'pf-done-j',
      clientId: 'pf-done-client',
      name: 'Checkout',
      steps: [],
    });
    await runs.saveRun(run({ requestId: 'pf-done-r', journeyId: 'pf-done-j', status: 'complete' }));

    const rows = await buildPortfolio(deps());
    const done = rows.find((row) => row.id === 'pf-done-client');

    expect(done?.setupIncomplete).toBe(false);
  });
});

describe('clientIdFromName', () => {
  it.each([
    ['Acme Outfitters', 'acme-outfitters'],
    ['Northwind Health', 'northwind-health'],
    ['  Halcyon & Co.  ', 'halcyon-co'],
  ])('turns %j into %j', (name, id) => {
    expect(clientIdFromName(name)).toBe(id);
  });

  it('suffixes a collision rather than merging two clients', async () => {
    // The id is the URL. Two clients sharing one would silently show one
    // client's findings under the other's name.
    expect(clientIdFromName('Acme', ['acme'])).toBe('acme-2');
    expect(clientIdFromName('Acme', ['acme', 'acme-2'])).toBe('acme-3');
  });

  it('falls back rather than producing an empty id', () => {
    expect(clientIdFromName('***')).toBe('client');
    expect(clientIdFromName('***', ['client'])).toBe('client-2');
  });
});
