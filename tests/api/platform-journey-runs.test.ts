import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditReport } from '../helpers/audit-report';

const { runBrowserAudit } = vi.hoisted(() => ({ runBrowserAudit: vi.fn() }));
vi.mock('../../src/integrations/browser/run-browser-audit', () => ({ runBrowserAudit }));

const { principalFromRequest } = vi.hoisted(() => ({ principalFromRequest: vi.fn() }));
vi.mock('../../src/app/api/_lib/principal', () => ({ principalFromRequest }));

const { POST } = await import(
  '../../src/app/api/platform/clients/[clientId]/journeys/[journeyId]/runs/route'
);
const {
  MemoryPlatformStore,
  MemoryRunStore,
  resetPlatformStore,
  resetRunStore,
  setPlatformStore,
  setRunStore,
} = await import('../../src/integrations/persistence');
const { resetRunCounter } = await import('../../src/app/api/_lib/run-counter');

const OPERATOR = {
  kind: 'operator' as const,
  id: 'op-1',
  name: 'Alex Reed',
  email: 'alex@example.com',
};

let platform: InstanceType<typeof MemoryPlatformStore>;
let runs: InstanceType<typeof MemoryRunStore>;

function params(clientId: string, journeyId: string) {
  return { params: Promise.resolve({ clientId, journeyId }) };
}

/** Same-origin with a session: how the screen calls it. */
function request(clientId = 'acme', journeyId = 'checkout'): Request {
  principalFromRequest.mockResolvedValue(OPERATOR);
  return new Request(
    `http://localhost/api/platform/clients/${clientId}/journeys/${journeyId}/runs`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
        'sec-fetch-site': 'same-origin',
      },
      body: '{}',
    },
  );
}

