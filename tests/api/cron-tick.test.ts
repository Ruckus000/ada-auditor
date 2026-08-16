import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { GET } = await import('../../src/app/api/cron/tick/route');
const {
  MemoryPlatformStore,
  MemoryRunStore,
  resetPlatformStore,
  resetRunStore,
  setPlatformStore,
  setRunStore,
} = await import('../../src/integrations/persistence');

const CRON_SECRET = 'cron-secret-long-enough-16';
const RUN_TOKEN = 'run-token-long-enough-1234';

const original = {
  cron: process.env.CRON_SECRET,
  token: process.env.AUDITOR_RUN_TOKEN,
  self: process.env.AUDITOR_SELF_URL,
  limit: process.env.CRON_MAX_STARTS_PER_TICK,
};

let platform: InstanceType<typeof MemoryPlatformStore>;
let fetchMock: ReturnType<typeof vi.fn>;

function tick(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/cron/tick', { headers });
}

/**
 * A journey due right now: scheduled for this UTC hour, never claimed.
 *
 * The steps are not decoration. This seeded `steps: []` — a journey the run
 * route refuses — and every test here still passed, because the claim query
 * filtered on `target_url` alone. That is the bug those two facts add up to:
 * the tick was dispatching journeys that could not run, once per window,
 * forever. A due journey now looks like one that could actually be walked.
 */
async function seedDueJourney(id: string, name = id) {
  await platform.upsertJourney({
    id,
    clientId: 'acme',
    name,
    targetUrl: `https://${id}.test/`,
    schedule: 'daily',
    scheduleHour: new Date().getUTCHours(),
    steps: [{ action: 'navigate', type: 'goto', path: '/' }],
  });
}

