import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Setting a cadence.
 *
 * This route had no test. It is the only way a journey starts running on a
 * timer, and it guarded that with half the check the run route uses: it
 * refused a journey with no target URL and accepted one with no steps — which
 * the run route refuses. A journey in that state, set to Daily, is a booked
 * recurring failure: one consumed run-budget slot and one "started a scheduled
 * run" in the client's activity feed per tick, for as long as the schedule
 * stands, with nothing ever audited.
 *
 * So these assert the refusal *codes*, not just refusal. Which of the two
 * things is missing is the whole difference between the two fixes.
 */

const { principalFromRequest } = vi.hoisted(() => ({ principalFromRequest: vi.fn() }));
vi.mock('../../src/app/api/_lib/principal', () => ({ principalFromRequest }));

const OPERATOR = {
  kind: 'operator' as const,
  id: 'op-1',
  name: 'Alex Reed',
  email: 'alex@example.com',
};

const { PATCH } = await import(
  '../../src/app/api/platform/clients/[clientId]/journeys/[journeyId]/route'
);
const { MemoryPlatformStore, setPlatformStore } = await import(
  '../../src/integrations/persistence'
);

const { MAX_STEPS_PER_JOURNEY } = await import('../../src/domain/journey-step');

const RUNNABLE_STEPS = [{ action: 'navigate', type: 'goto', path: '/' }];

let platform: InstanceType<typeof MemoryPlatformStore>;

