import { z } from 'zod';
import { actorFields } from '../../../../../../domain/operator';
import { journeyRunRefusal } from '../../../../../../domain/platform';
import { getPlatformStore } from '../../../../../../integrations/persistence';
import { clientIdFromName } from '../../../../../../services/portfolio';
import { authorizePrincipal } from '../../../../_lib/authorize';
import { createRequestId } from '../../../../_lib/request-id';


export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId } = await params;
  const platform = getPlatformStore();

  if (!(await platform.getClient(clientId))) {
    return Response.json({ error: 'client_not_found', requestId }, { status: 404 });
  }

  const journeys = await platform.listJourneys(clientId);

  return Response.json({ requestId, journeys, count: journeys.length }, { status: 200 });
}

const scheduleSchema = z.enum(['off', 'daily', 'weekly']);

const createJourneySchema = z.object({
  name: z.string().trim().min(1).max(120),
  targetUrl: z.string().url().max(2048).optional(),
  /**
   * The steps the runner walks, stored whole and unvalidated here.
   *
   * `/api/audit/run` owns the step contract and validates it there; duplicating
   * that schema would give two places to disagree about what a step is. What
   * this route will not accept is a credential *value* — a step references one
   * by name and the value is resolved server-side, so a literal here would be a
   * secret written into a database column.
   */
  schedule: scheduleSchema.optional(),
  scheduleHour: z.number().int().min(0).max(23).optional(),
  steps: z
    .array(z.record(z.string(), z.unknown()))
    .max(200)
    /**
     * Bounded by size, not by shape.
     *
     * The shape is `/api/audit/run`'s to own — the comment above says why, and
     * duplicating it here would give two definitions to disagree. But
     * `z.unknown()` accepts a multi-megabyte string in any field, and this row
     * is written permanently and read on every client screen. 200 steps of
     * genuine selectors and paths do not approach 64KB; a payload that does is
     * not a journey.
     */
    .refine((steps) => JSON.stringify(steps).length <= 64_000, {
      message: 'steps payload is too large',
    })
    .optional(),
});

/** Rejects a step that carries a password rather than a reference to one. */
function containsInlineCredential(steps: Array<Record<string, unknown>>): boolean {
  return steps.some((step) =>
    Object.keys(step).some((key) => /^(password|pass|secret|token)$/i.test(key)),
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId } = await params;
  const platform = getPlatformStore();

  if (!(await platform.getClient(clientId))) {
    return Response.json({ error: 'client_not_found', requestId }, { status: 404 });
  }

  let parsed: z.infer<typeof createJourneySchema>;
  try {
    parsed = createJourneySchema.parse(await request.json());
  } catch {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }

  if (parsed.steps && containsInlineCredential(parsed.steps)) {
    return Response.json({ error: 'inline_credential', requestId }, { status: 400 });
  }

  // Creating is scheduling: this route takes a cadence too, and was the last
  // place that took one without asking whether the journey could run. A
  // journey created `daily` with no steps is stored booked and never claimed,
  // and the screens hide the cadence picker for an unrunnable journey — so the
  // row would say Daily where nobody could see it or clear it.
  const refusal = journeyRunRefusal({
    ...(parsed.targetUrl ? { targetUrl: parsed.targetUrl } : {}),
    steps: parsed.steps ?? [],
  });
  if (parsed.schedule && parsed.schedule !== 'off' && refusal) {
    return Response.json({ error: refusal, requestId }, { status: 422 });
  }

  // Scoped to the client, because the id is global: two clients may both have
  // a journey called "Checkout" and they are not the same journey.
  const taken = (await platform.listJourneys()).map((journey) => journey.id);
  const id = clientIdFromName(`${clientId} ${parsed.name}`, taken);

  await platform.upsertJourney({
    id,
    clientId,
    name: parsed.name,
    ...(parsed.targetUrl ? { targetUrl: parsed.targetUrl } : {}),
    ...(parsed.schedule ? { schedule: parsed.schedule } : {}),
    ...(parsed.scheduleHour === undefined ? {} : { scheduleHour: parsed.scheduleHour }),
    steps: parsed.steps ?? [],
  });

  await platform.recordEvent({
    clientId,
    ...actorFields(principal),
    action: 'recorded a journey',
    subject: parsed.name,
  });

  return Response.json({ requestId, journey: { id, name: parsed.name } }, { status: 201 });
}
