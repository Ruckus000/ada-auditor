import type { Browser, Page } from 'playwright-core';
import {
  discoveryKey,
  DISCOVERY_BUDGET_MS,
  DISCOVERY_DELAY_MS,
  DISCOVERY_USER_AGENT_PRODUCT,
  MAX_DISCOVERY_DEPTH,
  MAX_DISCOVERY_URLS,
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

export type DiscoverLinksInput = {
  targetUrl: string;
  /** Extra hosts, unioned with the target's own. Same shape as a run's. */
  allowedHosts?: string[];
  headless?: boolean;
};

type Frontier = { url: string; depth: number };

/**
 * Every same-host link on the page, as absolute URLs.
 *
 * Read from the rendered DOM via `href`, which the browser has already
 * resolved against the document — so a relative `about.html`, a root-relative
 * `/about.html` and an absolute URL all arrive in one form and nothing here
 * has to re-implement URL resolution.
 *
 * `mailto:`, `tel:` and friends are dropped by the scheme test rather than by
 * name: an allowlist of two schemes is a rule, a denylist of the ones anybody
 * remembered is a list that grows by incident.
 */
async function extractLinks(page: Page): Promise<string[]> {
  return page.$$eval('a[href]', (anchors) =>
    anchors
      .map((anchor) => (anchor as HTMLAnchorElement).href)
      .filter((href) => href.startsWith('http://') || href.startsWith('https://')),
  );
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
 */
function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.split('\n')[0] ?? '').trim();
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
  const frontier: Frontier[] = [{ url: input.targetUrl, depth: 0 }];
  let truncated: DiscoveryTruncation | undefined;

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

        pages.push({
          url: next.url,
          title: (await page.title()).slice(0, 200),
          depth: next.depth,
        });

        if (next.depth < MAX_DISCOVERY_DEPTH) {
          for (const href of await extractLinks(page)) {
            const key = discoveryKey(href);
            if (seen.has(key)) continue;

            try {
              assertAllowedUrl(href, allowedHosts);
            } catch (error) {
              // Off-scope or a blocked literal address. Not an error worth
              // reporting — a site linking off itself is the normal case —
              // just somewhere this crawl does not go.
              if (error instanceof UnsafeTargetError) continue;
              throw error;
            }

            seen.add(key);
            frontier.push({ url: href, depth: next.depth + 1 });
          }
        }
      } catch (error) {
        errors.push({
          url: next.url,
          // First line only, matching `attemptStep` in `journey-runner.ts`.
          //
          // A Playwright navigation failure carries its whole call log, which
          // includes the URL it was dialling — and a URL harvested from a
          // client's markup routinely has a reset token or a session id in the
          // query. This string is destined for an operator's screen, and
          // `services/logger.ts` redacts by field *name*, so a secret sitting
          // inside a value under the key `message` would travel unredacted.
          message: firstLine(error),
        });
      }

      await delay(DISCOVERY_DELAY_MS);
    }
  } finally {
    await browser.close();
  }

  logInfo('discovery_completed', {
    target: target.origin,
    pages: pages.length,
    errors: errors.length,
    durationMs: Date.now() - startedAt,
    ...(truncated ? { truncatedReason: truncated.reason, seen: truncated.seen } : {}),
  });

  return { pages, errors, ...(truncated ? { truncated } : {}) };
}