function patchBody(journeyId: string, body: Record<string, unknown>) {
  principalFromRequest.mockResolvedValue(OPERATOR);

  return PATCH(
    new Request(`http://localhost/api/platform/clients/acme/journeys/${journeyId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ clientId: 'acme', journeyId }) },
  );
}

function patch(journeyId: string, schedule: 'off' | 'daily' | 'weekly') {
  return patchBody(journeyId, { schedule });
}

async function seed(
  id: string,
  journey: { targetUrl?: string; environment?: string; steps: unknown[] },
) {
  await platform.upsertJourney({
    id,
    clientId: 'acme',
    name: id,
    ...(journey.targetUrl ? { targetUrl: journey.targetUrl } : {}),
    ...(journey.environment ? { environment: journey.environment } : {}),
    steps: journey.steps,
  });
}

beforeEach(async () => {
  principalFromRequest.mockReset();
  platform = new MemoryPlatformStore();
  setPlatformStore(platform);
  await platform.upsertClient({ id: 'acme', name: 'Acme' });
});

describe('PATCH /api/platform/clients/[clientId]/journeys/[journeyId]', () => {
  it('schedules a journey that can actually be run', async () => {
    await seed('runnable', { targetUrl: 'https://acme.test/', steps: RUNNABLE_STEPS });

    const response = await patch('runnable', 'daily');

    expect(response.status).toBe(200);
    expect((await platform.getJourney('runnable'))?.schedule).toBe('daily');
  });

  it('refuses to schedule a journey with no steps, naming the steps', async () => {
    await seed('stepless', { targetUrl: 'https://acme.test/', steps: [] });

    const response = await patch('stepless', 'daily');

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe('journey_has_no_steps');
    // The refusal has to have stopped the write, not just answered 422.
    expect((await platform.getJourney('stepless'))?.schedule).toBe('off');
  });

  it('refuses to schedule a journey with no target URL, naming the target', async () => {
    await seed('targetless', { steps: RUNNABLE_STEPS });

    const response = await patch('targetless', 'weekly');

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe('journey_not_runnable');
  });

  /**
   * Shape is not validity, and the gap between them was a booked failure.
   *
   * `journeyRunRefusal` can only ask whether `steps` is a non-empty array —
   * the step contract lives in the run handler, not the domain. The write
   * schema accepts `z.record(z.string(), z.unknown())`, so `[{banana: 1}]`
   * stores fine, clears the refusal, and used to be schedulable. The tick then
   * claimed it, POSTed to /api/audit/run, and got a 400 at body parse: once a
   * window, forever, with nothing audited and nothing said.
   */
  it('refuses to schedule a journey whose steps are the right shape but not steps', async () => {
    await seed('nonsense', { targetUrl: 'https://acme.test/', steps: [{ banana: 1 }] });

    const response = await patch('nonsense', 'daily');

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe('invalid_journey_steps');
    expect((await platform.getJourney('nonsense'))?.schedule).toBe('off');
  });

  /**
   * Turning one *off* is always allowed, so the refusal cannot trap a booking.
   *
   * Nothing needs this today: the creation route refuses the same thing the
   * schedule route does, and production holds no journey that is both booked
   * and unrunnable — which is why no screen offers an off switch for one.
   * What it pins is that the route stays non-trapping if such a row ever
   * appears by another road, because the alternative is a state with no way
   * out and this costs one condition.
   */
  it('lets an unrunnable journey be unscheduled', async () => {
    await platform.upsertJourney({
      id: 'already-booked',
      clientId: 'acme',
      name: 'already-booked',
      targetUrl: 'https://acme.test/',
      schedule: 'daily',
      steps: [],
    });

    const response = await patch('already-booked', 'off');

    expect(response.status).toBe(200);
    expect((await platform.getJourney('already-booked'))?.schedule).toBe('off');
  });

  /**
   * Steps are editable now, against the stance this route was written with.
   *
   * "Recorded once and re-walked" held while a journey was inert. Selectors go
   * stale, and an uneditable journey means a dead one plus a duplicate called
   * `acme-login-2` — with a re-audit quietly comparing against what
   * `getLatestRun` treats as a different journey.
   */
  it('rewrites the steps a journey walks', async () => {
    await seed('editable', { targetUrl: 'https://acme.test/', steps: RUNNABLE_STEPS });

    const response = await patchBody('editable', {
      steps: [
        { action: 'navigate', type: 'goto', path: '/login' },
        { action: 'inspect', type: 'expect', urlIncludes: '/dashboard' },
      ],
    });

    expect(response.status).toBe(200);
    expect((await platform.getJourney('editable'))?.steps).toHaveLength(2);
  });

  it('holds new steps to the same rules creation does', async () => {
    await seed('editable', { targetUrl: 'https://acme.test/', steps: RUNNABLE_STEPS });

    // The literal-password shape, refused at creation since #43. An edit route
    // that did not refuse it would be a second way in to the same column.
    const response = await patchBody('editable', {
      steps: [{ action: 'login', type: 'fill', selector: '#p', value: 'hunter2' }],
    });

    expect(response.status).toBe(400);
    expect((await platform.getJourney('editable'))?.steps).toEqual(RUNNABLE_STEPS);
  });

  it('refuses an edit that would leave a scheduled journey unrunnable', async () => {
    // The state the patch *leaves behind*, not the one it found. Checking the
    // stored steps would let this land on a journey that is already Daily and
    // book a recurring failure.
    await seed('booked', { targetUrl: 'https://acme.test/', steps: RUNNABLE_STEPS });
    expect((await patch('booked', 'daily')).status).toBe(200);

    const response = await patchBody('booked', { steps: [] });

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe('journey_has_no_steps');
    expect((await platform.getJourney('booked'))?.steps).toEqual(RUNNABLE_STEPS);
  });

  it('lets steps and cadence change in one patch', async () => {
    await seed('both', { targetUrl: 'https://acme.test/', steps: [] });

    // Unrunnable until this patch gives it steps — so the guard has to judge
    // the result, or a legitimate fix-and-schedule is refused.
    const response = await patchBody('both', { schedule: 'weekly', steps: RUNNABLE_STEPS });

    expect(response.status).toBe(200);
    const stored = await platform.getJourney('both');
    expect(stored?.schedule).toBe('weekly');
    expect(stored?.steps).toHaveLength(1);
  });

  /**
   * A partial update must not blank what it did not mention.
   *
   * `upsertJourney` overwrites the whole row, and this route omitted
   * `scheduleHour` whenever the body did — so any schedule change silently
   * moved a custom hour back to the store's default. It was latent while
   * cadence was the only editable field; a steps-only patch would have reset
   * the hour of a journey it never mentioned.
   */
  it('keeps a custom schedule hour a patch says nothing about', async () => {
    await seed('houred', { targetUrl: 'https://acme.test/', steps: RUNNABLE_STEPS });
    expect((await patchBody('houred', { schedule: 'daily', scheduleHour: 9 })).status).toBe(200);

    await patchBody('houred', { steps: RUNNABLE_STEPS });

    expect((await platform.getJourney('houred'))?.scheduleHour).toBe(9);
  });

  /**
   * Same defect class as the hour above, and a worse consequence.
   *
   * `upsertJourney` overwrites the whole row, so anything a patch does not
   * carry across is erased. Drop the allowed hosts and the journey keeps
   * running — right up until its next redirect to the identity provider, at
   * which point it fails naming a host the operator can see in their own list.
   */
  it('keeps the allowed hosts a patch says nothing about', async () => {
    await seed('sso', { targetUrl: 'https://acme.test/', steps: RUNNABLE_STEPS });
    expect((await patchBody('sso', { allowedHosts: ['acme.okta.com'] })).status).toBe(200);

    await patchBody('sso', { steps: RUNNABLE_STEPS });

    expect((await platform.getJourney('sso'))?.allowedHosts).toEqual(['acme.okta.com']);
  });

  it('lets the allowed hosts be cleared, which unset cannot express', async () => {
    // An empty array is the only way back. Unset means unchanged everywhere on
    // this route, so without this the list would be one-way — the gap left
    // open for `scheduleHour` and worth not repeating.
    await seed('sso-clear', { targetUrl: 'https://acme.test/', steps: RUNNABLE_STEPS });
    await patchBody('sso-clear', { allowedHosts: ['acme.okta.com'] });

    await patchBody('sso-clear', { allowedHosts: [] });

    expect((await platform.getJourney('sso-clear'))?.allowedHosts).toEqual([]);
  });

  it('holds an allowed host to the same rules creation does', async () => {
    await seed('sso-bad', { targetUrl: 'https://acme.test/', steps: RUNNABLE_STEPS });

    const response = await patchBody('sso-bad', { allowedHosts: ['*.okta.com'] });

    expect(response.status).toBe(400);
    expect((await platform.getJourney('sso-bad'))?.allowedHosts).toBeUndefined();
  });

  /**
   * Promoting a journey can break the steps it already has.
   *
   * Production forbids `submit-safe`, so moving a working staging journey
   * there turns its first submission into a mid-walk abort — against a
   * client's live site, at step N, with steps 1..N-1 already performed. The
   * pair is judged before it is stored.
   */
  it('refuses an environment change its existing steps could not survive', async () => {
    await seed('promote', {
      targetUrl: 'https://acme.test/',
      environment: 'staging',
      steps: [{ action: 'submit-safe', type: 'click', selector: '#pay' }],
    });

    const response = await patchBody('promote', { environment: 'production' });

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe('action_not_allowed_here');
    expect((await platform.getJourney('promote'))?.environment).toBe('staging');
  });

  it('refuses steps the stored environment could not survive', async () => {
    // The other half of the same pair. Checking new steps against nothing, or
    // a new environment against nothing, each misses a patch that changes only
    // the other one.
    await seed('prod', { targetUrl: 'https://acme.test/', steps: RUNNABLE_STEPS });

    const response = await patchBody('prod', {
      steps: [{ action: 'submit-safe', type: 'click', selector: '#pay' }],
    });

    expect(response.status).toBe(422);
  });

  it('accepts the same steps once the journey is moved somewhere that allows them', async () => {
    await seed('move', { targetUrl: 'https://acme.test/', steps: RUNNABLE_STEPS });

    const response = await patchBody('move', {
      environment: 'staging',
      steps: [{ action: 'submit-safe', type: 'click', selector: '#pay' }],
    });

    expect(response.status, await response.clone().text()).toBe(200);
    expect((await platform.getJourney('move'))?.environment).toBe('staging');
  });

  it('keeps the environment a patch says nothing about', async () => {
    // `upsertJourney` overwrites the whole row, and this field decides what a
    // step is allowed to do — dropping it silently promotes a staging journey
    // to production, where its own steps are then refused.
    await seed('keep-env', {
      targetUrl: 'https://acme.test/',
      environment: 'staging',
      steps: RUNNABLE_STEPS,
    });

    await patchBody('keep-env', { steps: RUNNABLE_STEPS });

    expect((await platform.getJourney('keep-env'))?.environment).toBe('staging');
  });

  it('keeps midnight, which is a real hour and a falsy number', async () => {
    // `??`, not `||`. Hour 0 is midnight UTC and perfectly valid; `||` would
    // treat it as unset and move the run to the store's default.
    await seed('midnight', { targetUrl: 'https://acme.test/', steps: RUNNABLE_STEPS });
    await patchBody('midnight', { schedule: 'daily', scheduleHour: 0 });

    await patchBody('midnight', { steps: RUNNABLE_STEPS });

    expect((await platform.getJourney('midnight'))?.scheduleHour).toBe(0);
  });

  it('keeps the schedule a steps-only patch says nothing about', async () => {
    await seed('kept', { targetUrl: 'https://acme.test/', steps: RUNNABLE_STEPS });
    await patch('kept', 'daily');

    await patchBody('kept', { steps: RUNNABLE_STEPS });

    expect((await platform.getJourney('kept'))?.schedule).toBe('daily');
  });

  /**
   * The cap the subset proof did not cover.
   *
   * `authoredStepSchema ⊂ journeyStepSchema` is proven per *step*. It said
   * nothing about list length, and the two caps disagreed — 200 for a stored
   * journey against 50 at `/api/audit/run` — so a journey of 51 valid steps
   * was storable, schedulable, and then undispatchable: the tick claims it,
   * POSTs, takes a 400 at body parse, and repeats every window forever. Which
   * is the exact failure the schedule guard exists to prevent.
   */
  it('refuses more steps than a run could ever dispatch', async () => {
    await seed('toolong', { targetUrl: 'https://acme.test/', steps: RUNNABLE_STEPS });

    const response = await patchBody('toolong', {
      steps: Array.from({ length: MAX_STEPS_PER_JOURNEY + 1 }, () => RUNNABLE_STEPS[0]),
    });

    expect(response.status).toBe(400);
    expect((await platform.getJourney('toolong'))?.steps).toEqual(RUNNABLE_STEPS);
  });

  it('accepts exactly as many as a run will take', async () => {
    await seed('atcap', { targetUrl: 'https://acme.test/', steps: RUNNABLE_STEPS });

    const response = await patchBody('atcap', {
      steps: Array.from({ length: MAX_STEPS_PER_JOURNEY }, () => RUNNABLE_STEPS[0]),
    });

    expect(response.status).toBe(200);
  });

  it('answers an inline credential with the sentence that fixes it', async () => {
    // The create route already does. An edit path answering `invalid_request_body`
    // to the identical mistake is a worse answer to the same question.
    await seed('cred', { targetUrl: 'https://acme.test/', steps: RUNNABLE_STEPS });

    const response = await patchBody('cred', {
      steps: [{ action: 'login', type: 'fill', selector: '#p', password: 'hunter2' }],
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('inline_credential');
  });

  it('refuses a patch that changes nothing', async () => {
    // An empty body used to be a schema error only because `schedule` was
    // required. Now every field is optional, so "change something" has to be
    // said outright.
    await seed('empty', { targetUrl: 'https://acme.test/', steps: RUNNABLE_STEPS });

    expect((await patchBody('empty', {})).status).toBe(400);
  });

  it('records what actually changed', async () => {
    // A feed saying "set a schedule" for an edit that rewrote the steps is how
    // an audit trail stops being one.
    await seed('logged', { targetUrl: 'https://acme.test/', steps: RUNNABLE_STEPS });

    await patchBody('logged', { steps: RUNNABLE_STEPS });

    const [event] = await platform.listEvents({ clientId: 'acme' });
    expect(event?.action).toBe('rewrote a journey');
    // The count, never the steps: a step can carry a literal and this row is
    // rendered on the client screen.
    expect(JSON.stringify(event?.metadata)).not.toContain('goto');
  });
});
