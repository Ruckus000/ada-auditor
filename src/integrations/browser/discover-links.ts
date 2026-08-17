import type { Browser, Page } from 'playwright-core';
import {
  discoveryKey,
  DISCOVERY_BUDGET_MS,
  DISCOVERY_DELAY_MS,
  DISCOVERY_USER_AGENT_PRODUCT,
  MAX_DISCOVERY_DEPTH,
  MAX_DISCOVERY_ERRORS,
  MAX_DISCOVERY_URLS,
  MAX_HREF_LENGTH,
  MAX_LINKS_PER_PAGE,
  type DiscoveredPage,
  type DiscoveryError,
  type DiscoveryResult,
  type DiscoveryTruncation,
} from '../../domain/discovery';
import { logInfo } from '../../services/logger';
import { launchChromium } from './launch';
import {
  assertAllowedUrl,
  assertPeerAddressAllowed,
  assertSafeTargetUrl,
  UnsafeTargetError,
} from './target-url';

/**
 * The entry point came to rest on a host the allowlist refuses.
 *
 * Carries `settledHost` as a *field* rather than only inside its message, so a
 * caller can name the host in a structured answer — "discover
 * `example.com` instead" — without parsing prose. `run-failure.ts` records
 * what the alternative costs: a message-prefix regex there claimed to cover
 * `UnsafeTargetError` and caught three of its nine throw sites, silently
 * miscategorising the two most security-critical refusals the guard makes.
 *
 * Extends `UnsafeTargetError` and deliberately does **not** override `name`.
 * `classifyRunFailure` keys on `name` and maps that one string to
 * `navigation_not_allowed`, which is the right answer for this too; callers
 * that want the detail branch on the *type*. A tenth throw site for a class
 * that already has nine is cheaper than a code every screen would have to
 * learn — the same trade `assertSettledOnTarget` documents.
 */
export class EntryPointRedirectedError extends UnsafeTargetError {
  readonly settledHost: string;

  /**
   * One argument, because the message is a function of the host.
   *
   * The sentence lives here rather than at the throw site so the field and the
   * prose cannot drift apart. What the message is *for* is a log line and a
   * stack trace; the route answers with `settledHost` as structured data, and
   * `run-failure.ts` explains why no message crosses the wire.
   */
  constructor(settledHost: string) {
    super(
      `The target redirected to ${settledHost}, which is not the host it was asked for. Discover ${settledHost} instead.`,
    );
    this.settledHost = settledHost;
  }
}

/**
 * The entry point could not be read at all — a dead host, a typo'd domain, a
 * timeout.
 *
 * A type rather than an inference, and the difference matters. Since Task 5,
 * `discoverLinks` throws *only* on entry failure, so the route could deduce
 * this from "not an `UnsafeTargetError`" and skip the class. But a `TypeError`
 * in our own crawler takes that same path, and inferring would tell the
 * operator their site is unreachable when the bug is ours. The type is what
 * keeps us from blaming a client's site for our own defect.
 *
 * The message is split here rather than at the catch because this is where the
 * call log is — the same reason `DiscoveryError.message` gives.
 */
export class EntryPointUnreachableError extends Error {
  constructor(cause: unknown) {
    super(firstErrorLine(cause));
    this.name = 'EntryPointUnreachableError';
    // The original is kept as `cause` and not as prose. A stack trace in the
    // platform's own logs is how our `TypeError` gets diagnosed; `message` is
    // the only part anything is allowed to hand an operator, and it is already
    // split. Nothing may serialise this field.
    this.cause = cause;
  }
}

export type DiscoverLinksInput = {
  targetUrl: string;
  /** Extra hosts, unioned with the target's own. Same shape as a run's. */
  allowedHosts?: string[];
  headless?: boolean;
};

type FrontierEntry = { url: string; depth: number };

/**
 * Every http or https link on the page, as absolute URLs.
 *
 * Read from the rendered DOM via `href`, which the browser has already
 * resolved against the document — so a relative `about.html`, a root-relative
 * `/about.html` and an absolute URL all arrive in one form and nothing here
 * has to re-implement URL resolution.
 *
 * `mailto:`, `tel:` and friends are dropped by the scheme test rather than by
 * name: an allowlist of two schemes is a rule, a denylist of the ones anybody
 * remembered is a list that grows by incident.
 *
 * Scope is *not* decided here. Everything on the page comes back and the
 * caller puts each href through the allowlist, so this returns off-host links
 * too.
 *
 * Both caps are applied inside the page callback, which is the whole point of
 * them: this is the crawler's largest single input, and it is written by the
 * page. Slicing what `$$eval` returned would mean a million hrefs had already
 * been serialised across CDP into this process, which is the cost being
 * avoided. The slice runs before the map so nothing beyond the cap is even
 * read off the DOM.
 */
