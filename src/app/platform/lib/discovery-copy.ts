import type { DiscoveryTruncation } from '../../../domain/discovery';

/**
 * What discovery said, in words an operator can act on.
 *
 * Here rather than in `services/presentation/`, and the split is not
 * arbitrary: that directory holds product *semantics* with steady-state
 * contracts behind them — whether the product may say "pass" — and is asserted
 * against as behaviour. Refusal copy is a screen's wording for one screen's
 * codes. `run-failure-copy.ts` is the precedent, sits here, and is already
 * reached by the fast suite through `tests/app/`.
 *
 * **Two maps, not one.** `POST /api/platform/discover` and
 * `POST …/clients/<id>/journeys` share no error codes and describe different
 * events, and merging them produces sentences that are actively wrong:
 * answering the create route's `client_not_found` with "check the address and
 * try again" sends an operator back to a URL that had already worked — the
 * crawl finished long before the journey was written.
 *
 * A `switch` rather than a `Record` lookup, for the reason
 * `describeRunFailure` had to be repaired for: these codes arrive off a parsed
 * JSON body, so `__proto__` is a value a caller can send. Looked up on an
 * object literal it resolves through the prototype chain to something truthy
 * and not a string, which React renders by throwing — an unrecognised code
 * becomes a blank screen instead of the fallback written for it. A `switch`
 * compares values and has no prototype to walk.
 */

/**
 * The longest host this will print.
 *
 * The value came from somebody else's redirect, so it is neither trusted nor
 * bounded: a 2000-character host would push the rest of the panel off the
 * screen. Rendered as text and never as a link, for the same reason — naming
 * where a redirect went is help, offering a click through to it is not.
 */
const MAX_HOST_CHARS = 80;

function clipHost(host: string): string {
  return host.length > MAX_HOST_CHARS ? `${host.slice(0, MAX_HOST_CHARS)}…` : host;
}

/**
 * Why a crawl did not produce a list of pages.
 *
 * `details.host` is consumed rather than ignored, and that is the point of the
 * route shipping it as a structured field: discovery exists to save an operator
 * the work of finding out where their pages are, and a redirect refusal that
 * declines to name the destination hands that work straight back.
 *
 * The fallback says discovery did not finish and stops there. It deliberately
 * does not print the code: unlike `describeRunFailure`, which reads a code out
 * of a database column an operator may have to quote to us, this one is a
 * live response from a route in this same deployment, and our own bookkeeping
 * on a client's screen is noise they cannot act on.
 */
export function describeDiscoveryFailure(code: string, details?: { host?: string }): string {
  switch (code) {
    case 'entry_point_redirected': {
      const host = details?.host ? clipHost(details.host) : null;
      return host
        ? `That address redirects to ${host}, which is a different site. Discover ${host} instead.`
        : 'That address redirects to a different site. Discover the address it settles on instead.';
    }
    case 'entry_point_unreachable':
      return 'The site did not answer. Check the address is reachable from the public internet, then try again.';
    case 'navigation_not_allowed':
      return 'That address cannot be crawled: it is a private or reserved address, or one this deployment refuses. A public site address is what this needs.';
    case 'invalid_request_body':
      return 'That is not a web address this can use. It needs a full one, starting http:// or https://.';
    case 'unauthorized':
      return 'Your session expired. Reload and sign in again.';
    default:
      return 'Discovery did not finish. Try again, and if it repeats the site may be refusing us.';
  }
}

/**
 * Why the journey was not written, once the pages were already chosen.
 *
 * Separate from the map above because these are a different event with a
 * different remedy, and because the overlap is zero: nothing here can be
 * fixed by editing the site address, which is what every sentence above is
 * about.
 *
 * Only codes this panel can actually provoke. The create route also answers
 * `inline_credential`, `action_not_allowed_here` and the two run-refusal
 * codes, and none of them are reachable from here: the panel posts `goto`
 * steps with no credentials and never sets a schedule. Copy nobody can reach
 * is copy nobody maintains — `run-journey-button.tsx` records having had to
 * delete exactly that.
 */
export function describeJourneyCreationFailure(code: string): string {
  switch (code) {
    case 'client_not_found':
      return 'This client is no longer here. Reload the page.';
    case 'invalid_request_body':
      return 'Those pages were refused. Give the journey a name and pick at least one page.';
    case 'unauthorized':
      return 'Your session expired. Reload and sign in again.';
    default:
      return 'The journey was not saved. The pages you picked are still selected, so try again.';
  }
}

/**
 * That the crawl stopped short, and roughly how much it had seen.
 *
 * "At least", never a total. `DiscoveryTruncation.seen` documents itself as a
 * floor that errs upward on a redirect-heavy site — it counts the URL a
 * redirect settled on as well as the link that led there — so printing it as a
 * count would put a number on screen that the list underneath contradicts.
 *
 * `null` when nothing was truncated, so the caller renders nothing rather than
 * a reassuring sentence on every crawl. A banner that appears every time is a
 * banner nobody reads on the one crawl it matters for.
 */
export function describeTruncation(truncated: DiscoveryTruncation | undefined): string | null {
  if (!truncated) return null;

  const tail = `At least ${truncated.seen} addresses had been seen, so this is part of the site and not all of it.`;

  return truncated.reason === 'url-cap'
    ? `Discovery stopped at its page limit. ${tail}`
    : `Discovery ran out of time. ${tail}`;
}

/**
 * How many pages could not be read, counting the ones not listed.
 *
 * Built from `kept + omitted` rather than from `errors.length`, which is the
 * whole reason this function exists. `errorsOmitted` counts failures the
 * ceiling *discarded*, so a heading taken from the list length alone reads as
 * "100 problems" on a site with 300 of them — a bound that drops work
 * reporting a complete-looking number.
 */
export function describeErrorTotal(kept: number, omitted: number): string {
  const total = kept + omitted;
  const noun = total === 1 ? 'page' : 'pages';

  return omitted === 0
    ? `${total} ${noun} could not be read.`
    : `${total} ${noun} could not be read. The first ${kept} are listed below.`;
}

/**
 * How far from the entry page a group of pages sits, as prose.
 *
 * Said once per group, in a `<legend>`, rather than repeated into every
 * checkbox's accessible name. "Depth 2" forty times is forty announcements of
 * a number that describes the group, and the group is the thing with the
 * heading.
 */
export function describeDepth(depth: number): string {
  switch (depth) {
    case 0:
      return 'The address you gave';
    case 1:
      return 'One click from there';
    case 2:
      return 'Two clicks from there';
    case 3:
      return 'Three clicks from there';
    default:
      return `${depth} clicks from there`;
  }
}
