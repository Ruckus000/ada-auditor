import { z } from 'zod';
import { environmentSchema } from '../../../../../../../../domain/contracts';
import { actorFields } from '../../../../../../../../domain/operator';
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
   * A journey run for a client must name that client's site.
   *
   * `targetUrl` is required here even though `/api/audit/run` treats it as
   * optional, and the difference is the point. When it is absent the runner
   * resolves every `goto` against `DEFAULT_FIXTURE_DIR` — our own demo pages,
   * over `file://`. Through the generic endpoint that is a deliberate test
   * affordance. Through *this* endpoint it would file a green audit of our
   * fixture app under a real client's name: not an error, an answer, and a
   * plausible-looking one. Steps alone do not save it, because the steps would
   * simply walk the fixture app instead.
   *
   * The mirror of that, which this used to allow: a journey that *does* name a
   * client's site and has no steps. `hasSteps` was computed here and then used
   * only to decide whether to validate, so such a journey reached `startRun`
   * with `steps` undefined, and `runBrowserAudit` substituted the built-in
   * fixture login — whose `goto` paths then resolved against the *client's*
   * origin, fetching `https://their-site/login.html`. Worse than the case the
   * paragraph above refuses, because it is a real origin. Both are refused now.
   */
  const hasSteps = Array.isArray(journey.steps) && journey.steps.length > 0;
  if (!journey.targetUrl) {
    return Response.json(
      { error: 'journey_not_runnable', requestId, journeyId },
      { status: 422 },
    );
  }

  if (!hasSteps) {
    return Response.json(
      { error: 'journey_has_no_steps', requestId, journeyId },
      { status: 422 },
    );
  }

  // Steps were stored unvalidated on purpose — `/api/audit/run` owns the step
  // contract and duplicating it would create two definitions that disagree.
  // The cost is that a malformed stored step must be caught here, as a 422
  // naming the journey, rather than as a 500 from inside the browser.
  let steps: z.infer<typeof journeyStepSchema>[] | undefined;
  if (hasSteps) {
    const validated = z.array(journeyStepSchema).safeParse(journey.steps);
    if (!validated.success) {
      return Response.json(
        { error: 'invalid_journey_steps', requestId, journeyId },
        { status: 422 },
      );
    }
    steps = validated.data;
  }

  // The journey's own environment unless this run says otherwise. Absent on
  // rows written before the column existed, and `production` is the strictest
  // policy — widening is a deliberate act, never a fallback.
  const environment = parsed.environment ?? (journey.environment as 'production') ?? 'production';

  const result = await startRun(
    {
      journeyId: journey.id,
      environment,
      targetUrl: journey.targetUrl,
      ...(steps ? { steps } : {}),
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
