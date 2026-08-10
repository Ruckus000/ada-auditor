import { z } from 'zod';
import { actorFields } from '../../../../../../../domain/operator';
import { getPlatformStore } from '../../../../../../../integrations/persistence';
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

  // A journey with no target cannot be run, so scheduling one would book a
  // recurring failure. The run route refuses it for the same reason.
  if (parsed.schedule !== 'off' && !journey.targetUrl) {
    return Response.json({ error: 'journey_not_runnable', requestId }, { status: 422 });
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
