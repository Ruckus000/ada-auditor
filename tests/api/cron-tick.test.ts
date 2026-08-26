import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEDULED_RUN_NOT_STARTED } from '../../src/domain/platform';

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

  /**
   * The dispatch has to carry everything the run needs, and this field is the
   * newest way to get that wrong.
   *
   * A journey that signs in through a provider would otherwise run correctly
   * by hand — the platform route reads the stored list directly — and fail on
   * the timer, once a window, forever. That is word for word the failure the
   * shared step cap was created to close, and it took a production schedule to
   * find last time.
   */
  it('carries a journey’s allowed hosts into the dispatch', async () => {
    await platform.upsertJourney({
      id: 'sso',
      clientId: 'acme',
      name: 'SSO',
      targetUrl: 'https://sso.test/',
      allowedHosts: ['acme.okta.com'],
      schedule: 'daily',
      scheduleHour: new Date().getUTCHours(),
      steps: [{ action: 'navigate', type: 'goto', path: '/' }],
    });

    await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }));

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string).allowedHosts).toEqual([
      'acme.okta.com',
    ]);
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

  /**
   * The other half of the scheduler's record.
   *
   * The tick wrote an event when a dispatch landed and nothing at all when one
   * did not, so a client's scheduled audit could fail to happen with no run
   * row, no event, and nothing on the journey. There is deliberately still no
   * run row — see `SCHEDULED_RUN_NOT_STARTED` — but there is now a record.
   */
  describe('when a due journey does not start', () => {
    /** As the run route answers: a JSON body with a code in `error`. */
    function refusal(status: number, body: unknown): Response {
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }

    /** Silenced, and kept, because two of these cases assert on what it wrote. */
    const silenceWarnings = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
    let warn: ReturnType<typeof silenceWarnings>;

    beforeEach(() => {
      warn = silenceWarnings();
    });

    afterEach(() => {
      warn.mockRestore();
    });

    it('records an event carrying the journey, the status and the refusal code', async () => {
      fetchMock.mockResolvedValue(refusal(429, { error: 'run_budget_exceeded' }));
      await seedDueJourney('checkout', 'Checkout');

      await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }));

      const [event] = await platform.listEvents({ clientId: 'acme' });
      expect(event).toMatchObject({
        actor: 'Scheduler',
        action: SCHEDULED_RUN_NOT_STARTED,
        subject: 'Checkout',
      });
      expect(event.metadata).toEqual({
        journeyId: 'checkout',
        status: 429,
        code: 'run_budget_exceeded',
      });

      const types = warn.mock.calls.map((call) => JSON.parse(call[0] as string).type);
      expect(types).toContain('scheduled_run_not_started');
    });

    // Absent, not null: a throw means no response arrived, and a null `status`
    // would claim one did and said nothing.
    it('omits the status entirely when the dispatch threw', async () => {
      fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));
      await seedDueJourney('checkout');

      await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }));

      const [event] = await platform.listEvents({ clientId: 'acme' });
      expect(event.metadata).toEqual({ journeyId: 'checkout', code: 'dispatch_error' });
      expect(event.metadata).not.toHaveProperty('status');
    });

    it('says the response was unreadable rather than storing what it said', async () => {
      fetchMock.mockResolvedValue(
        new Response('<html><body>502 Bad Gateway</body></html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
      );
      await seedDueJourney('checkout');

      await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }));

      const [event] = await platform.listEvents({ clientId: 'acme' });
      expect(event.metadata).toMatchObject({ code: 'unreadable_response', status: 502 });
      expect(JSON.stringify(event.metadata)).not.toContain('<html>');
    });

    /**
     * The credential and log-injection guard, which is the reason the code is
     * validated at all rather than merely typed.
     *
     * The logger redacts on the key, and nothing about `error` looks secret —
     * so a hostile value arriving under an innocent key is exactly the case
     * key-based redaction cannot help with. The newline is the second half: an
     * unchecked "code" reaching a log line every consumer greps can forge a
     * second line there.
     */
    it('never stores or logs a credential or a forged log line from the response body', async () => {
      const hostile = 'Bearer sk-live-0123456789abcdef\nAUTHORIZATION';
      fetchMock.mockResolvedValue(refusal(400, { error: hostile }));
      await seedDueJourney('checkout');

      await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }));

      const [event] = await platform.listEvents({ clientId: 'acme' });
      expect(event.metadata).toMatchObject({ code: 'unreadable_response' });
      expect(JSON.stringify(event.metadata)).not.toContain('sk-live');

      const lines = warn.mock.calls.map((call) => String(call[0]));
      expect(lines.every((line) => !line.includes('sk-live'))).toBe(true);
    });

    // The event is a record, not a substitute for the release: the journey has
    // still not run, so a tick inside the same window must be able to retry it.
    it('still gives the journey back after recording that it did not start', async () => {
      fetchMock.mockResolvedValue(refusal(429, { error: 'run_budget_exceeded' }));
      await seedDueJourney('checkout');

      await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }));

      expect((await platform.claimDueJourneys(10)).map((journey) => journey.id)).toEqual([
        'checkout',
      ]);
    });

    // The record is best-effort, the same stance `releaseClaim` takes. Losing
    // the journeys that did start to a store hiccup would be worse.
    it('survives a store that cannot write the event', async () => {
      fetchMock.mockResolvedValue(refusal(429, { error: 'run_budget_exceeded' }));
      vi.spyOn(platform, 'recordEvent').mockRejectedValue(new Error('store is down'));
      await seedDueJourney('checkout');

      const response = await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }));

      expect(response.status).toBe(200);
      expect((await response.json()).failed).toEqual(['checkout']);
    });
  });

  /**
   * The success-path `recordEvent` used to sit inside the `try` whose `catch`
   * pushes to `failed` and releases the claim. A store hiccup *after* a
   * dispatch that landed therefore marked a started run as failed and released
   * the claim on a run that was in flight — so a second tick in the window
   * could dispatch it again.
   */
  it('counts a successful dispatch as started even when the event write fails', async () => {
    vi.spyOn(platform, 'recordEvent').mockRejectedValue(new Error('store is down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await seedDueJourney('checkout');

    const body = await (await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }))).json();

    expect(body.started).toEqual(['req-dispatched']);
    expect(body.failed).toEqual([]);
    // And the claim stands: the run is in flight, so a second tick in this
    // window must not dispatch it a second time.
    expect(await platform.claimDueJourneys(10)).toEqual([]);
    warn.mockRestore();
  });

  it('writes exactly one event on the success path', async () => {
    await seedDueJourney('checkout');

    await GET(tick({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(await platform.listEvents({ clientId: 'acme' })).toHaveLength(1);
  });
});
