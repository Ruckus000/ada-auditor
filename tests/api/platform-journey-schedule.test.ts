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

const RUNNABLE_STEPS = [{ action: 'navigate', type: 'goto', path: '/' }];

let platform: InstanceType<typeof MemoryPlatformStore>;

function patch(journeyId: string, schedule: 'off' | 'daily' | 'weekly') {
  principalFromRequest.mockResolvedValue(OPERATOR);

  return PATCH(
    new Request(`http://localhost/api/platform/clients/acme/journeys/${journeyId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ schedule }),
    }),
    { params: Promise.resolve({ clientId: 'acme', journeyId }) },
  );
}

async function seed(id: string, journey: { targetUrl?: string; steps: unknown[] }) {
  await platform.upsertJourney({
    id,
    clientId: 'acme',
    name: id,
    ...(journey.targetUrl ? { targetUrl: journey.targetUrl } : {}),
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
});
