import { z } from 'zod';
import { allowedHostsSchema } from '../../../../../../domain/allowed-hosts';
import { authoredStepsSchema, toStepViews } from '../../../../../../domain/journey-step';
import { containsInlineCredential } from '../../../../_lib/inline-credential';
import { actorFields } from '../../../../../../domain/operator';
import { environmentSchema } from '../../../../../../domain/contracts';
import { firstForbiddenAction } from '../../../../../../domain/policy';
import { journeyRunRefusal, type StoredJourney } from '../../../../../../domain/platform';
import { getPlatformStore } from '../../../../../../integrations/persistence';
import { clientIdFromName } from '../../../../../../services/portfolio';
import { authorizePrincipal } from '../../../../_lib/authorize';
import { createRequestId } from '../../../../_lib/request-id';


/**
 * One journey, as this route is willing to say it.
 *
 * Written out field by field rather than returning the stored row, and that is
 * the whole fix. `listJourneys` hands back `StoredJourney`, and this used to
 * spread it straight into the response — so `steps` went out raw, literal
 * values and all. A `fill` step written before `authoredStepSchema` existed can
 * hold a real password, which made this the one surface in the product where
 * a stored secret was actually retrievable: the screens had gone to some
 * trouble to say "types a literal value" and never what it was, and the API
 * beside them handed it over on request.
 *
 * `toStepViews` is the same projection those screens use. One description of a
 * stored step, and it is the one that refuses to carry a literal.
 *
 * Naming each field also closes the way this arrived. A response built by
 * spreading a row publishes every column somebody adds later, including the
 * ones added without thinking about who reads this.
 *
 * **What it costs, plainly:** a caller cannot GET a journey and PATCH it back
 * unchanged, because a literal value does not survive the round trip. That is
 * the same trade the step editor makes for the same reason, and the same
 * answer applies — a literal can be replaced, never read.
 */
function journeyResponse(journey: StoredJourney) {
  return {
    id: journey.id,
    clientId: journey.clientId,
    name: journey.name,
    ...(journey.targetUrl === undefined ? {} : { targetUrl: journey.targetUrl }),
    ...(journey.environment === undefined ? {} : { environment: journey.environment }),
    ...(journey.schedule === undefined ? {} : { schedule: journey.schedule }),
    ...(journey.scheduleHour === undefined ? {} : { scheduleHour: journey.scheduleHour }),
    ...(journey.allowedHosts === undefined ? {} : { allowedHosts: journey.allowedHosts }),
    steps: toStepViews(journey.steps),
    createdAt: journey.createdAt,
    updatedAt: journey.updatedAt,
  };
}

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

  return Response.json(
    { requestId, journeys: journeys.map(journeyResponse), count: journeys.length },
    { status: 200 },
  );
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
   * — `domain/journey-step` — holding the runner's schema, this stricter one,
   * and the list form both routes use, with a test proving everything accepted
   * here also parses there.
   *
   * That state was not hypothetical. Two routes refuse to schedule or run a
   * journey whose stored steps fail the runner's schema, and both carry an
   * `invalid_journey_steps` code for it. An operator wrote `{banana: 1}`, got
   * a 201, and found out weeks later when a scheduled audit refused itself.
   */
  steps: authoredStepsSchema.optional(),
  /**
   * Extra hosts this journey may pass through, for third-party sign-in.
   *
   * The target's own host is not written here — the runner adds it, so an
   * operator cannot lock themselves out of their own site by listing a
   * provider and forgetting it.
   */
  allowedHosts: allowedHostsSchema.optional(),
  /**
   * Where this journey runs, which decides what a step may do.
   *
   * `production` when unsaid, and that default is why this had to become
   * settable. Production forbids `submit-safe` and `mutate-test-data`, so
   * while every journey was production those two were authorable and runnable
   * nowhere — a step an operator could write and no run could ever walk, which
   * is precisely the state `delete` was removed from `AUTHORABLE_ACTIONS` to
   * avoid.
   */
  environment: environmentSchema.optional(),
});


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

  // Refused here rather than at step N of the walk. The runner checks each
  // action as it reaches it, so a journey production forbids is one that
  // clicks its way through a client's live site and then stops — the damage
  // is already done by the time the refusal is read.
  const forbidden = firstForbiddenAction(parsed.steps ?? [], parsed.environment ?? 'production');
  if (forbidden) {
    return Response.json(
      { error: 'action_not_allowed_here', requestId, action: forbidden },
      { status: 422 },
    );
  }

  // Scoped to the client, because the id is global: two clients may both have
  // a journey called "Checkout" and they are not the same journey.
  //
  // `includeArchived: true` because an archived journey's id is retired, not
  // vacant. `upsertJourney`'s on-conflict update preserves `archived_at`, so
  // minting a fresh journey against a list that omits archived ids would let
  // it collide with one — and resurrect the old row as a journey that is born
  // archived: invisible in the catalog and unrunnable from the moment it is
  // "created".
  const taken = (await platform.listJourneys(undefined, { includeArchived: true })).map(
    (journey) => journey.id,
  );
  const id = clientIdFromName(`${clientId} ${parsed.name}`, taken);

  await platform.upsertJourney({
    id,
    clientId,
    name: parsed.name,
    ...(parsed.targetUrl ? { targetUrl: parsed.targetUrl } : {}),
    ...(parsed.schedule ? { schedule: parsed.schedule } : {}),
    ...(parsed.scheduleHour === undefined ? {} : { scheduleHour: parsed.scheduleHour }),
    ...(parsed.allowedHosts ? { allowedHosts: parsed.allowedHosts } : {}),
    ...(parsed.environment ? { environment: parsed.environment } : {}),
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
