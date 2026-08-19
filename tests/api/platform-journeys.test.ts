import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The routes resolve a principal now rather than asking "is there a
// session?". Mocking that seam keeps these tests about the routes; the
// cookie/token machinery has its own suite in tests/api/principal.test.ts.
const { principalFromRequest } = vi.hoisted(() => ({ principalFromRequest: vi.fn() }));
vi.mock('../../src/app/api/_lib/principal', () => ({ principalFromRequest }));

const OPERATOR = { kind: 'operator' as const, id: 'op-1', name: 'Alex Reed', email: 'alex@example.com' };

const { GET, POST } = await import(
  '../../src/app/api/platform/clients/[clientId]/journeys/route'
);
const { MAX_STEPS_PER_JOURNEY, authoredStepsSchema } = await import('../../src/domain/journey-step');
const { journeyDraft } = await import(
  '../../src/app/platform/components/setup/where-screen'
);

const { MemoryPlatformStore, resetPlatformStore, setPlatformStore } = await import(
  '../../src/integrations/persistence'
);

const TOKEN = 'test-token-16chars';

function params(clientId: string) {
  return { params: Promise.resolve({ clientId }) };
}

function request(body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/platform/clients/acme/journeys', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Same-origin plus a session: how the screens call it. */
function fromBrowser(body?: unknown): Request {
  principalFromRequest.mockResolvedValue(OPERATOR);
  return request(body, { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' });
}

let platform: InstanceType<typeof MemoryPlatformStore>;

describe('/api/platform/clients/[clientId]/journeys', () => {
  const originalToken = process.env.AUDITOR_RUN_TOKEN;

  beforeEach(async () => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;
    principalFromRequest.mockReset();
    principalFromRequest.mockResolvedValue(null);
    platform = new MemoryPlatformStore();
    setPlatformStore(platform);
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.AUDITOR_RUN_TOKEN;
    else process.env.AUDITOR_RUN_TOKEN = originalToken;
    resetPlatformStore();
  });

  it('refuses an unauthenticated request', async () => {
    expect((await GET(request(), params('acme'))).status).toBe(401);
    expect((await POST(request({ name: 'Checkout' }), params('acme'))).status).toBe(401);
  });

  it('refuses a cookie carried cross-origin', async () => {
    // A session cookie travels on cross-site posts too. Without this, any page
    // could write journeys into the operator's account.
    principalFromRequest.mockResolvedValue(OPERATOR);
    const response = await POST(
      request({ name: 'Checkout' }, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }),
      params('acme'),
    );

    expect(response.status).toBe(401);
    expect(await platform.listJourneys('acme')).toEqual([]);
  });

  it('refuses a client that does not exist', async () => {
    // Otherwise a typo silently creates a journey nobody owns, which is the
    // `client-unassigned` hole this route exists to close.
    expect((await POST(fromBrowser({ name: 'Checkout' }), params('nobody'))).status).toBe(404);
    expect((await GET(fromBrowser(), params('nobody'))).status).toBe(404);
  });

  it('records a journey against the client that owns it', async () => {
    const response = await POST(
      fromBrowser({ name: 'Checkout', targetUrl: 'https://acme.test/cart' }),
      params('acme'),
    );

    expect(response.status).toBe(201);
    expect((await response.json()).journey.id).toBe('acme-checkout');

    const [stored] = await platform.listJourneys('acme');
    expect(stored).toMatchObject({
      id: 'acme-checkout',
      clientId: 'acme',
      name: 'Checkout',
      targetUrl: 'https://acme.test/cart',
    });
  });

  /**
   * Pins the wizard's own marquee flow — a pasted homepage becoming a
   * runnable journey — against this route's actual schema, rather than
   * against a hand-written body that could quietly drift from what
   * `WhereScreen` really sends. `journeyDraft` is the same function the
   * screen's submit handler calls.
   */
  it("accepts the wizard's homepage fast-path body, unchanged", async () => {
    const draft = journeyDraft('homepage', new URL('https://acme.example/shop?x=1'), 'production');

    const response = await POST(fromBrowser(draft), params('acme'));
    expect(response.status, await response.clone().text()).toBe(201);

    const [stored] = await platform.listJourneys('acme');
    // Parses under the schema the runner itself is bound by, not just under
    // whatever shape happened to be written — the whole point of routing
    // this through `journeyDraft` rather than a literal body.
    expect(() => authoredStepsSchema.parse(stored.steps)).not.toThrow();

    const listed = await (await GET(fromBrowser(), params('acme'))).json();
    const journey = listed.journeys.find((one: { id: string }) => one.id === stored.id);
    expect(journey.steps[0]).toMatchObject({ action: 'navigate', type: 'goto', path: '/shop?x=1' });
  });

  it('records the hosts a journey may pass through, normalised', async () => {
    const response = await POST(
      fromBrowser({
        name: 'SSO',
        targetUrl: 'https://acme.test/',
        allowedHosts: ['ACME.Okta.com.'],
      }),
      params('acme'),
    );

    expect(response.status).toBe(201);
    // What is stored is what the matcher compares. A row that matches only
    // because the comparison lowercases both sides is a coincidence.
    const [stored] = await platform.listJourneys('acme');
    expect(stored.allowedHosts).toEqual(['acme.okta.com']);
  });

  it('refuses a public suffix, so one entry cannot allow the internet', async () => {
    // The list is matched host-or-subdomain, so `co.uk` is every British
    // company. The operator meant `acme.co.uk`.
    const response = await POST(
      fromBrowser({ name: 'SSO', targetUrl: 'https://acme.test/', allowedHosts: ['co.uk'] }),
      params('acme'),
    );

    expect(response.status).toBe(400);
    expect(await platform.listJourneys('acme')).toHaveLength(0);
  });

  it('scopes the id to the client', async () => {
    // Two clients may both have a journey called Checkout, and they are not
    // the same journey. The id is global — runs reference it — so an unscoped
    // slug would attach one client's runs to the other's screen.
    await platform.upsertClient({ id: 'other', name: 'Other' });
    await POST(fromBrowser({ name: 'Checkout' }), params('acme'));
    await POST(fromBrowser({ name: 'Checkout' }), params('other'));

    expect((await platform.listJourneys('acme'))[0].id).toBe('acme-checkout');
    expect((await platform.listJourneys('other'))[0].id).toBe('other-checkout');
  });

  it('suffixes a repeated name rather than overwriting the first journey', async () => {
    await POST(fromBrowser({ name: 'Checkout' }), params('acme'));
    const second = await POST(fromBrowser({ name: 'Checkout' }), params('acme'));

    expect((await second.json()).journey.id).toBe('acme-checkout-2');
    expect(await platform.listJourneys('acme')).toHaveLength(2);
  });

  /**
   * An archived id is retired, not vacant.
   *
   * `upsertJourney`'s on-conflict update preserves `archived_at`, so minting
   * a new journey against the same id that an archived row already holds
   * would not create a second journey — it would resurrect the archived one,
   * born archived: a 201 the operator believes, for a row that is invisible
   * in the catalog and unrunnable from the moment it is "created". This is
   * the wizard's "start over with a different URL" path: archive, then
   * create fresh under the same name.
   */
  it('mints a fresh id rather than resurrecting an archived journey of the same name', async () => {
    const first = await POST(fromBrowser({ name: 'Homepage' }), params('acme'));
    const firstId = (await first.json()).journey.id;
    expect(firstId).toBe('acme-homepage');

    await platform.archiveJourney(firstId);

    const second = await POST(fromBrowser({ name: 'Homepage' }), params('acme'));
    expect(second.status).toBe(201);
    const secondId = (await second.json()).journey.id;

    expect(secondId).not.toBe(firstId);
    // Not just a different id: the new row has to actually be live — present,
    // unarchived, in the client's own list — or the fix is cosmetic.
    const ids = (await platform.listJourneys('acme')).map((j) => j.id);
    expect(ids).toContain(secondId);
  });

  it('refuses a step carrying a credential rather than a reference to one', async () => {
    // A journey is stored whole. A literal here would be a password written
    // into a database column, which is the rule the credential refs exist for.
    const response = await POST(
      fromBrowser({
        name: 'Login',
        steps: [{ action: 'fill', selector: '#pw', password: 'hunter2' }],
      }),
      params('acme'),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('inline_credential');
    expect(await platform.listJourneys('acme')).toEqual([]);
  });

  it('refuses a target URL that embeds a credential', async () => {
    // The runner's SSRF layer (`parseTargetUrl`) refuses userinfo the moment
    // a run launches, so a journey stored with one could never run — the same
    // credential-wearing-an-address problem `inline_credential` already
    // names for steps. Whole-body assertion, not just the error field: a leak
    // that moved to a different key would pass an assertion aimed at `error`.
    const response = await POST(
      fromBrowser({ name: 'Login', targetUrl: 'https://user:hunter2@client.example/' }),
      params('acme'),
    );
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(text).error).toBe('inline_credential');
    expect(text).not.toContain('hunter2');
    expect(await platform.listJourneys('acme')).toEqual([]);
  });

  it('accepts a step that references a credential', async () => {
    const response = await POST(
      fromBrowser({
        name: 'Login',
        steps: [
          {
            action: 'login',
            // Required now, and it always should have been: the runner's
            // schema is a union discriminated on `type`, so a typeless step
            // could never run. This route accepted them anyway, and the
            // journey only found out when somebody tried to schedule it.
            type: 'fill',
            selector: '#pw',
            credentialRef: 'acme',
            field: 'pass',
          },
        ],
      }),
      params('acme'),
    );

    expect(response.status).toBe(201);
    expect((await platform.listJourneys('acme'))[0].steps).toHaveLength(1);
  });

  /**
   * The state this route used to allow, and the reason it mattered.
   *
   * `{banana: 1}` got a 201 and sat in the database looking like a journey.
   * Two routes then refused to schedule or run it — both carry an
   * `invalid_journey_steps` code written for exactly this — so an operator
   * found out weeks later, at the wrong end.
   */
  it.each([
    ['a step of the wrong shape entirely', { banana: 1 }],
    ['a step with no type, which could never run', { action: 'login', selector: '#pw' }],
    ['an action the policy layer cannot classify', { action: 'frobnicate', type: 'goto', path: '/x' }],
    [
      'a login carrying its own password',
      { action: 'login', type: 'fill', selector: '#pw', value: 'hunter2' },
    ],
  ])('refuses %s', async (_label, step) => {
    const response = await POST(
      fromBrowser({ name: 'Login', steps: [step] }),
      params('acme'),
    );

    expect(response.status).toBe(400);
    expect(await platform.listJourneys('acme')).toEqual([]);
  });

  it.each([
    ['no name', {}],
    ['a blank name', { name: '  ' }],
    ['a target that is not a URL', { name: 'Checkout', targetUrl: 'not-a-url' }],
  ])('rejects %s', async (_label, body) => {
    expect((await POST(fromBrowser(body), params('acme'))).status).toBe(400);
    expect(await platform.listJourneys('acme')).toEqual([]);
  });

  it('lists the journeys it recorded', async () => {
    await POST(fromBrowser({ name: 'Checkout' }), params('acme'));

    const body = await (await GET(fromBrowser(), params('acme'))).json();
    expect(body.count).toBe(1);
    expect(body.journeys[0]).toMatchObject({ id: 'acme-checkout', clientId: 'acme' });
  });

  /**
   * The one surface where a stored secret was actually retrievable.
   *
   * The screens say "types a literal value" and never what it is, because a
   * `fill` written before `authoredStepSchema` can hold a real password and a
   * screen is a worse place for one than a database column. This route sat
   * beside them handing the row over whole.
   *
   * Seeded through the store rather than the create route, because the create
   * route refuses this shape now — and refusing new ones does nothing about
   * the rows that already exist, which is the entire point.
   */
  it('never hands back a literal value a step is carrying', async () => {
    await platform.upsertJourney({
      id: 'legacy',
      clientId: 'acme',
      name: 'Legacy',
      steps: [{ action: 'login', type: 'fill', selector: '#p', value: 'hunter2' }],
    });

    const response = await GET(fromBrowser(), params('acme'));
    const text = await response.text();

    // The whole body, not one field of it: a leak that moved to a different
    // key would pass an assertion aimed at `steps`.
    expect(text).not.toContain('hunter2');
    expect(JSON.parse(text).journeys[0].steps[0]).toMatchObject({ hasLiteralValue: true });
  });

  it('publishes only the fields it names', async () => {
    // A response built by spreading the row publishes every column somebody
    // adds later, which is how the literal above got out. `lastScheduledAt` is
    // the scheduler's bookkeeping and stands in here for "not chosen".
    //
    // Runnable and due, both of which are load-bearing: `claimDueJourneys`
    // refuses a journey with no steps or no target, so a convenient stub here
    // would never be claimed, `lastScheduledAt` would never be set, and the
    // assertion below would hold against a route that publishes everything.
    // It did, on the first attempt.
    await platform.upsertJourney({
      id: 'claimed',
      clientId: 'acme',
      name: 'Claimed',
      targetUrl: 'https://acme.test/',
      schedule: 'daily',
      steps: [{ action: 'navigate', type: 'goto', path: '/' }],
    });
    const claimed = await platform.claimDueJourneys(5, new Date(Date.UTC(2026, 0, 1, 3)));
    expect(claimed.map((one) => one.id)).toContain('claimed');

    const body = await (await GET(fromBrowser(), params('acme'))).json();
    const journey = body.journeys.find((one: { id: string }) => one.id === 'claimed');

    expect(journey).toBeDefined();
    expect(journey).not.toHaveProperty('lastScheduledAt');
  });

  it('records the environment a journey runs in', async () => {
    // `production` when unsaid, and that default is why this had to become
    // settable: while every journey was production, `submit-safe` was an
    // action an operator could write and no run could ever walk.
    const response = await POST(
      fromBrowser({
        name: 'Staging Checkout',
        targetUrl: 'https://acme.test/',
        environment: 'staging',
        steps: [{ action: 'submit-safe', type: 'click', selector: '#pay' }],
      }),
      params('acme'),
    );

    expect(response.status, await response.clone().text()).toBe(201);
    const [stored] = await platform.listJourneys('acme');
    expect(stored.environment).toBe('staging');
  });

  it('refuses a step the chosen environment would abort on', async () => {
    // The runner checks each action as it reaches it, so the alternative to
    // refusing here is a journey that clicks its way through a client's live
    // site and *then* stops. Production forbids `submit-safe`.
    const response = await POST(
      fromBrowser({
        name: 'Prod Checkout',
        targetUrl: 'https://acme.test/',
        steps: [{ action: 'submit-safe', type: 'click', selector: '#pay' }],
      }),
      params('acme'),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe('action_not_allowed_here');
    expect(await platform.listJourneys('acme')).toHaveLength(0);
  });

  it('records who recorded it', async () => {
    await POST(fromBrowser({ name: 'Checkout' }), params('acme'));

    const [event] = await platform.listEvents({ clientId: 'acme' });
    expect(event).toMatchObject({ actor: 'Alex Reed', action: 'recorded a journey' });
  });

  /**
   * Creating is scheduling, and this route was the last one deciding
   * runnability on its own.
   *
   * The schedule route refuses to book a journey that cannot run; this one
   * takes a `schedule` too and took it unchecked, so the whole refusal was one
   * POST away from being bypassed. The tick would not have claimed the row —
   * the claim query refuses it as well — but the screens hide the cadence
   * picker for an unrunnable journey, so it would have been stored `daily`
   * where nobody could see it and nobody could clear it.
   */
  it.each([
    ['no steps', { name: 'Checkout', targetUrl: 'https://acme.test/', schedule: 'daily' }, 'journey_has_no_steps'],
    ['no target URL', { name: 'Checkout', steps: [{ action: 'navigate', type: 'goto', path: '/' }], schedule: 'weekly' }, 'journey_not_runnable'],
  ])('refuses to create a journey scheduled with %s', async (_label, body, error) => {
    const response = await POST(fromBrowser(body), params('acme'));

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe(error);
    // Refused, not stored-then-refused.
    expect(await platform.listJourneys('acme')).toEqual([]);
  });

  it('refuses a steps payload too large to be a journey', async () => {
    // Size *and* shape now — the shape check arrived with
    // `authoredStepSchema`, and this comment used to say steps were "validated
    // loosely here on purpose". The size bound survives it as a separate
    // question: a payload this large is not a journey whatever shape it is in,
    // and the row is written permanently and read on every client screen.
    const response = await POST(
      fromBrowser({
        name: 'Huge',
        steps: [{ action: 'navigate', type: 'goto', path: 'x'.repeat(70_000) }],
      }),
      params('acme'),
    );

    expect(response.status).toBe(400);
    expect(await platform.listJourneys('acme')).toEqual([]);
  });

  it('still accepts a journey with a realistic number of real steps', async () => {
    // The bound has to be a bound, not a blanket refusal.
    //
    // This asked for 200, which was this route's own cap and *not* the one
    // `/api/audit/run` enforced — 50. A journey between the two stored fine,
    // scheduled fine, and then failed at body parse once a window forever.
    // One `MAX_STEPS_PER_JOURNEY` now, and this asks for exactly it.
    const steps = Array.from({ length: MAX_STEPS_PER_JOURNEY }, (_, i) => ({
      action: 'navigate',
      type: 'goto',
      path: `/page-${i}`,
    }));

    expect((await POST(fromBrowser({ name: 'Long', steps }), params('acme'))).status).toBe(201);
  });

  it('refuses more steps than a run could ever dispatch', async () => {
    const steps = Array.from({ length: MAX_STEPS_PER_JOURNEY + 1 }, (_, i) => ({
      action: 'navigate',
      type: 'goto',
      path: `/page-${i}`,
    }));

    expect((await POST(fromBrowser({ name: 'Long', steps }), params('acme'))).status).toBe(400);
    expect(await platform.listJourneys('acme')).toEqual([]);
  });

  it('still creates an unrunnable journey when no schedule is asked for', async () => {
    // Recording one before its steps are known is how the API is meant to be
    // used — it is only booking a cadence on it that is a certain failure.
    const response = await POST(
      fromBrowser({ name: 'Checkout', targetUrl: 'https://acme.test/' }),
      params('acme'),
    );

    expect(response.status).toBe(201);
    expect(await platform.listJourneys('acme')).toHaveLength(1);
  });
});
