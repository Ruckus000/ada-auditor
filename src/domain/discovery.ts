/**
 * What discovery is: the pure contracts and rules for proposing a site's pages
 * to an operator, as data. Discovery is an authoring aid — it audits nothing,
 * stores nothing and scores nothing — so this module holds only the types,
 * caps and request schema a crawler and route are built against, not the
 * crawl itself.
 *
 * What one page is, for the purpose of not visiting it twice.
 *
 * `/a`, `/a/`, `/a/index.html` and `/a#top` are one page. `routeFromPageUrl`
 * carries the scar from getting the first three wrong: a six-page audit of
 * `w3.org/WAI/` reported every page as `/`, because the old implementation
 * popped the last path segment and a trailing slash makes that the empty
 * string. A crawler that made the same mistake would not mislabel pages, it
 * would fail to terminate — every link back to the home page would look new.
 *
 * The path core lives here and both callers use it. Only the core: dedupe
 * works on whole URLs and drops fragments, display returns a bare path and
 * keeps `file:` handling. Sharing past the overlap would fold two rules into
 * one and break display the next time dedupe learns something about queries.
 */

import { z } from 'zod';

/** Collapses a pathname's directory, `index.html` and bare forms to one canonical path. */
export function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/index\.html?$/i, '/').replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * The identity a crawl dedupes on: origin + normalised path + query.
 *
 * The fragment is dropped because it names a position within a page, not a
 * page — `/a#intro` and `/a#detail` are one document and one audit. The query
 * is kept because it routinely selects a different one, and it is kept
 * exactly as written: `?a=1&b=2` and `?b=2&a=1` key as two different pages.
 * That is a decision, not an oversight — the crawl is capped, so the worst
 * case is a few wasted revisits, and sorting params would break the rare
 * server that treats param order as meaningful.
 *
 * Requires an absolute URL (`new URL` throws `TypeError` otherwise, e.g. on
 * `/relative`, `''`, `'not a url'` or a bare `'#frag'`). That throw is the
 * contract, not a gap: minting a key for a value with no origin would either
 * fabricate one or silently merge it with whatever else lacks one, and a
 * crawler has no business treating an unparseable href as a page. Task 3's
 * caller must catch per-URL and route the failure into `DiscoveryError[]`,
 * not let it abort the frontier.
 *
 * Callers must also filter to http/https before calling this: origin is the
 * literal string `"null"` for opaque-origin schemes like `mailto:` or
 * `data:`, so `mailto:x` and `data:x` collide on the same key. Scheme
 * filtering is Task 3's job, not this function's — it is out of contract
 * here.
 */
export function discoveryKey(rawUrl: string): string {
  const url = new URL(rawUrl);
  return `${url.origin}${normalizePathname(url.pathname)}${url.search}`;
}

/**
 * A ceiling that stops a pathological site, not a target the crawl expects to
 * reach. The wall-clock budget binds first on anything real — see below.
 *
 * This bounds pages *visited*. It says nothing about how many links a crawl
 * reads, which is a different and larger number — see `MAX_LINKS_PER_PAGE`.
 */
export const MAX_DISCOVERY_URLS = 100;

/**
 * How many anchors are read from any one page.
 *
 * The crawler's largest single input is one page's DOM, not its page count.
 * Everything else here bounds navigations, and navigations are slow enough
 * that the wall clock contains them; harvesting is not. A single faceted-search
 * page emitting `?filter=` permutations, or one page carrying a million
 * anchors, is read in one navigation — so the budget never gets a chance to
 * trip, and what would have been a slow crawl is an out-of-memory instead.
 *
 * The cap has to be applied *inside* the page callback, before the hrefs are
 * serialised back across CDP. Slicing the array `$$eval` returns would mean the
 * oversized data had already crossed, which is the cost this exists to avoid.
 *
 * 500 is far above any real page's navigation and far below the size at which
 * a page becomes a weapon. A crawl that hits it has found a page whose links
 * are generated, and the first 500 of those are as good a sample as any.
 *
 * Together with the two caps around it this bounds the crawl's largest
 * structure, which is the set of keys it has already seen — not its list of
 * pages. That set takes an entry per distinct link harvested, so its ceiling is
 * `MAX_DISCOVERY_URLS × MAX_LINKS_PER_PAGE` plus the entry point: 50,001 keys
 * of at most `MAX_HREF_LENGTH` each, roughly 100MB of key text and about twice
 * that held as UTF-16. Survivable in a 300s function, and the wall-clock budget
 * cuts a real crawl to 40-45 pages long before any of it is reached — but it is
 * the number to re-derive first if these caps are ever raised.
 */
export const MAX_LINKS_PER_PAGE = 500;

/**
 * The longest href the crawl will carry, matching the `targetUrl` bound in
 * `discoveryRequestSchema` below.
 *
 * The same number for the same reason, and deliberately not a second opinion
 * about how long a URL may be: an operator may not hand us a URL longer than
 * this, so a page has no business making us hold one either. Applied in the
 * same page-side filter as `MAX_LINKS_PER_PAGE` — a thousand 100KB hrefs are
 * as effective an attack as a million short ones, and counting alone would
 * miss it.
 */
