import { z } from 'zod';
import { actorFields } from '../../../../../../../domain/operator';
import { journeyRunRefusal } from '../../../../../../../domain/platform';
import { getPlatformStore } from '../../../../../../../integrations/persistence';
import { allowedHostsSchema } from '../../../../../../../domain/allowed-hosts';
import { authoredStepsSchema, journeyStepSchema } from '../../../../../../../domain/journey-step';
import { containsInlineCredential } from '../../../../../_lib/inline-credential';
import { authorizePrincipal } from '../../../../../_lib/authorize';
import { createRequestId } from '../../../../../_lib/request-id';

/**
 * Correct a journey: its cadence, its steps, or both.
 *
 * Cadence used to be the only field the screens could change, on the reasoning
 * that "a journey's steps and target are recorded once and re-walked". That
 * held while a journey was inert. It stopped holding once selectors started
 * going stale: an uneditable journey means a dead one plus a duplicate called
 * `acme-login-2`, and a re-audit then quietly compares against what
 * `getLatestRun` treats as a different journey.
 *
 * Editing is safe because of Phase 1, not because of anything here.
 * `walkedTheSamePath` compares each run's *own* recorded `intent.steps`, so a
 * run from before an edit and one from after are `incomparable` and the
 * regression diff is withheld — a page that vanished from an edited walk
 * cannot read as *fixed*. That is why this needs no version stamp.
 *
 * What an edit cannot do, checked rather than assumed: repoint the journey at
 * somebody else's site. `targetUrl` is not accepted here, and a `goto` path is
 * resolved with `new URL(path, target)` — so an absolute or protocol-relative
 * path really does produce an off-origin URL. The runner refuses it:
 * `allowedHosts` defaults to the target's own hostname and `assertSafeTargetUrl`
 * throws `UnsafeTargetError` before navigating. Verified against both, because
 * "an operator can now rewrite where a browser goes" is the first thing worth
 * worrying about here.
 *
 * Every field is optional and at least one is required. A partial update must
 * not silently blank what it did not mention: `upsertJourney` is a full-row
 * overwrite, so anything omitted here has to be carried across from the stored
 * row explicitly.
 */

