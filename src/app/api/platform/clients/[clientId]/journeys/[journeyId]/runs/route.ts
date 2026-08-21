import { z } from 'zod';
import { environmentSchema } from '../../../../../../../../domain/contracts';
import { actorFields } from '../../../../../../../../domain/operator';
import { journeyRunRefusal } from '../../../../../../../../domain/platform';
import { firstForbiddenAction } from '../../../../../../../../domain/policy';
import { getPlatformStore } from '../../../../../../../../integrations/persistence';
import {
  journeyStepSchema,
  startRun,
} from '../../../../../../_lib/audit-run-handler';
import { authorizePrincipal } from '../../../../../../_lib/authorize';
import { createRequestId } from '../../../../../../_lib/request-id';

/**
 * Run a journey that is already stored.
 *
 * Until this existed, a journey in the catalog was inert: nothing anywhere
 * read `journeys.steps` to build a run. The screens reported, and the only way
 * to start anything was the console or a hand-written POST to /api/audit/run
 * with the steps typed out again. This is what makes the platform a control
 * plane rather than a viewer.
 */

// Launches Chromium, so it needs both, exactly like /api/audit/run.
export const runtime = 'nodejs';
export const maxDuration = 300;

const bodySchema = z.object({
  /** Overrides the journey's stored environment for this run only. */
  environment: environmentSchema.optional(),
});

export async function POST(
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
  // The journey has to belong to this client. Without this, naming any
  // journey id under any client's URL would run it and file the activity
  // event against the wrong customer. Same check, same reasoning, as minting
  // a share token in `reports/route.ts`.
  if (!journey || journey.clientId !== clientId || journey.archivedAt) {
    return Response.json({ error: 'journey_not_found', requestId }, { status: 404 });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse((await request.json().catch(() => ({}))) ?? {});
  } catch {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }

  /**
   * A journey run for a client must name that client's site *and* a path
   * through it. `journeyRunRefusal` holds both halves and says why.
   *
   * `/api/audit/run` treats each as optional and fills the gap with the
   * fixture app; through the generic endpoint that is a deliberate test
   * affordance. Through *this* endpoint it would file an audit of our demo
   * pages — or of `https://their-site/login.html` — under a real client's
   * name: not an error, an answer, and a plausible-looking one.
   */
  const refusal = journeyRunRefusal(journey);
  if (refusal) {
    return Response.json({ error: refusal, requestId, journeyId }, { status: 422 });
  }

  // Kept, though creation now validates too.
  //
  // This used to say steps were "stored unvalidated on purpose". They are not,
  // any more — the write route parses them against `authoredStepSchema`. What
  // it protects is every row written *before* that, and those are the majority
  // of what exists: a journey stored under the old free-for-all is still out
  // there and must be refused here as a 422 naming the journey, rather than as
  // a 500 from inside the browser. Rows written from now on cannot fail it.
  const validated = z.array(journeyStepSchema).safeParse(journey.steps);
  if (!validated.success) {
    return Response.json(
      { error: 'invalid_journey_steps', requestId, journeyId },
      { status: 422 },
    );
  }
  const steps = validated.data;

  // The journey's own environment unless this run says otherwise. Absent on
  // rows written before the column existed, and `production` is the strictest
  // policy — widening is a deliberate act, never a fallback.
  const environment = parsed.environment ?? (journey.environment as 'production') ?? 'production';

  // Refused before a browser launches, not at step N of a client's live site.
  //
  // The preview route beside this one has always checked; this one did not,
  // and it is the route that accepts an `environment` override — so a journey
  // authored under production, where `submit-safe` and `mutate-test-data` are
  // forbidden, could be run with the policy widened by the caller and its
  // steps checked only as the runner reached them. That is the mid-walk
  // failure the create and patch routes' upfront checks exist to prevent, and
  // the two routes being parallel copies of one gate chain is how the gap went
  // unnoticed for as long as it did.
  const forbidden = firstForbiddenAction(steps, environment);
  if (forbidden) {
    return Response.json(
      { error: 'action_not_allowed_here', requestId, action: forbidden },
      { status: 422 },
    );
  }

  const result = await startRun(
    {
      journeyId: journey.id,
      environment,
      targetUrl: journey.targetUrl,
      // The journey's own list, not the caller's: this route names a stored
      // journey, so where it may go is a property of that journey and not
      // something a request body gets to add to.
      ...(journey.allowedHosts ? { allowedHosts: journey.allowedHosts } : {}),
      steps,
    },
    requestId,
  );

  if (result.ok) {
    await platform.recordEvent({
      clientId,
      ...actorFields(principal),
      action: 'started a run',
      subject: journey.name,
      metadata: { requestId, environment },
    });
  }

  return Response.json(result.body, { status: result.status });
}