export const MAX_HREF_LENGTH = 2048;

/**
 * How far from the entry page the crawl will walk, inclusive: pages at this
 * depth are still visited, so a value of 3 spans four levels in all — the
 * entry page plus three hops beyond it. `DiscoveredPage.depth` uses the same
 * 0-based count.
 */
export const MAX_DISCOVERY_DEPTH = 3;

/**
 * The wall clock, and the number that actually stops most crawls.
 *
 * The only measurement available is the four-page W3C BAD run, where the
 * slowest page took 4.0s of which 2.9s was the axe scan — so a discovery
 * navigation, which runs no scan, is on the order of 1.1s. With the delay
 * below that is roughly 40-45 pages in 60s, not 100.
 *
 * Both bounds stay because they stop different things: the budget stops a slow
 * site, the URL cap stops a fast one with thousands of pages. A `truncated`
 * result on a real site will almost always say `budget`, and that is not a
 * bug. Re-derive both from a real client crawl, not from this estimate.
 */
export const DISCOVERY_BUDGET_MS = 60_000;

/**
 * Politeness, in the absence of robots.txt.
 *
 * This product does not consult robots.txt — it governs indexing, not a
 * contracted audit — so what remains between us and someone else's server is
 * this delay, serial navigation, and an identifying User-Agent.
 */
export const DISCOVERY_DELAY_MS = 250;

/**
 * Says who we are, so a site operator reading logs can tell.
 *
 * A product token for the comment field of a User-Agent header
 * (`Mozilla/5.0 (compatible; ${DISCOVERY_USER_AGENT_PRODUCT})`), not a suffix
 * appended to one — naming it a suffix invited `${baseUa} ${...}`, which is
 * not a well-formed header.
 */
export const DISCOVERY_USER_AGENT_PRODUCT = 'ADA-Auditor-Discovery/1.0';

export type DiscoveredPage = {
  url: string;
  title: string;
  /** 0 is the entry page. */
  depth: number;
};

/**
 * Why a crawl stopped short, and how much it had seen.
 *
 * Depth is deliberately not a reason: reaching `MAX_DISCOVERY_DEPTH` is the
 * crawl's intended shape, not a shortfall. Only the URL cap and the budget cut
 * a result short, and both say so — returning 100 URLs while implying that is
 * the whole site is the failure this field exists to prevent.
 */
export type DiscoveryTruncation = {
  reason: 'url-cap' | 'budget';
  seen: number;
};

/**
 * A page that could not be read. One dead link must not end a crawl.
 *
 * `message` is the navigation error's first line only — the same split
 * `attemptStep` in `src/integrations/browser/journey-runner.ts` makes, and for
 * the same reason. Everything after the first line is Playwright's call log,
 * and a `page.goto` call log includes the URL it was navigating to. Discovery
 * follows links harvested from arbitrary markup on someone else's site, and a
 * query string there routinely carries a reset token, session id or signed
 * param; the call log would print it. `services/logger.ts` redacts by key
 * name, so a secret sitting inside the *value* of a field named `message`
 * passes through untouched — and this string is destined for an operator's
 * screen. The full call log is deliberately excluded here; Task 3's crawler
 * performs the split before constructing this type.
 */
export type DiscoveryError = {
  url: string;
  message: string;
};

export type DiscoveryResult = {
  pages: DiscoveredPage[];
  truncated?: DiscoveryTruncation;
  errors: DiscoveryError[];
};

/**
 * `.strict()` for the same reason `authoredStepSchema` is: the keys nobody
 * thought to name are the ones worth refusing. The caps are not caller-supplied
 * in v1 and a body that tries to supply them is a body to reject, not ignore.
 *
 * `targetUrl` is capped at 2048 characters, matching the same field on the
 * journeys route (`src/app/api/platform/clients/[clientId]/journeys/route.ts`)
 * and built the same way `authoredStepsSchema` bounds its array, for the
 * reason `src/domain/journey-step.ts` gives: length before shape, and the
 * order is load-bearing. `.max(2048)` runs on the plain string before
 * `.pipe()` ever hands it to the URL format check, so an oversized value is
 * refused without being parsed as a URL at all — chaining `.max()` onto
 * `z.url()` instead would run the format check first.
 *
 * zod trims a string before running format checks, so a `targetUrl` with
 * leading or trailing whitespace both parses successfully and comes back
 * trimmed on `.data`. That trimming happens inside the piped `z.url()` step
 * and survives the pipe. Callers must use the parsed value, never the raw
 * request body, or that trimming buys nothing.
 */
export const discoveryRequestSchema = z
  .object({
    targetUrl: z
      .string()
      .max(2048)
      .pipe(z.url({ protocol: /^https?$/ })),
  })
  .strict();