describe('POST /api/platform/clients/[clientId]/journeys/[journeyId]/runs', () => {
  beforeEach(async () => {
    runBrowserAudit.mockReset();
    runBrowserAudit.mockResolvedValue(auditReport());
    principalFromRequest.mockReset();
    principalFromRequest.mockResolvedValue(OPERATOR);

    platform = new MemoryPlatformStore();
    runs = new MemoryRunStore();
    setPlatformStore(platform);
    setRunStore(runs);

    await platform.upsertClient({ id: 'acme', name: 'Acme' });
    await platform.upsertJourney({
      id: 'checkout',
      clientId: 'acme',
      name: 'Checkout',
      targetUrl: 'https://acme.test/',
      steps: [{ action: 'navigate', type: 'goto', path: '/' }],
    });
  });

  afterEach(() => {
    // The run budget counter is a module singleton; without this it
    // accumulates across tests in this file and eventually refuses one.
    resetRunCounter();
    resetPlatformStore();
    resetRunStore();
  });

  it('starts a run from the stored journey and answers with a poll URL', async () => {
    const response = await POST(request(), params('acme', 'checkout'));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.status).toBe('running');
    expect(body.pollUrl).toBe(`/api/audit/runs/${body.requestId}`);
  });

  // The whole point of the slice: the stored steps and target are what get
  // walked, without anyone typing them again.
  it('walks the journey’s own stored steps and target', async () => {
    await POST(request(), params('acme', 'checkout'));
    // The run finishes in the background; give the microtask queue a turn.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runBrowserAudit).toHaveBeenCalled();
    const input = runBrowserAudit.mock.calls[0][0];
    expect(input.targetUrl).toBe('https://acme.test/');
    expect(input.steps).toEqual([{ action: 'navigate', type: 'goto', path: '/' }]);
    expect(input.journeyId).toBe('checkout');
  });

  it('refuses an unauthenticated caller', async () => {
    const call = request();
    principalFromRequest.mockResolvedValue(null);

    const response = await POST(call, params('acme', 'checkout'));

    expect(response.status).toBe(401);
    expect(runBrowserAudit).not.toHaveBeenCalled();
  });

  // Naming another client's journey under this client's URL would run it and
  // file the activity event against the wrong customer.
  it('refuses a journey that belongs to another client', async () => {
    await platform.upsertClient({ id: 'other', name: 'Other' });
    await platform.upsertJourney({
      id: 'theirs',
      clientId: 'other',
      name: 'Theirs',
      targetUrl: 'https://other.test/',
      steps: [],
    });

    const response = await POST(request('acme', 'theirs'), params('acme', 'theirs'));

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe('journey_not_found');
    expect(runBrowserAudit).not.toHaveBeenCalled();
  });

  it('refuses an archived journey', async () => {
    await platform.archiveJourney('checkout');

    const response = await POST(request(), params('acme', 'checkout'));

    expect(response.status).toBe(404);
    expect(runBrowserAudit).not.toHaveBeenCalled();
  });

  /**
   * The most important refusal here.
   *
   * With no target and no steps the runner falls back to the built-in fixture
   * app, so this would file a green audit of our own demo pages under a real
   * client's name — not an error, an answer, and a plausible-looking one.
   */
  it.each([
    ['nothing at all', []],
    // Steps alone do NOT make a journey runnable: without a target URL the
    // runner resolves every `goto` against the fixture directory, so the steps
    // simply walk our demo pages instead of the client's site.
    ['steps but no target', [{ action: 'navigate', type: 'goto', path: '/' }]],
  ])(
    'refuses a journey with %s, rather than auditing our own fixture app',
    async (_label, steps) => {
      await platform.upsertJourney({
        id: 'empty',
        clientId: 'acme',
        name: 'Empty',
        steps,
      });

      const response = await POST(request('acme', 'empty'), params('acme', 'empty'));

      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe('journey_not_runnable');
      expect(runBrowserAudit).not.toHaveBeenCalled();
    },
  );

  /**
   * The mirror of the refusal above, and the one that was open.
   *
   * A journey naming a client's site with no steps reached the runner with
   * `steps` undefined, and `runBrowserAudit` substituted the built-in fixture
   * login — whose `goto` paths then resolved against the *client's* origin.
   * The run fetched `https://acme.test/login.html` and filed whatever came
   * back under the client's name. Worse than the no-target case, because the
   * origin is real.
   */
  it('refuses a journey that names a site but no steps', async () => {
    await platform.upsertJourney({
      id: 'targeted-but-empty',
      clientId: 'acme',
      name: 'Targeted but empty',
      targetUrl: 'https://acme.test/',
      steps: [],
    });

    const response = await POST(
      request('acme', 'targeted-but-empty'),
      params('acme', 'targeted-but-empty'),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe('journey_has_no_steps');
    expect(runBrowserAudit).not.toHaveBeenCalled();
  });

  // Steps are stored unvalidated on purpose, so a malformed one has to surface
  // as a 422 naming the journey rather than a 500 from inside the browser.
  it('refuses stored steps that do not match the step contract', async () => {
    await platform.upsertJourney({
      id: 'broken',
      clientId: 'acme',
      name: 'Broken',
      targetUrl: 'https://acme.test/',
      steps: [{ action: 'navigate', type: 'teleport' }],
    });

    const response = await POST(request('acme', 'broken'), params('acme', 'broken'));

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe('invalid_journey_steps');
    expect(runBrowserAudit).not.toHaveBeenCalled();
  });

  it('records who started it, against the client', async () => {
    await POST(request(), params('acme', 'checkout'));

    const [event] = await platform.listEvents({ clientId: 'acme' });
    expect(event).toMatchObject({
      actor: 'Alex Reed',
      actorOperatorId: 'op-1',
      action: 'started a run',
      subject: 'Checkout',
    });
  });

  // A journey stored before the environment column existed still has to run,
  // and must get the strictest policy rather than a guess.
  it('defaults a journey with no stored environment to production', async () => {
    await POST(request(), params('acme', 'checkout'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runBrowserAudit.mock.calls[0][0].environment).toBe('production');
  });
});