describe('GET /api/cron/tick', () => {
  beforeEach(async () => {
    platform = new MemoryPlatformStore();
    setPlatformStore(platform);
    setRunStore(new MemoryRunStore());
    await platform.upsertClient({ id: 'acme', name: 'Acme' });

    process.env.CRON_SECRET = CRON_SECRET;
    process.env.AUDITOR_RUN_TOKEN = RUN_TOKEN;
    process.env.AUDITOR_SELF_URL = 'https://auditor.test';

    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ requestId: 'req-dispatched' }), { status: 202 }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetPlatformStore();
    resetRunStore();
    for (const [key, value] of [
      ['CRON_SECRET', original.cron],
      ['AUDITOR_RUN_TOKEN', original.token],
      ['AUDITOR_SELF_URL', original.self],
      ['CRON_MAX_STARTS_PER_TICK', original.limit],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  // An unauthenticated scheduler that starts browser runs against customer
  // sites is worse than one that does not run at all.
  it('refuses a caller with no credential', async () => {
    const response = await GET(tick());

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses the wrong secret', async () => {
    const response = await GET(tick({ authorization: 'Bearer not-the-cron-secret' }));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never answers 200 when nothing is configured to authenticate against', async () => {
    delete process.env.CRON_SECRET;
    delete process.env.AUDITOR_RUN_TOKEN;

    const response = await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('cron_secret_not_configured');
  });

  it('accepts the cron secret Vercel sends', async () => {
    await seedDueJourney('checkout');

    const response = await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(response.status).toBe(200);
    expect((await response.json()).started).toHaveLength(1);
  });

  // So an operator can prove a new schedule works without waiting an hour.
  it('also accepts the run token, for a manual tick', async () => {
    await seedDueJourney('checkout');

    const response = await GET(tick({ authorization: `Bearer ${RUN_TOKEN}` }));

    expect(response.status).toBe(200);
  });

  it('dispatches each due journey to the run endpoint with the machine token', async () => {
    await seedDueJourney('checkout');

    await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://auditor.test/api/audit/run');
    expect((init as RequestInit).headers).toMatchObject({
      authorization: `Bearer ${RUN_TOKEN}`,
    });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      journeyId: 'checkout',
      targetUrl: 'https://checkout.test/',
    });
  });

  // Claim-and-stamp in one operation, so a second tick in the same window
  // finds nothing left to do.
  it('is idempotent within a window', async () => {
    await seedDueJourney('checkout');

    await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }));
    const second = await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }));

    expect((await second.json()).claimed).toBe(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('leaves unscheduled journeys alone', async () => {
    await platform.upsertJourney({
      id: 'manual',
      clientId: 'acme',
      name: 'Manual',
      targetUrl: 'https://manual.test/',
      schedule: 'off',
      steps: [],
    });

    const response = await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }));

    expect((await response.json()).claimed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honours the per-tick cap and says when it truncates', async () => {
    process.env.CRON_MAX_STARTS_PER_TICK = '2';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seedDueJourney('one');
    await seedDueJourney('two');
    await seedDueJourney('three');

    const response = await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }));

    expect((await response.json()).claimed).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // A silent cap reads as "everything due has run".
    const types = warn.mock.calls.map((call) => JSON.parse(call[0] as string).type);
    expect(types).toContain('scheduled_runs_deferred');
    warn.mockRestore();
  });

  it('records the scheduler as the actor, not a person', async () => {
    await seedDueJourney('checkout');

    await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }));

    const [event] = await platform.listEvents({ clientId: 'acme' });
    expect(event).toMatchObject({ actor: 'Scheduler', action: 'started a scheduled run' });
    expect(event).not.toHaveProperty('actorOperatorId');
  });

  it('reports a dispatch that failed rather than counting it as started', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    await seedDueJourney('checkout');

    const body = await (await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }))).json();

    expect(body.started).toHaveLength(0);
    expect(body.failed).toEqual(['checkout']);
  });

  /**
   * A failed dispatch must not consume the journey's turn.
   *
   * The claim stamps `lastScheduledAt` before anything is sent, so without a
   * release a run that never started looked exactly like one that did — the
   * journey was stamped as done by a dispatch that never landed. For a
   * scheduler whose only job is that a site gets re-audited, that is the
   * failure that matters.
   */
  it('gives the journey back when the dispatch fails, so a tick in the same window can pick it up', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    await seedDueJourney('checkout');

    await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }));

    // Claimable again immediately. Not on the next hourly tick — the claim
    // query gates on `schedule_hour` — but by any tick inside this window,
    // including the manual one the deploy checklist runs.
    expect((await platform.claimDueJourneys(10)).map((journey) => journey.id)).toEqual([
      'checkout',
    ]);
  });

  it('gives the journey back when the dispatch throws', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));
    await seedDueJourney('checkout');

    const body = await (await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }))).json();

    expect(body.failed).toEqual(['checkout']);
    expect((await platform.claimDueJourneys(10)).map((journey) => journey.id)).toEqual([
      'checkout',
    ]);
  });

  // The token is attached to whatever this posts to, so the destination can
  // never come from a request header.
  it('refuses to dispatch when it cannot determine its own URL', async () => {
    delete process.env.AUDITOR_SELF_URL;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seedDueJourney('checkout');

    const response = await GET(
      tick({ authorization: `Bearer ${CRON_SECRET}`, host: 'evil.example' }),
    );

    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();

    // And it claimed nothing on the way out. Resolving the URL after claiming
    // meant every due journey was stamped by a tick that could not dispatch
    // one of them — marked done without ever having run.
    expect((await platform.claimDueJourneys(10)).map((journey) => journey.id)).toEqual([
      'checkout',
    ]);
    warn.mockRestore();
  });

  it('reconciles abandoned runs even when nothing is due', async () => {
    const runs = new MemoryRunStore();
    setRunStore(runs);
    const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await runs.saveRun({
      requestId: 'stuck',
      journeyId: 'checkout',
      environment: 'production',
      platform: 'generic',
      evidenceStatus: 'unknown',
      ciStatus: 'inconclusive',
      findings: [],
      durationMs: 0,
      createdAt: longAgo,
      startedAt: longAgo,
      status: 'running',
    });

    const body = await (await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }))).json();

    expect(body.reconciled).toBe(1);
  });
});
