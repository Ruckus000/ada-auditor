import { z } from 'zod';
import { discoveryRequestSchema } from '../../../../domain/discovery';
import {
  discoverLinks,
  EntryPointRedirectedError,
  EntryPointUnreachableError,
  firstErrorLine,
} from '../../../../integrations/browser/discover-links';
import { UnsafeTargetError } from '../../../../integrations/browser/target-url';
import { logWarn } from '../../../../services/logger';
import { authorizePrincipal } from '../../_lib/authorize';
import { createRequestId } from '../../_lib/request-id';
import { classifyRunFailure } from '../../_lib/run-failure';

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

  // The origin, never the whole URL. `services/logger.ts` redacts by field
  // *name*, so a token sitting in a query string would travel whole under a
  // key nothing is watching — the crawler's own `discovery_completed` logs the
  // origin for the same reason.
  const target = new URL(parsed.targetUrl).origin;

  try {
    const result = await discoverLinks({ targetUrl: parsed.targetUrl, requestId });

    return Response.json(
      {
        requestId,
        pages: result.pages,
        errors: result.errors,
        // Passed through rather than summarised. A bound that dropped work has
        // already been recorded twice below this line; dropping the record at
        // the last hop would present a partial crawl as a whole site, which is
        // the one thing `DiscoveryTruncation` exists to prevent.
        ...(result.truncated ? { truncated: result.truncated } : {}),
        ...(result.errorsOmitted ? { errorsOmitted: result.errorsOmitted } : {}),
      },
      { status: 200 },
    );
  } catch (error) {
    // ORDER IS LOAD-BEARING — do not sort these branches, do not merge them.
    //
    // `EntryPointRedirectedError extends UnsafeTargetError`, so the generic
    // check matches it too. Put the generic one first and this branch becomes
    // unreachable: the operator is told `navigation_not_allowed` about an
    // address that is perfectly allowed and merely redirects. A tidying pass
    // that reorders these regresses a user-visible answer while every type
    // check still passes.
    //
    // All three branch on the *type*, never the prose. `run-failure.ts`
    // records what the alternative cost: a message-prefix regex claimed to
    // cover `UnsafeTargetError`, caught three of its nine throw sites, and
    // missed both private-address refusals.
    if (error instanceof EntryPointRedirectedError) {
      logWarn('discovery_refused', {
        requestId,
        code: 'entry_point_redirected',
        target,
        settledHost: error.settledHost,
      });
      return Response.json(
        { error: 'entry_point_redirected', requestId, host: error.settledHost },
        { status: 400 },
      );
    }

    if (error instanceof EntryPointUnreachableError) {
      // 502 rather than 400 or 500: the request was well-formed and we did not
      // fail — the site did not answer. A 4xx would send an operator hunting
      // for a mistake in a URL that is fine, and a 5xx of ours would send them
      // to us.
      logWarn('discovery_refused', {
        requestId,
        code: 'entry_point_unreachable',
        target,
        // The *cause's* name, not this error's, which is always
        // `EntryPointUnreachableError` and says nothing. The wrapping site
        // spans more than the navigation, so a `TypeError` of ours at depth 0
        // is reported to the operator as an unreachable site — see the class.
        // This field is what makes that visible to us anyway: a log line
        // reading `TypeError` under `entry_point_unreachable` is our bug, not
        // their server.
        errorName: error.cause instanceof Error ? error.cause.name : 'unknown',
        // Playwright puts the URL it was dialling on the *first* line, so this
        // can repeat the entry URL in full, query string and all — where
        // `target` beside it was deliberately reduced to an origin. Accepted,
        // and the difference is where the URL came from: this one is the
        // operator's own input for this request, not a URL harvested from a
        // third party's markup, which is the case `firstErrorLine` and
        // `DiscoveryError` exist for. `target` is origin-only because it is
        // the field a log query groups on and would be indexed broadly. The
        // alternative is a regex that strips URLs out of Playwright's prose,
        // which is the exact move `run-failure.ts` records getting wrong.
        //
        // "The operator's own input" is a claim about a condition next door,
        // not about this branch: `discover-links.ts` wraps a failure as
        // `EntryPointUnreachableError` only under
        // `next.depth === 0 && pages.length === 0`, which is what guarantees
        // the URL inside this message is the entry point and not a link
        // harvested from a third party's markup. Loosen that condition and
        // this field starts carrying somebody else's query string.
        reason: error.message,
      });
      return Response.json({ error: 'entry_point_unreachable', requestId }, { status: 502 });
    }

    if (error instanceof UnsafeTargetError) {
      const code = classifyRunFailure(error.message, error.name);
      logWarn('discovery_refused', { requestId, code, target });
      return Response.json({ error: code, requestId }, { status: 400 });
    }

    // **This terminates here and does not rethrow.** No route in
    // `src/app/api/` rethrows, and this one has a specific reason not to
    // start: the errors arriving here are Playwright's, and a navigation
    // failure carries its whole call log — every URL it tried, every selector
    // it waited on. Handing that to whatever catches an uncaught route error
    // hands it to something that applies no redaction.
    //
    // `firstErrorLine` keeps the *call log* out, which is what it claims and
    // all it claims. It is not a URL filter: Playwright puts the URL it was
    // dialling on line one, after the error code, so a first line can still
    // carry one whole. `journey-runner.ts` makes the identical split and this
    // is the repo's settled position, not a gap peculiar to this route — the
    // response body carries a code and nothing else, which is the part that
    // actually has to hold.
    logWarn('discovery_failed', {
      requestId,
      target,
      errorName: error instanceof Error ? error.name : 'unknown',
      reason: firstErrorLine(error),
    });
    return Response.json({ error: 'discovery_failed', requestId }, { status: 500 });
  }
}