const patchSchema = z
  .object({
    schedule: z.enum(['off', 'daily', 'weekly']).optional(),
    /** UTC. Unset now means *unchanged*, not "back to the store's default". */
    scheduleHour: z.number().int().min(0).max(23).optional(),
    steps: authoredStepsSchema.optional(),
    /**
     * Unset means unchanged, as everywhere else here. An empty array is how a
     * list is cleared — the two have to be different, or a patch that only
     * renames a cadence would silently drop the provider a journey needs.
     */
    allowedHosts: allowedHostsSchema.optional(),
  })
  .refine(
    (body) =>
      body.schedule !== undefined ||
      body.scheduleHour !== undefined ||
      body.steps !== undefined ||
      body.allowedHosts !== undefined,
    { message: 'A patch must change something.' },
  );

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ clientId: string; journeyId: string }> },
) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId, journeyId } = await params;
  const platform = getPlatformStore();

  const journey = await platform.getJourney(journeyId);
  // Same ownership check as running one: naming another client's journey here
  // would let anyone schedule audits against a site under the wrong customer.
  if (!journey || journey.clientId !== clientId || journey.archivedAt) {
    return Response.json({ error: 'journey_not_found', requestId }, { status: 404 });
  }

  const body: unknown = await request.json().catch(() => null);

  // Same check, same order, same answer as the create route. `.strict()`
  // refuses a `password` key either way, but as `invalid_request_body` — and
  // the create route's comment argues why that is not good enough: "you put a
  // credential in a step, use credentialRef" is the one sentence that fixes
  // it. An edit path that answered less usefully than the create path would be
  // a worse answer to the identical mistake.
  if (containsInlineCredential(body)) {
    return Response.json({ error: 'inline_credential', requestId }, { status: 400 });
  }

  let parsed: z.infer<typeof patchSchema>;
  try {
    parsed = patchSchema.parse(body);
  } catch {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }

  // The state this patch would *leave behind*, not the state it found.
  //
  // Both halves matter now that steps are editable. Checking the stored steps
  // would let an edit to `[]` land on a journey that is already Daily, and
  // checking the stored schedule would let a steps edit slip past the guard on
  // a journey that was scheduled last week.
  const schedule = parsed.schedule ?? journey.schedule ?? 'off';
  const steps = parsed.steps ?? journey.steps;

  // A journey that cannot be run cannot be scheduled either: booking one is
  // booking a recurring failure, one wasted run-budget slot and one "started a
  // scheduled run" in the client's activity feed per tick, forever.
  //
  // Turning one *off* stays allowed, so this route can never trap a schedule
  // it cannot satisfy — a refusal that also blocks the undo is a state with no
  // way out. That mattered less when only cadence could change; now that an
  // edit can make a scheduled journey unrunnable, the escape has to be real.
  if (schedule !== 'off') {
    const refusal = journeyRunRefusal({
      ...(journey.targetUrl ? { targetUrl: journey.targetUrl } : {}),
      steps,
    });
    if (refusal) {
      return Response.json({ error: refusal, requestId }, { status: 422 });
    }

    // `journeyRunRefusal` answers "an array with something in it", which is as
    // much as the domain can know. Without this, steps that are the right
    // *shape* and not valid steps booked a cadence the tick could never
    // dispatch: it claims the journey, POSTs to /api/audit/run, and gets a 400
    // at body parse, once a window, forever.
    //
    // Incoming steps cannot fail this, and the reason is narrower than it
    // looks: the subset proof is *per step*. It said nothing about list
    // length, and the two caps disagreed — 200 here against 50 at
    // `/api/audit/run` — so a journey of 51 valid steps was storable,
    // schedulable, and then undispatchable forever. One `MAX_STEPS_PER_JOURNEY`
    // now, which is what makes this sentence true.
    //
    // What still needs the check is the *stored* steps of a journey being
    // rescheduled without an edit. Those cannot be un-written.
    if (!z.array(journeyStepSchema).safeParse(steps).success) {
      return Response.json({ error: 'invalid_journey_steps', requestId }, { status: 422 });
    }
  }

  // Every field carried across explicitly, because `upsertJourney` overwrites
  // the whole row. Omitting `scheduleHour` used to reset a custom hour to the
  // store's default on any schedule change — a patch that never mentioned the
  // hour silently moved the run. `??` against the stored value is what makes
  // "unset" mean unchanged.
  const scheduleHour = parsed.scheduleHour ?? journey.scheduleHour;
  const allowedHosts = parsed.allowedHosts ?? journey.allowedHosts;

  await platform.upsertJourney({
    id: journey.id,
    clientId: journey.clientId,
    name: journey.name,
    ...(journey.targetUrl ? { targetUrl: journey.targetUrl } : {}),
    ...(journey.environment ? { environment: journey.environment } : {}),
    schedule,
    ...(scheduleHour === undefined ? {} : { scheduleHour }),
    ...(allowedHosts === undefined ? {} : { allowedHosts }),
    steps,
  });

  // Named by what actually changed. A feed saying "set a schedule" for an edit
  // that only rewrote the steps is how an audit trail stops being one.
  //
  // Ordered by consequence, and the allowed hosts come first for a reason
  // beyond novelty: it is the only field here that changes *where a browser
  // may be sent*. An entry added to that list and recorded in the feed as "set
  // a schedule" is the one change an audit trail exists to make findable.
  await platform.recordEvent({
    clientId,
    ...actorFields(principal),
    action: parsed.allowedHosts
      ? 'changed where a journey may go'
      : parsed.steps
        ? 'rewrote a journey'
        : schedule === 'off'
          ? 'turned off a schedule'
          : 'set a schedule',
    subject: journey.name,
    metadata: {
      schedule,
      // The count, never the steps: a step can carry a literal, and an
      // activity row is rendered on the client screen.
      ...(parsed.steps ? { stepCount: parsed.steps.length } : {}),
      // The hosts themselves, unlike the steps. A hostname an operator chose
      // is not a secret, and "which hosts" is the entire question somebody
      // reads this row to answer.
      ...(parsed.allowedHosts ? { allowedHosts: parsed.allowedHosts } : {}),
    },
  });

  return Response.json({ requestId, journeyId, schedule }, { status: 200 });
}
