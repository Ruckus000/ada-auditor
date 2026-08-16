import { z } from 'zod';
import { authoredStepSchema } from '../../../../../../domain/journey-step';
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
  schedule: scheduleSchema.optional(),
  scheduleHour: z.number().int().min(0).max(23).optional(),
  /**
   * The steps the runner walks, validated here at last.
   *
   * This was `z.array(z.record(z.string(), z.unknown()))`, and the comment
   * defended it: `/api/audit/run` owns the step contract, and duplicating that
   * schema "would give two places to disagree about what a step is."
   *
   * The objection was right; the conclusion was not. The answer is one module
   * — `domain/journey-step` — holding both the runner's schema and this
   * stricter one, with a test proving everything accepted here also parses
   * there. So there is still exactly one contract, and a journey can no longer
   * be *stored* in a state that can never run.
   *
   * That state was not hypothetical. Two routes refuse to schedule or run a
   * journey whose stored steps fail the runner's schema, and both carry an
   * `invalid_journey_steps` code for it. An operator wrote `{banana: 1}`, got
   * a 201, and found out weeks later when a scheduled audit refused itself.
   *
   * The size bound stays. It is a different question — a payload that large is
   * not a journey whatever shape it is in.
   */
  steps: z
    // Length first, shape second, and the order is load-bearing.
    //
    // `.max()` on an array of `authoredStepSchema` is a check that runs *after*
    // every element has been parsed against a five-branch strict union — so a
    // 4.5MB body of 100k junk steps was fully parsed before the cap refused it.
    // Measured at ~2.6s of synchronous work against ~56ms under the old loose
    // schema: a 50x amplification, on the event loop, from one authenticated
    // request. Counting before parsing costs nothing and removes it.
    .array(z.unknown())
    .max(200)
    .pipe(z.array(authoredStepSchema))
    .refine((steps) => JSON.stringify(steps).length <= 64_000, {
      message: 'steps payload is too large',
    })
    .optional(),
});

/**
 * Rejects a step that carries a password rather than a reference to one.
 *
 * Reads the raw body rather than the parsed value, because it now runs *before*
 * the schema — a `.strict()` schema rejects these keys anyway, but as a generic
 * "invalid request body", and the specific answer is worth keeping.
 *
 * Still key names only, and still only the four. It never closed the hole it
 * was written for: a literal's value sits under the key `value`, so
 * `{action:'login', type:'fill', value:'hunter2'}` passed it. That one is
 * closed properly now, by `authoredStepSchema` refusing a `login` fill with a
 * literal — a rule about what the step *is*, not about what a key is called.
 */
function containsInlineCredential(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const steps = (body as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return false;

  return steps.some(
    (step) =>
      Boolean(step) &&
      typeof step === 'object' &&
      Object.keys(step as Record<string, unknown>).some((key) =>
        /^(password|pass|secret|token)$/i.test(key),
      ),
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

  const body: unknown = await request.json().catch(() => null);

  // Before the schema, and that ordering is the whole point of keeping this
  // check at all.
  //
  // `authoredStepSchema` is `.strict()`, so a step carrying a `password` key
  // is now refused by the schema too — as `invalid_request_body`, which tells
  // an operator nothing about what they did wrong. This runs first so the
  // answer stays "you put a credential in a step, use credentialRef", which is
  // the one sentence that fixes it. The schema is the backstop for the keys
  // nobody thought to name.
  if (containsInlineCredential(body)) {
    return Response.json({ error: 'inline_credential', requestId }, { status: 400 });
  }

  let parsed: z.infer<typeof createJourneySchema>;
  try {
    parsed = createJourneySchema.parse(body);
  } catch {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
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
