import { beforeEach, describe, expect, it } from 'vitest';
import type { StoredFinding, StoredRunRecord } from '../../src/domain/persistence';
import { MemoryPlatformStore } from '../../src/integrations/persistence/memory-platform-store';
import { MemoryRunStore } from '../../src/integrations/persistence/memory-run-store';
import { buildFindingsView } from '../../src/services/findings-view';

let platform: MemoryPlatformStore;
let runs: MemoryRunStore;

beforeEach(async () => {
  platform = new MemoryPlatformStore();
  runs = new MemoryRunStore();
  await platform.upsertClient({ id: 'acme', name: 'Acme' });
  await platform.upsertJourney({ id: 'j1', clientId: 'acme', name: 'Checkout', steps: [] });
});

function deps() {
  return { clients: platform, journeys: platform, triage: platform, runs };
}

function finding(overrides: Partial<StoredFinding> = {}): StoredFinding {
  return {
    code: 'image-alt',
    severity: 'critical',
    source: 'deterministic',
    title: 'Images must have alternate text',
    remediationAnyOf: ['Element does not have an alt attribute'],
    remediationAllOf: [],
    pageUrl: 'https://acme.test/one',
    selector: 'img',
    ...overrides,
  };
}

function run(overrides: Partial<StoredRunRecord> & Pick<StoredRunRecord, 'requestId'>) {
  return {
    journeyId: 'j1',
    environment: 'staging' as const,
    platform: 'generic',
    evidenceStatus: 'complete',
    ciStatus: 'fail',
    findings: [],
    durationMs: 10,
    createdAt: '2026-08-10T10:00:00.000Z',
    status: 'complete' as const,
    pages: [
      { url: 'https://acme.test/one', route: '/one', title: 'One', evidenceStatus: 'complete' },
      { url: 'https://acme.test/two', route: '/two', title: 'Two', evidenceStatus: 'complete' },
    ],
    ...overrides,
  };
}

