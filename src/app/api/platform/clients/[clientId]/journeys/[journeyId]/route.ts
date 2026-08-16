import { z } from 'zod';
import { actorFields } from '../../../../../../../domain/operator';
import { journeyRunRefusal } from '../../../../../../../domain/platform';
import { getPlatformStore } from '../../../../../../../integrations/persistence';
import { journeyStepSchema } from '../../../../../_lib/audit-run-handler';
import { authorizePrincipal } from '../../../../../_lib/authorize';
import { createRequestId } from '../../../../../_lib/request-id';

/**
 * Change how often a journey re-runs.
 *
 * Separate from the collection route because it edits one journey rather than
 * creating one, and because cadence is the only field the screens can change:
 * a journey's steps and target are recorded once and re-walked, so an edit
 * form for them would be a second way to author the thing the console already
 * authors.
 */

const patchSchema = z.object({
  schedule: z.enum(['off', 'daily', 'weekly']),
  /** UTC. Unset means the store's default of 03:00. */
  scheduleHour: z.number().int().min(0).max(23).optional(),
});

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

  let parsed: z.infer<typeof patchSchema>;
  try {
    parsed = patchSchema.parse(await request.json());
  } catch {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }

  // A journey that cannot be run cannot be scheduled either: booking one is
  // booking a recurring failure, one wasted run-budget slot and one "started a
  // scheduled run" in the client's activity feed per tick, forever. This
  // refused only the missing-target half while the run route refused both,
  // which is how a stepless journey could still be set to Daily.
  //
  // Turning one *off* stays allowed, so this route can never trap a schedule
  // it cannot satisfy. Nothing needs that today — the creation route refuses
  // the same thing, and production holds no journey that is both booked and
  // unrunnable — but a refusal that also blocks the undo is a state with no
  // way out, and one condition is a cheap price for not designing one in.
  if (parsed.schedule !== 'off') {
    const refusal = journeyRunRefusal(journey);
    if (refusal) {
      return Response.json({ error: refusal, requestId }, { status: 422 });
    }

    // `journeyRunRefusal` answers "an array with something in it", which is as
    // much as the domain can know — the step contract lives in the run
    // handler. Without this, steps that are the right *shape* and not valid
    // steps (`[{banana: 1}]`, which the write schema accepts) booked a cadence
    // the tick could never dispatch: it claims the journey, POSTs to
    // /api/audit/run, and gets a 400 at body parse, once a window, forever.
    // The run route already refuses that with this code.
    if (!z.array(journeyStepSchema).safeParse(journey.steps).success) {
      return Response.json({ error: 'invalid_journey_steps', requestId }, { status: 422 });
    }
  }

  await platform.upsertJourney({
    id: journey.id,
    clientId: journey.clientId,
    name: journey.name,
    ...(journey.targetUrl ? { targetUrl: journey.targetUrl } : {}),
    ...(journey.environment ? { environment: journey.environment } : {}),
    schedule: parsed.schedule,
    ...(parsed.scheduleHour === undefined ? {} : { scheduleHour: parsed.scheduleHour }),
    steps: journey.steps,
  });

  await platform.recordEvent({
    clientId,
    ...actorFields(principal),
    action: parsed.schedule === 'off' ? 'turned off a schedule' : 'set a schedule',
    subject: journey.name,
    metadata: { schedule: parsed.schedule },
  });

  return Response.json({ requestId, journeyId, schedule: parsed.schedule }, { status: 200 });
}