async function extractLinks(page: Page): Promise<string[]> {
  return page.$$eval(
    'a[href]',
    (anchors, limits) =>
      anchors
        .slice(0, limits.maxLinks)
        .map((anchor) => (anchor as HTMLAnchorElement).href)
        .filter(
          (href) =>
            href.length <= limits.maxHref &&
            (href.startsWith('http://') || href.startsWith('https://')),
        ),
    { maxLinks: MAX_LINKS_PER_PAGE, maxHref: MAX_HREF_LENGTH },
  );
}

/**
 * Where a navigation came to rest has to be somewhere the crawl may go.
 *
 * `isEntry` changes only the *type* of the refusal, never the decision. At
 * depth 0 the settled URL is the whole crawl's address rather than one page's:
 * `hostAllowed` matches an allowlist entry or any subdomain of it, so apex→www
 * passes (`www.acme.com` ends with `.acme.com`) while **www→apex does not** —
 * and www→apex is the canonicalisation a large share of real sites perform. The
 * refusal is correct; what the caller needs is the host to point at instead.
 */
function assertSettledInScope(settled: string, allowedHosts: string[], isEntry: boolean): void {
  try {
    assertAllowedUrl(settled, allowedHosts);
  } catch (error) {
    if (isEntry && error instanceof UnsafeTargetError) {
      throw new EntryPointRedirectedError(new URL(settled).hostname);
    }
    throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The first line of a failure, and nothing after it.
 *
 * `attemptStep` in `journey-runner.ts` does the same thing for the same
 * reason, stated there at length: Playwright appends a call log, and a call
 * log names the URL it was dialling. Discovery's URLs come from a client's own
 * markup, where a query string routinely carries a reset token or a session
 * id — and this text is shown to an operator, having passed a redactor that
 * keys on field names rather than values.
 *
 * Exported because the route needs the same split for the errors that reach it
 * whole, and a second copy of a redaction rule is the thing this file argues
 * against everywhere else. Same move Task 1 made for `normalizePathname`.
 */
export function firstErrorLine(error: unknown): string {
  const isError = error instanceof Error;
  const first = ((isError ? error.message : String(error)).split('\n')[0] ?? '').trim();

  // The fallback is half of the parity, and `attemptStep`'s two fallbacks are
  // reproduced rather than collapsed into one. An `Error` with an empty
  // message is rare and not impossible, and without this the operator gets a
  // blank row where the reason should be — the class name is little, but it is
  // not nothing.
  return first || (isError ? `it raised ${error.name}` : 'it raised an unknown error');
}

/**
 * Walks a site from one URL and reports the pages it found.
 *
 * Discovery is an authoring aid: it scans nothing, scores nothing and stores
 * nothing. What it returns is a proposal an operator edits before it becomes a
 * journey.
 *
 * **Every discovered URL passes the same three guards a run applies, and there
 * is no fast path for links that look internal.** A run's URLs are authored by
 * an operator; a crawler's frontier is filled by whatever markup it just
 * downloaded, and any page can contain
 * `<a href="http://169.254.169.254/latest/meta-data/">`.
 *
 * That is also why this renders in the browser rather than fetching HTML. The
 * reason is not client-side navigation — it is that `assertPeerAddressAllowed`
 * is bound to the browser context, so a `fetch` crawler would need a second
 * SSRF implementation. A security rule with two implementations is the worst
 * possible thing to duplicate.
 */
export async function discoverLinks(input: DiscoverLinksInput): Promise<DiscoveryResult> {
  const startedAt = Date.now();
  const target = new URL(input.targetUrl);
  const allowedHosts = [target.hostname, ...(input.allowedHosts ?? [])];

  // Resolve and range-check the entry point before spending a browser launch.
  await assertSafeTargetUrl(input.targetUrl, allowedHosts);

  const pages: DiscoveredPage[] = [];
  const errors: DiscoveryError[] = [];
  const seen = new Set<string>([discoveryKey(input.targetUrl)]);
  const frontier: FrontierEntry[] = [{ url: input.targetUrl, depth: 0 }];
  let truncated: DiscoveryTruncation | undefined;

  /** Links the frontier ceiling refused. See the ceiling for why this is kept. */
  let droppedByCeiling = 0;

  /** Failures past `MAX_DISCOVERY_ERRORS`. Reported, for the reason given there. */
  let errorsOmitted = 0;

  const browser: Browser = await launchChromium({ headless: input.headless });

  try {
    const context = await browser.newContext({
      userAgent: `Mozilla/5.0 (compatible; ${DISCOVERY_USER_AGENT_PRODUCT})`,
    });

    // The peer check, registered on the context before any page exists, so no
    // navigation can be made before the listener that judges it. Recorded
    // rather than thrown: these promises are created inside an event handler
    // with nothing awaiting them, and a rejection escaping here is an
    // unhandled rejection that takes the process down.
    let peerViolation: Error | undefined;
    const peerChecks: Array<Promise<void>> = [];

    context.on('response', (response) => {
      const frame = response.frame();
      if (frame !== frame.page()?.mainFrame()) return;
      if (!response.request().isNavigationRequest()) return;

      peerChecks.push(
        (async () => {
          const peer = await response.serverAddr();
          assertPeerAddressAllowed(response.url(), peer?.ipAddress);
        })().catch((error: unknown) => {
          peerViolation ??= error instanceof Error ? error : new Error(String(error));
        }),
      );
    });

    const page = await context.newPage();

    while (frontier.length > 0) {
      if (Date.now() - startedAt > DISCOVERY_BUDGET_MS) {
        truncated = { reason: 'budget', seen: seen.size };
        break;
      }

      // Kept as a guard, and unreachable while the frontier ceiling below
      // exists. The ceiling admits a link only when
      // `frontier.length < MAX_DISCOVERY_URLS - pages.length`, and a page is
      // pushed before that iteration's links are read — so after every
      // iteration `frontier.length <= MAX_DISCOVERY_URLS - pages.length`, and
      // `pages.length >= MAX_DISCOVERY_URLS` therefore implies an empty
      // frontier, which the `while` condition has already caught. Deleting this
      // leaves the whole browser suite green; the post-loop assignment is the
      // only path that reports `url-cap`. It stays because the ceiling is one edit away
      // from changing and a cap with no top-of-loop check is a cap that can be
      // overrun. The budget branch above is live and is *not* in this position.
      if (pages.length >= MAX_DISCOVERY_URLS) {
        truncated = { reason: 'url-cap', seen: seen.size };
        break;
      }

      const next = frontier.shift();
      if (next === undefined) break;

      try {
        await page.goto(next.url, { waitUntil: 'domcontentloaded' });
        await Promise.all(peerChecks.splice(0));

        // Taken and cleared, where a run only ever reads it.
        //
        // A run stops at its first violation, so a sticky field costs it
        // nothing. A crawl does not stop — one refused page is an error entry
        // and the walk goes on — so leaving the violation in place would make
        // every later page fail with the *first* page's message, naming a URL
        // that had nothing to do with it. Each navigation's checks are all
        // awaited above before this reads the field, so nothing is dropped by
        // clearing it.
        if (peerViolation) {
          const violation = peerViolation;
          peerViolation = undefined;
          throw violation;
        }

        // Where it settled, not where it was asked for. `assertSettledOnTarget`
        // in `journey-runner.ts` exists for the same reason: the allowlist
        // governs where a walk comes to rest, and a redirect is how a request
        // for one host produces a page from another.
        const settled = page.url();
        assertSettledInScope(settled, allowedHosts, next.depth === 0);

        // Dedupe on where it came to rest, not only on where it was asked for.
        //
        // `/old-pricing` 301ing to `/pricing` is ordinary — trailing slashes and
        // apex-to-www make it so — and without this the crawl reports both and
        // navigates twice. Note what this is *not*: termination never depended
        // on it. `seen` still holds the requested key, so `/a`→`/b` where `/b`
        // links back to `/a` short-circuits regardless, and the
        // `routeFromPageUrl` scar is not the risk here. What it prevents is two
        // rows carrying a byte-identical `url` — recording the settled URL is
        // what made that newly possible — which a UI keyed on that string would
        // collide on.
        //
        // `continue` rather than skipping the push alone: the settled page's
        // links were harvested when the canonical entry was visited, so
        // re-extracting them is pure waste. Skipping only the push would also be
        // correct, just slower, and the fast one is chosen deliberately. The
        // politeness delay still gets paid — it lives in this block's `finally`
        // precisely so a request that was made is a request that is paid for.
        //
        // One consequence worth naming, because `truncated.seen` is `seen.size`
        // and Task 8 renders it: a settled URL nobody linked to is still an
        // entry here, so on a redirect-heavy site `seen` runs slightly ahead of
        // the number of distinct *links* found. `seen` is documented as a floor
        // on how much is out there, and this errs upward, which is the safe
        // direction for a floor.
        const settledKey = discoveryKey(settled);
        const alreadyRecorded = settledKey !== discoveryKey(next.url) && seen.has(settledKey);
        seen.add(settledKey);
        if (alreadyRecorded) continue;

        pages.push({
          // The settled URL, so a `goto` step authored from this points at
          // where the page lives rather than at a URL that redirects to it.
          url: settled,
          title: (await page.title()).slice(0, 200),
          depth: next.depth,
        });

        if (next.depth < MAX_DISCOVERY_DEPTH) {
          for (const href of await extractLinks(page)) {
            // One link's failure is one link's failure.
            //
            // `discoveryKey` throws `TypeError` on anything `new URL` cannot
            // read, and `src/domain/discovery.ts` states outright that this
            // caller must catch per-URL rather than let one href abort the
            // frontier. Both calls sit inside this `try` for that reason: from
            // the page-level `catch` a malformed href would discard every
            // remaining anchor on the page *and* file a `TypeError` against
            // the page's own URL, which reads as "this page failed to load"
            // about a page that loaded perfectly.
            let key: string;
            try {
              key = discoveryKey(href);
            } catch {
              continue;
            }

            if (seen.has(key)) continue;

            try {
              assertAllowedUrl(href, allowedHosts);
            } catch (error) {
              // Off-scope or a blocked literal address. Not an error worth
              // reporting — a site linking off itself is the normal case —
              // just somewhere this crawl does not go. Anything else from
              // inside the allowlist is a surprise and is not swallowed as
              // one: a catch-all here would file an unknown failure class
              // under "this link was off-scope" and nobody would ever see it.
              if (error instanceof UnsafeTargetError) continue;
              throw error;
            }

            seen.add(key);

            // The frontier never needs to hold more than the crawl can still
            // visit: `MAX_DISCOVERY_URLS` is the ceiling on `pages`, so once
            // the queue holds that many beyond what has been visited, every
            // further entry is one the loop will never reach. Without this the
            // queue keeps growing from pages the crawl is still reading long
            // after the visit budget is spoken for.
            //
            // The count is the other half, and it is not bookkeeping: **a
            // bound that drops work must also record that work was dropped, or
            // truncation reports a complete crawl.** Without it this ceiling
            // silently disabled url-cap truncation — draining the frontier to
            // empty is exactly what it does when the cap binds, so the loop
            // exits by its own `while` condition and the check at the top that
            // sets `truncated` is never reached again. The result then claims
            // to be the whole site, which is the one thing
            // `DiscoveryTruncation` exists to prevent.
            if (frontier.length >= MAX_DISCOVERY_URLS - pages.length) {
              droppedByCeiling += 1;
              continue;
            }

            frontier.push({ url: href, depth: next.depth + 1 });
          }
        }
      } catch (error) {
        // **One contract: this either returns a crawl or it throws.**
        //
        // Every other failure here is one page's and the walk goes on. A
        // failure of the entry point is the walk itself, and it does not matter
        // which of the three ways it failed — settled off the allowlist,
        // rebound to a private address, or simply never answered, which is the
        // most common of the three and the one an operator meets after a typo.
        // Returning `{ pages: [], errors: [1] }` for any of them hands a route
        // something it will answer 200 with an empty page list: an empty result
        // claiming to be the whole site, which is exactly what the settled-URL
        // comment above condemns. Discriminating between them here would give
        // one function two contracts for one event.
        //
        // `pages.length === 0` rather than depth alone, so this says what it
        // means — there is nothing to return — rather than relying on the entry
        // being visited first.
        //
        // **What is thrown is always one of two types, never a raw Playwright
        // error.** An `UnsafeTargetError` — which includes
        // `EntryPointRedirectedError` — goes up untouched, because the type is
        // the whole answer and its message is ours rather than Playwright's.
        // Anything else is wrapped, which is where the call log gets split
        // off: a raw `page.goto` failure carries the URL it was dialling, and
        // the caller nearest that string is the one that should not have to
        // remember to split it. The type is also what stops a `TypeError` of
        // ours being reported to an operator as their site being down — see
        // `EntryPointUnreachableError`.
        if (next.depth === 0 && pages.length === 0) {
          throw error instanceof UnsafeTargetError ? error : new EntryPointUnreachableError(error);
        }

        // Bounded, because nothing else bounds it. `MAX_DISCOVERY_URLS` counts
        // pages, and an errored navigation adds none — so a site of dead links
        // never trips the URL cap while accumulating a full entry per failure.
        // The budget holds it to roughly 240 navigations in practice, so this
        // is a precision fix rather than a memory one, but the whole array is
        // serialised into a response body and served to a browser.
        //
        // Counted, not merely dropped. A bound that discards work and reports
        // nothing is the defect one level up in this same function; `errors`
        // silently stopping at 100 would read as a site with exactly 100
        // problems. It is not a `truncated` reason, though — see
        // `DiscoveryResult.errorsOmitted` for why an incomplete error list says
        // nothing about whether the page list is complete.
        if (errors.length >= MAX_DISCOVERY_ERRORS) {
          errorsOmitted += 1;
          continue;
        }

        errors.push({
          // The *requested* URL, where `pages[].url` is the settled one, and
          // the asymmetry is deliberate rather than an oversight.
          //
          // A page's URL becomes a `goto` step, and a step pointing at a
          // redirector re-pays the hop on every run forever — so a page is
          // recorded where it lives. An error is a diagnosis, and a diagnosis
          // has to name something the operator can find: telling them
          // `elsewhere.test/landed` failed is useless when nothing in their
          // markup says that and `Ctrl-F` finds nothing.
          //
          // The row only reads correctly because both halves are present:
          // `/offsite-redirect.html` plus `Host elsewhere.test is not in the
          // allowed domains` is legible, where `/offsite-redirect.html` alone
          // would read as "your own page is not in your allowed domains",
          // which is nonsense. Do not "fix" this to the settled URL.
          url: next.url,
          // First line only, matching `attemptStep` in `journey-runner.ts`.
          //
          // A Playwright navigation failure carries its whole call log, which
          // includes the URL it was dialling — and a URL harvested from a
          // client's markup routinely has a reset token or a session id in the
          // query. This string is destined for an operator's screen, and
          // `services/logger.ts` redacts by field *name*, so a secret sitting
          // inside a value under the key `message` would travel unredacted.
          message: firstErrorLine(error),
        });
      } finally {
        // Politeness is owed to the next request, so there is no one to be
        // polite to when there is no next request. Unconditional, this charged
        // every crawl 250ms of dead time after its last page and took it from
        // the budget.
        //
        // In `finally` rather than after the block so that every path that made
        // a request pays for it — including the redirect-dedupe `continue`
        // above, which skips the rest of the iteration but not the navigation.
        if (frontier.length > 0) await delay(DISCOVERY_DELAY_MS);
      }
    }
  } finally {
    await browser.close();
  }

  // A link the ceiling refused is itself proof the crawl was cut short, and it
  // is the only proof left once the frontier has been drained to empty.
  //
  // For `url-cap` this is not one of two paths, it is the only one: the
  // top-of-loop `url-cap` branch cannot fire while the ceiling exists, for the
  // reason set out beside it. The `!truncated` guard is about `budget`, which
  // is live and does win here — a crawl that ran out of clock having also
  // dropped links should report the clock, because that is what stopped it.
  if (!truncated && droppedByCeiling > 0) {
    truncated = { reason: 'url-cap', seen: seen.size };
  }

  logInfo('discovery_completed', {
    target: target.origin,
    pages: pages.length,
    errors: errors.length,
    durationMs: Date.now() - startedAt,
    ...(errorsOmitted > 0 ? { errorsOmitted } : {}),
    ...(truncated ? { truncatedReason: truncated.reason, seen: truncated.seen } : {}),
  });

  return {
    pages,
    errors,
    ...(truncated ? { truncated } : {}),
    ...(errorsOmitted > 0 ? { errorsOmitted } : {}),
  };
}
