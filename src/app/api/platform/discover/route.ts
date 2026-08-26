import { z } from 'zod';
import { discoveryRequestSchema } from '../../../../domain/discovery';
import { authorizePrincipal } from '../../_lib/authorize';
import { attemptDiscovery, discoveryResponseBody } from '../../_lib/discovery';
import { createRequestId } from '../../_lib/request-id';

/** Chromium needs a real Node runtime; the edge runtime cannot spawn it. */
export const runtime = 'nodejs';

/**
 * Deliberately far above the crawl's own budget, because **the inner bound
 * must be the one that fires.**
 *
 * A crawl stopped by `DISCOVERY_BUDGET_MS` returns the pages it found and says
 * `truncated`. A crawl stopped by the platform returns a 504 and nothing at
 * all — the same walk, the same 40-odd pages read, and no result. So the
 * headroom is the point, not the number: the 60s budget is only checked at the
 * top of each iteration, an in-flight navigation can add Playwright's default
 * 30s on top of it, and a cold start unpacks Chromium out of `/tmp` before any
 * of that begins.
 *
 * 300s is the ceiling on Hobby and the default everywhere, matching
 * `/api/audit/run` so the value is portable across plans.
 */
export const maxDuration = 300;

/**
 * Proposes the pages of a site, as data an operator edits into a journey.
 *
 * The crawl attempt and its refusal mapping live in `_lib/discovery.ts`,
 * shared with the client-scoped documents crawl — the branch order there is
 * load-bearing and two copies is how one gets "tidied" wrong.
 *
 * **`consumeRunBudget` is deliberately absent.** That counter lives inside
 * `startRun` and is scoped to audit runs — what a client is paying for.
 * Discovery audits nothing, scores nothing and stores nothing; charging it to
 * the same counter would let an afternoon of picking pages exhaust the runs
 * the client actually bought. If discovery ever needs a ceiling of its own it
 * gets its own counter, not a share of that one.
 */
export async function POST(request: Request) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  let parsed: z.infer<typeof discoveryRequestSchema>;
  try {
    parsed = discoveryRequestSchema.parse(await request.json());
  } catch {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }

  const attempt = await attemptDiscovery(parsed.targetUrl, requestId);
  if (!attempt.ok) {
    return attempt.response;
  }

  return Response.json(
    { requestId, ...discoveryResponseBody(attempt.result) },
    { status: 200 },
  );
}