describe('buildFindingsView', () => {
  it('returns null for a client that does not exist', async () => {
    expect(await buildFindingsView('nobody', deps())).toBeNull();
  });

  it('has no run and no pages before the first audit', async () => {
    const view = await buildFindingsView('acme', deps());

    expect(view).toMatchObject({ run: null, pages: [], advisory: [] });
    expect(view?.counts.must).toBe(0);
  });

  it('groups findings by the page they were found on', async () => {
    // A run is a journey and a journey is several pages. An operator fixes a
    // page, not a run, so the page is the unit the list is built around.
    await runs.saveRun(
      run({
        requestId: 'r1',
        findings: [
          finding(),
          finding({ code: 'label', severity: 'major', selector: 'input' }),
          finding({ code: 'link-name', pageUrl: 'https://acme.test/two', selector: 'a' }),
        ],
      }),
    );

    const view = await buildFindingsView('acme', deps());

    expect(view?.pages.map((page) => page.route)).toEqual(['/one', '/two']);
    expect(view?.pages[0].findings.map((f) => f.code)).toEqual(['image-alt', 'label']);
    expect(view?.pages[1].findings.map((f) => f.code)).toEqual(['link-name']);
  });

  it('lists a page that had nothing wrong with it', async () => {
    // Dropping clean pages would make a partial audit look thorough: four
    // pages walked and one listed reads as one page audited.
    await runs.saveRun(run({ requestId: 'r1', findings: [finding()] }));

    const view = await buildFindingsView('acme', deps());

    expect(view?.pages).toHaveLength(2);
    expect(view?.pages[1].findings).toEqual([]);
  });

  it('carries each page’s evidence status', async () => {
    // A page we could not see is not a page that passed, and the screen cannot
    // say so unless this does.
    await runs.saveRun(
      run({
        requestId: 'r1',
        evidenceStatus: 'degraded',
        pages: [
          { url: 'https://acme.test/one', route: '/one', title: 'One', evidenceStatus: 'degraded' },
        ],
      }),
    );

    expect((await buildFindingsView('acme', deps()))?.pages[0].evidenceStatus).toBe('degraded');
  });

  it('sorts the worst findings to the top of each page', async () => {
    await runs.saveRun(
      run({
        requestId: 'r1',
        findings: [
          finding({ code: 'z-minor', severity: 'minor', selector: '#a' }),
          finding({ code: 'a-critical', severity: 'critical', selector: '#b' }),
          finding({ code: 'm-major', severity: 'major', selector: '#c' }),
        ],
      }),
    );

    const view = await buildFindingsView('acme', deps());
    expect(view?.pages[0].findings.map((f) => f.code)).toEqual([
      'a-critical',
      'm-major',
      'z-minor',
    ]);
  });

  it("carries the rule's own sentence, and copes without one", async () => {
    // The title is quoted from the engine, never authored here. A run stored
    // before the column existed has none, and the screen falls back to the
    // rule code rather than rendering a blank heading.
    await runs.saveRun(
      run({
        requestId: 'r1',
        findings: [finding(), { code: 'label', severity: 'major', source: 'deterministic',
          pageUrl: 'https://acme.test/one', selector: 'input' }],
      }),
    );

    const [titled, untitled] = (await buildFindingsView('acme', deps()))!.pages[0].findings;

    expect(titled.title).toBe('Images must have alternate text');
    expect(untitled.title).toBeUndefined();
  });

  it('carries the fix groups separately, and defaults them for an older run', async () => {
    // Any one entry in the first list clears the finding; the second has to be
    // done in full. A run stored before the columns existed has neither, and
    // the screen falls back to the failure summary rather than showing an
    // empty "how to fix" heading.
    await runs.saveRun(
      run({
        requestId: 'r1',
        findings: [
          finding({
            remediationAnyOf: ['Add an alt attribute'],
            remediationAllOf: ['Remove aria-hidden'],
          }),
          {
            code: 'label',
            severity: 'major',
            source: 'deterministic',
            pageUrl: 'https://acme.test/one',
            selector: 'input',
          },
        ],
      }),
    );

    const [withFix, without] = (await buildFindingsView('acme', deps()))!.pages[0].findings;

    expect(withFix.fixAnyOf).toEqual(['Add an alt attribute']);
    expect(withFix.fixAllOf).toEqual(['Remove aria-hidden']);
    expect(without.fixAnyOf).toEqual([]);
    expect(without.fixAllOf).toEqual([]);
  });

  it('keeps advisory findings out of the pages', async () => {
    // They are produced once over the whole journey and never gate a build.
    // Mixing them in would put an opinion beside a measurement.
    await runs.saveRun(
      run({
        requestId: 'r1',
        findings: [
          finding(),
          { code: 'vague-alt', severity: 'advisory', source: 'ai-advisory', gateable: false },
        ],
      }),
    );

    const view = await buildFindingsView('acme', deps());

    expect(view?.pages.flatMap((page) => page.findings).map((f) => f.code)).toEqual(['image-alt']);
    expect(view?.advisory.map((f) => f.code)).toEqual(['vague-alt']);
    expect(view?.advisory[0].gateable).toBe(false);
  });

  it('shows a dismissed finding as dismissed', async () => {
    // An operator has said this is not a barrier. A later run re-reporting it
    // must not quietly undo that.
    await runs.saveRun(run({ requestId: 'r1', findings: [finding()] }));
    await platform.setTriage({
      clientId: 'acme',
      findingKey: 'deterministic:image-alt:https://acme.test/one:img',
      source: 'deterministic',
      code: 'image-alt',
      state: 'dismissed',
      note: 'Decorative, and hidden from the tree.',
      actor: 'Alex Reed',
    });

    const view = await buildFindingsView('acme', deps());

    expect(view?.pages[0].findings[0]).toMatchObject({
      status: 'Dismissed',
      triage: 'dismissed',
      triageNote: 'Decorative, and hidden from the tree.',
    });
  });

  it('does not read another client’s triage', async () => {
    await platform.upsertClient({ id: 'other', name: 'Other' });
    await runs.saveRun(run({ requestId: 'r1', findings: [finding()] }));
    await platform.setTriage({
      clientId: 'other',
      findingKey: 'deterministic:image-alt:https://acme.test/one:img',
      source: 'deterministic',
      code: 'image-alt',
      state: 'dismissed',
      actor: 'Alex Reed',
    });

    expect((await buildFindingsView('acme', deps()))?.pages[0].findings[0].status).toBe('Open');
  });

  it('reads the newest run across every journey the client owns', async () => {
    await platform.upsertJourney({ id: 'j2', clientId: 'acme', name: 'Login', steps: [] });
    await runs.saveRun(run({ requestId: 'old', createdAt: '2026-08-01T00:00:00.000Z' }));
    await runs.saveRun(
      run({ requestId: 'new', journeyId: 'j2', createdAt: '2026-08-09T00:00:00.000Z' }),
    );

    const view = await buildFindingsView('acme', deps());

    expect(view?.run?.requestId).toBe('new');
    expect(view?.journeyName).toBe('Login');
  });

  it('counts findings by display severity', async () => {
    await runs.saveRun(
      run({
        requestId: 'r1',
        findings: [
          finding(),
          finding({ severity: 'major', selector: '#a' }),
          finding({ severity: 'minor', selector: '#b' }),
          finding({ severity: 'who-knows', selector: '#c' }),
        ],
      }),
    );

    expect((await buildFindingsView('acme', deps()))?.counts).toMatchObject({
      must: 1,
      should: 1,
      nice: 1,
      review: 1,
    });
  });

  it('keeps a finding whose page is not in the run’s page list', async () => {
    // Runs stored before per-page evidence existed. A finding that has lost
    // its page is still a barrier somebody hit.
    await runs.saveRun(
      run({
        requestId: 'r1',
        pages: [],
        findings: [finding({ pageUrl: 'https://acme.test/gone' })],
      }),
    );

    const view = await buildFindingsView('acme', deps());

    expect(view?.pages).toHaveLength(1);
    expect(view?.pages[0].findings[0].code).toBe('image-alt');
  });
});
