# Link Discovery Design

Give an operator one URL and let the system find the site's pages, so a
static multi-page site can be audited without hand-writing a step per page.

## Problem

The auditor scans every page a journey navigates to, and has done so against
real static sites — a four-page W3C BAD demo run on a production function, and
a six-page walk of `w3.org/WAI/`. What it cannot do is find those pages. There
is no link discovery and no sitemap parsing anywhere in the tree, and
`runBrowserAudit` refuses a target with no steps:

> `A run against a target URL must name its own steps.`

So auditing a twelve-page brochure site means writing twelve `goto` steps by
hand. `scripts/smoke-real.ts` fakes a walk with `a[href] >> nth=N` selectors and
its own comment calls that "a heuristic, not a crawler".

## Shape: an authoring aid, not an audit

Discovery produces a **proposed step list**, not a run. It writes no findings,
no evidence, no score and no run record. An operator reviews what it found,
picks the pages they want, and saves an ordinary journey of `goto` steps.

Every audit therefore remains a fixed, reviewable list of steps that a person
approved. That is the property scheduled runs and regression comparison depend
on: a run that discovers its own pages could audit a different set each night,
and `compareToBaseline` — keyed on rule + page + selector — would report churn
that is really just the crawler taking a different turn.

It also means none of the evidence, `ciStatus` or scoring semantics apply here.
Discovery asserts nothing about the client's site, so there is nothing for
`inconclusive` to be about.

```
POST /api/platform/discover { targetUrl }
  -> { pages: [{ url, title, depth }], truncated, errors }

  operator ticks the pages they want
  -> POST /api/platform/clients/<id>/journeys  (ordinary goto steps)
  -> runs, re-runs and schedules exactly as today
```

## Guards

A crawler is a different security object from a run, and the difference is the
whole of this section:

> **A run's URLs are authored by an operator. A crawler's URLs are authored by
> the page.**

Any page can contain `<a href="http://169.254.169.254/latest/meta-data/">`. A
journey's `goto` paths are typed by somebody we trust; a crawler's frontier is
filled by whatever markup it just downloaded. So every discovered URL passes the
same three checks a run applies, with no fast path for links that "look
internal":

| Check | From | Closes |
|---|---|---|
| `assertAllowedUrl` | `integrations/browser/target-url.ts` | off-scope hosts |
| `assertSafeTargetUrl` | same | scheme, host, every resolved address |
| `assertPeerAddressAllowed` | same | the address actually connected to (DNS rebinding) |

All three exist and are reused unchanged. An empty allowlist denies everything
rather than allowing it, per the existing scope rule.

**This is why discovery renders pages in the real browser rather than fetching
HTML.** The reason is not SPA support — it is that `assertPeerAddressAllowed` is
bound to the browser context. A plain-`fetch` crawler would need a second SSRF
implementation for the fetch path, and a security rule with two implementations
is the worst thing to duplicate. Rendering is slower and correct.

### Politeness

`robots.txt` is deliberately not consulted — see the decision log. Discovery
carries its own bound on how it behaves against someone else's server:

- navigation is serial, on one reused browser page — never concurrent
- `DISCOVERY_DELAY_MS = 250` between navigations
- an identifying User-Agent naming the auditor

## Units

Three, following the existing boundaries.

| Unit | Layer | Responsibility |
|---|---|---|
| `domain/discovery.ts` | domain | contracts, caps, request schema, URL normalisation |
| `integrations/browser/discover-links.ts` | integrations | BFS crawl, guard enforcement, anchor extraction |
| `app/api/platform/discover/route.ts` | edge | auth, call, respond |

There is no services layer. Nothing here orchestrates a use case across a domain
and a repository — the crawl is one integration call over pure domain rules — and
an empty module in `services/` to satisfy the shape of the other features would
be a layer with no job.

### `domain/discovery.ts`

Pure. Imports zod and nothing else.

```ts
export const MAX_DISCOVERY_URLS = 100;
export const MAX_DISCOVERY_DEPTH = 3;
export const DISCOVERY_BUDGET_MS = 60_000;

export type DiscoveredPage = { url: string; title: string; depth: number };
export type DiscoveryTruncation = { reason: 'url-cap' | 'budget'; seen: number };
export type DiscoveryError = { url: string; message: string };
export type DiscoveryResult = {
  pages: DiscoveredPage[];
  truncated?: DiscoveryTruncation;
  errors: DiscoveryError[];
};
```

**URL normalisation is domain, and it is shared.** `/a`, `/a/`, `/a/index.html`
and `/a#top` are one page. `routeFromPageUrl` in `journey-runner.ts` already
collapses `index.html` and trailing slashes for display labels, and getting that
wrong once already produced a six-page audit of `w3.org/WAI/` that reported every
page as `/`. The path-collapsing core moves here and both callers use it:

- `normalizePathname(pathname)` — the shared core: collapse `index.html`, strip
  trailing slashes, empty means `/`
- `discoveryKey(url)` — dedupe identity: origin + `normalizePathname` + search,
  fragment dropped
- `routeFromPageUrl(url)` — unchanged behaviour, now built on the core

Only the path core is shared. Dedupe works on whole URLs and drops fragments;
display returns a bare path and keeps `file:` handling. Sharing more than the
overlap would fold two rules into one and break the display case the next time
dedupe learns something about query strings.

