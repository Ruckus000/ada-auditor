import { z } from 'zod';
import { EVENT_LIST_MAX } from '../../../../domain/platform';
import { getPlatformStore } from '../../../../integrations/persistence';
import { authorizePrincipal } from '../../_lib/authorize';
import { createRequestId } from '../../_lib/request-id';

/**
 * The activity log, queryable.
 *
 * The screens read activity through `services/activity-view.ts` in a server
 * component. This exists for the caller that cannot: `.github/workflows/
 * failed-runs.yml`, which reads recorded *runs* and therefore cannot see a
 * scheduled run that never started — there is no row, and deliberately so.
 * The event the tick writes instead is only reachable through here.
 *
 * The filters are applied by the store, not by the caller. The workflow's
 * whole method is to send one pinned action and count what comes back; it
 * never parses free text, and it could not, because `action` is free text and
 * an event carries a client id and a journey's name. Narrowing in `jq` over a
 * page of events would also make the alert depend on how busy the log was.
 *
 * No tenancy scoping. `clientId` is a filter and never a scope: there is one
 * organisation and every operator sees every client, which is the design
 * recorded in AGENTS.md rather than a hole. The dangerous version of this
 * route would be one that looked scoped.
 */

const querySchema = z.object({
  clientId: z.string().min(1).optional(),
  // Matched exactly by the store. Capped because it is a `text` column being
  // compared, not because any real action is near the cap.
  action: z.string().min(1).max(200).optional(),
  /**
   * An instant, not a word.
   *
   * `date -u -d '26 hours ago' +%Y-%m-%dT%H:%M:%SZ` — what the workflow sends
   * — parses here; a `since=yesterday` that fell through to the store would
   * silently mean "since the beginning of the log", which is the answer a
   * count-based alert least wants to be wrong about.
   */
  since: z.string().datetime().optional(),
  // The store clamps as well. Validating here means a caller gets a 400 saying
  // what it did wrong rather than a silently different answer — the same
  // reasoning `/api/audit/runs` states for its own limit.
  limit: z.coerce.number().int().min(1).max(EVENT_LIST_MAX).optional(),
});

export async function GET(request: Request) {
  const requestId = createRequestId();

  if (!(await authorizePrincipal(request))) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    clientId: url.searchParams.get('clientId') ?? undefined,
    action: url.searchParams.get('action') ?? undefined,
    since: url.searchParams.get('since') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: 'invalid_query', requestId }, { status: 400 });
  }

  const events = await getPlatformStore().listEvents(parsed.data);

  return Response.json({ requestId, events, count: events.length }, { status: 200 });
}
