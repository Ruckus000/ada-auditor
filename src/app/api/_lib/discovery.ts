import {
  discoverLinks,
  EntryPointRedirectedError,
  EntryPointUnreachableError,
  firstErrorLine,
} from '../../../integrations/browser/discover-links';
import type { DiscoveryResult } from '../../../domain/discovery';
import { UnsafeTargetError } from '../../../integrations/browser/target-url';
import { logWarn } from '../../../services/logger';
import { classifyRunFailure } from './run-failure';

/**
 * One crawl attempt, with the refusal mapping both discover routes share.
 *
 * `/api/platform/discover` proposes pages for journey authoring; the
 * client-scoped documents route runs the same crawl and merges what it finds
 * into the client's inventory. The error branches below are the part that
 * must not fork: their ORDER IS LOAD-BEARING, and two copies is how one of
 * them gets "tidied" into telling an operator `navigation_not_allowed` about
 * a site that merely redirected.
 */
export type DiscoveryAttempt =
  | { ok: true; result: DiscoveryResult }
  | { ok: false; response: Response };

export async function attemptDiscovery(
  targetUrl: string,
  requestId: string,
): Promise<DiscoveryAttempt> {
  // The origin, never the whole URL. `services/logger.ts` redacts by field
  // *name*, so a token sitting in a query string would travel whole under a
  // key nothing is watching — the crawler's own `discovery_completed` logs the
  // origin for the same reason.
  const target = new URL(targetUrl).origin;

  try {
    const result = await discoverLinks({ targetUrl, requestId });
    return { ok: true, result };
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
      return {
        ok: false,
        response: Response.json(
          { error: 'entry_point_redirected', requestId, host: error.settledHost },
          { status: 400 },
        ),
      };
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
      return {
        ok: false,
        response: Response.json({ error: 'entry_point_unreachable', requestId }, { status: 502 }),
      };
    }

    if (error instanceof UnsafeTargetError) {
      const code = classifyRunFailure(error.message, error.name);
      logWarn('discovery_refused', { requestId, code, target });
      return {
        ok: false,
        response: Response.json({ error: code, requestId }, { status: 400 }),
      };
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
    return {
      ok: false,
      response: Response.json({ error: 'discovery_failed', requestId }, { status: 500 }),
    };
  }
}

/**
 * The crawl result as both routes serialise it. Passed through rather than
 * summarised: a bound that dropped work has already been recorded, and
 * dropping the record at the last hop would present a partial crawl as a
 * whole site — the one thing `DiscoveryTruncation` exists to prevent.
 */
export function discoveryResponseBody(result: DiscoveryResult) {
  return {
    pages: result.pages,
    documents: result.documents,
    errors: result.errors,
    ...(result.truncated ? { truncated: result.truncated } : {}),
    ...(result.errorsOmitted ? { errorsOmitted: result.errorsOmitted } : {}),
    ...(result.documentsOmitted ? { documentsOmitted: result.documentsOmitted } : {}),
  };
}