**The budget binds before the URL cap, and that is intended.** The only
measurement available is the four-page BAD run, where the slowest page took 4.0s
of which 2.9s was the axe scan — so a discovery navigation, which runs no scan,
is on the order of 1.1s. With the 250ms delay that is roughly 40–45 pages in 60s,
not 100. `MAX_DISCOVERY_URLS` is a ceiling that stops a pathological site, not a
target the crawl is expected to reach.

Both numbers stay because they stop different things: the budget stops a slow
site, the cap stops a fast one with thousands of URLs. But a `truncated` result
on a real site will almost always say `budget`, and nobody should read that as a
bug. Re-derive both from a real client crawl, not from this estimate.

**Depth is not truncation.** Reaching `MAX_DISCOVERY_DEPTH` is the crawl's
intended shape, not a shortfall, so it is not a `truncated` reason. Only the URL
cap and the time budget cut a result short, and both are reported loudly with
what was seen — returning 100 URLs while implying that is the whole site is the
failure this field exists to prevent, in the same spirit as `truncatedPages` and
`audit_page_cap_reached`.

### `integrations/browser/discover-links.ts`

Owns Playwright. A breadth-first walk from the entry URL: navigate, read
`document.title`, extract same-host `<a href>` values, normalise and dedupe them
against the seen set, push unseen ones onto the frontier at `depth + 1`. Stops on
the URL cap, the depth limit or the wall-clock budget.

Every URL leaving the frontier passes the three guards before it is navigated to.

### `app/api/platform/discover/route.ts`

Operator session or run token, the same authorisation as the other platform
routes. Body is `{ targetUrl }`, validated by the domain schema.

Discovery does **not** consume the run budget. `AUDITOR_MAX_RUNS_PER_HOUR` and
`_PER_DAY` exist because audit runs cost money and the bill is shared; discovery
is not a run, and a shared counter would let an afternoon of picking pages
exhaust a client's audits. Its bound is its own 60s ceiling and the operator
gate in front of it.

## Selection, and one rule in one place

The screen lists what was found and warns when a selection exceeds
`AUDITOR_MAX_PAGES_PER_RUN` (default 20), reading the same value the runner uses.

**Nothing new is enforced at journey creation.** The page cap belongs to the
runner and stays there. A journey of 25 `goto` steps runs fine and truncates
loudly; refusing it at write time would put the cap in a second place, with a
third number beside `MAX_STEPS_PER_JOURNEY` (50) — and this repo already carries
the scar from two numbers disagreeing, where a 51-step journey stored fine,
scheduled fine, and then failed at body parse once a window forever.

It would also break a rule `journeyStepSchema` states outright: rows stored under
older rules must keep running, "because the alternative is a client's scheduled
audit breaking on a deploy that changed no behaviour". `AUDITOR_MAX_PAGES_PER_RUN`
is environment-configurable, so a creation-time cap would retroactively
invalidate stored journeys the day somebody lowered it.

Selected pages become steps of the form:

```json
{ "action": "navigate", "type": "goto", "path": "/pricing" }
```

The journey's `targetUrl` is the site **origin**; paths are origin-absolute
`pathname` + `search`. `resolveNavigationUrl` resolves a path against the target
as a base, so an origin with a path in it discards the step's path — the bug that
made `--url https://www.w3.org/WAI/` audit `https://www.w3.org/` while reporting
six healthy pages.

## Errors

A page that fails to load is recorded in `errors` and the crawl continues. One
dead link must not end discovery. Budget exhaustion returns what was found so far
plus the truncation reason. Partial and labelled beats empty, which is the
position `PartialJourneyError` already takes on the run side.

## Testing

| Suite | Covers |
|---|---|
| `tests/domain/discovery.test.ts` | normalisation and dedupe as a table; `routeFromPageUrl` unchanged after the extraction |
| `tests/integrations/browser/discover-links.test.ts` | a new multi-page static fixture: depth limit, dedupe, off-host rejection, error recording |
| `npm run chaos` | a fixture page linking to `http://127.0.0.1:22/` is never navigated to |
| route test | auth, schema refusal, budget isolation |
| `npm run test:hydration` | the discover screen at zero axe violations |

The blocked-address case is a steady-state claim about what this system will
never do, so it lives in chaos rather than only in a unit test.

## Decision log

**robots.txt is not consulted.** It governs indexing, not a contracted audit, and
the operator running discovery has authorisation for the site. The cost is that
the tool will crawl anything it is pointed at with no recorded justification; the
politeness bound above is what remains, and the host allowlist is what keeps it
from wandering. Revisit if discovery is ever exposed to anyone but an operator.

**Template clustering is deferred.** The plan grouped URLs by a structural
signature so that forty blog posts read as one row. It was cut because the
requirement is static sites of roughly twenty pages, where the operator selects
everything and clustering does nothing — it only pays on the content-heavy site
this phase is not solving. It also could not meet this repo's evidence bar: a
`+37 similar` count is an unvalidated claim about page equivalence, the same
shape as the effort estimate the product refuses to ship because nothing can
measure it. Clustering is a pure function over the `DiscoveredPage[]` this
endpoint already returns, so adding it later changes no contract.

**sitemap.xml is deferred.** A second fetch path and an XML parser, whose URLs
would still pass through every guard, to find pages that link-following already
finds on a site this size.

**Rendering rather than fetching** is a guard-reuse decision, recorded above so
that a future change does not "optimise" it into a fetch and quietly fork the
SSRF rules.

## Out of scope

Discovery behind a login, discovery as a step type inside a journey, and
site-wide crawls beyond the 100-URL ceiling. The last needs a container worker
rather than a bigger number — a run still cannot outlive one 300s function
invocation.
