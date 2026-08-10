import { z } from 'zod';
import { authorizePrincipal } from '../../_lib/authorize';
import { createRequestId } from '../../_lib/request-id';
import { getRunStore } from '../../../../integrations/persistence';

/**
 * Run history, newest first.
 *
 * The store could not enumerate runs at all until Postgres replaced the file
 * and KV adapters — it was called out in the Phase 1 plan and never delivered,
 * so every screen that wanted "past runs" had to invent them. This is the
 * counterpart to `runs/latest` (one run) and `runs/[requestId]` (a named one).
 */
const querySchema = z.object({
  journeyId: z.string().min(1).optional(),
  environment: z.enum(['production', 'preview', 'staging', 'test']).optional(),
  // The store clamps this as well. Validating here means a caller gets a 400
  // saying what it did wrong rather than a silently different answer.
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: Request) {
  const requestId = createRequestId();

  if (!(await authorizePrincipal(request))) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    journeyId: url.searchParams.get('journeyId') ?? undefined,
    environment: url.searchParams.get('environment') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });

  if (!parsed.success) {
    return Response.json({ error: 'invalid_query', requestId }, { status: 400 });
  }

  const runs = await getRunStore().list(parsed.data);

  return Response.json({ requestId, runs, count: runs.length }, { status: 200 });
}
