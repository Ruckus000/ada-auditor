# Link Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an operator one URL and return the site's pages, so a static multi-page site can be audited without hand-writing a `goto` step per page.

**Architecture:** Three units. `domain/discovery.ts` holds pure contracts, caps and URL normalisation (a core now shared with `routeFromPageUrl`). `integrations/browser/discover-links.ts` owns the breadth-first crawl and runs every discovered URL through the three existing SSRF guards. `app/api/platform/discover/route.ts` is the edge. Discovery produces a proposed step list an operator reviews — it never audits, never writes a run, and adds no enforcement at journey creation.

**Tech Stack:** TypeScript, Next.js 16 (App Router), Playwright (`playwright-core`), zod 4, Vitest 4.

**Spec:** [`docs/superpowers/specs/2026-08-17-link-discovery-design.md`](../specs/2026-08-17-link-discovery-design.md)

---

## Read this before Task 1

**Do not add a `services/` module.** The spec cut the clustering unit that would have lived there. There is no orchestration in this feature — a crawl is one integration call over pure domain rules — and an empty service to match the shape of other features is a layer with no job.

**Do not add a page-count cap to the journeys route.** The spec explains at length why the run's page cap stays in the runner. If you find yourself editing `src/app/api/platform/clients/[clientId]/journeys/route.ts` to refuse a long step list, stop and re-read the "Selection, and one rule in one place" section.

**The fast suite launches no browser.** `tests/domain/**` runs under `npm test`; anything importing Playwright goes in `tests/integrations/browser/**` and runs under `npm run test:browser`. `vitest.config.ts` excludes the browser directory and that exclusion is load-bearing.

**Testing a crawler without a network.** The guards refuse loopback and private addresses, so a plain `http://127.0.0.1:PORT` test server is rejected by design. The codebase already solved this — see `tests/integrations/browser/journey-rebind.test.ts`. Mock `node:dns/promises` so a fake public hostname resolves to a public address, mock `launchChromium` to pass Chromium `--host-resolver-rules=MAP host 127.0.0.1:PORT`, and serve pages from a loopback `node:http` server. Task 3 does this in full; copy it, do not reinvent it.

## File Structure

| Path | Status | Responsibility |
|---|---|---|
| `src/domain/discovery.ts` | Create | Caps, types, request schema, `normalizePathname`, `discoveryKey` |
| `src/integrations/browser/journey-runner.ts` | Modify | `routeFromPageUrl` delegates to `normalizePathname` |
| `src/integrations/browser/discover-links.ts` | Create | BFS crawl, guard enforcement, anchor extraction |
| `src/app/api/platform/discover/route.ts` | Create | Auth, validate, call, respond |
| `src/app/platform/components/client/discover-pages.tsx` | Create | Discovery panel: run discovery, tick pages, create journey |
| `src/app/platform/components/client/client-journeys.tsx` | Modify | Mount the panel |
| `fixtures/discovery-site/*.html` | Create | Multi-page static fixture for the crawl tests |
| `tests/domain/discovery.test.ts` | Create | Normalisation and dedupe table |
| `tests/integrations/browser/discover-links.test.ts` | Create | Crawl, guards, bounds, errors |
| `tests/api/discover-route.test.ts` | Create | Auth, schema, budget isolation |
| `scripts/chaos.ts` | Modify | Blocked-address steady-state assertion |

---

### Task 1: Shared path normalisation

`routeFromPageUrl` in `journey-runner.ts` already collapses `index.html` and trailing slashes. Discovery needs identical collapsing for dedupe identity. Two real call sites with the same meaning — extract the core into domain and have both use it.

Only the path core is shared. Dedupe works on whole URLs and drops fragments; display returns a bare path and keeps `file:` handling. Sharing beyond the overlap would fold two rules into one.

**Files:**
- Create: `src/domain/discovery.ts`
- Create: `tests/domain/discovery.test.ts`
- Modify: `src/integrations/browser/journey-runner.ts` (the `routeFromPageUrl` body, around line 108)

- [ ] **Step 1: Write the failing test**

Create `tests/domain/discovery.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { discoveryKey, normalizePathname } from '../../src/domain/discovery';

describe('normalizePathname', () => {
  it('collapses directory, index.html and bare forms to one path', () => {
    for (const pathname of ['/help', '/help/', '/help/index.html', '/help/index.htm']) {
      expect(normalizePathname(pathname)).toBe('/help');
    }
  });

  it('reduces the site root to /', () => {
    expect(normalizePathname('/')).toBe('/');
    expect(normalizePathname('')).toBe('/');
    expect(normalizePathname('/index.html')).toBe('/');
  });

  it('keeps nested paths intact', () => {
    expect(normalizePathname('/a/b/c/')).toBe('/a/b/c');
  });
});

describe('discoveryKey', () => {
  it('treats the four spellings of one page as one key', () => {
    const keys = new Set(
      [
        'https://acme.test/help',
        'https://acme.test/help/',
        'https://acme.test/help/index.html',
        'https://acme.test/help#top',
      ].map(discoveryKey),
    );

    expect(keys.size).toBe(1);
  });

  it('keeps the query string, because it selects a different page', () => {
    expect(discoveryKey('https://acme.test/search?q=a')).not.toBe(
      discoveryKey('https://acme.test/search?q=b'),
    );
  });

  it('separates hosts and schemes', () => {
    expect(discoveryKey('https://acme.test/a')).not.toBe(discoveryKey('https://other.test/a'));
    expect(discoveryKey('https://acme.test/a')).not.toBe(discoveryKey('http://acme.test/a'));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/domain/discovery.test.ts
```

Expected: FAIL — `Failed to resolve import "../../src/domain/discovery"`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/domain/discovery.ts`:

```ts
/**
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
export function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/index\.html?$/i, '/').replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * The identity a crawl dedupes on: origin + normalised path + query.
 *
 * The fragment is dropped because it names a position within a page, not a
 * page — `/a#intro` and `/a#detail` are one document and one audit. The query
 * is kept because it routinely selects a different one.
 */
export function discoveryKey(rawUrl: string): string {
  const url = new URL(rawUrl);
  return `${url.origin}${normalizePathname(url.pathname)}${url.search}`;
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run tests/domain/discovery.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Point `routeFromPageUrl` at the shared core**

In `src/integrations/browser/journey-runner.ts`, add to the imports at the top:

```ts
import { normalizePathname } from '../../domain/discovery';
```

Then replace the final two lines of the `routeFromPageUrl` body — the ones reading:

```ts
  // `/a/`, `/a/index.html` and `/a` are one page; all three read best as `/a`.
  const trimmed = pathname.replace(/\/index\.html?$/i, '/').replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
```

with:

```ts
  // `/a/`, `/a/index.html` and `/a` are one page; all three read best as `/a`.
  // The rule itself lives in `domain/discovery`, because the crawler dedupes
  // on it and two implementations of "which URLs are the same page" is the
  // kind of drift that ends in a crawl that never terminates.
  return normalizePathname(pathname);
```

Leave the `file:` branch and the whole doc comment above the function exactly as they are.

- [ ] **Step 6: Prove the refactor changed no behaviour**

```bash
npx vitest run --config vitest.browser.config.ts tests/integrations/browser/artifact-path.test.ts
```

Expected: PASS. This file has the existing `routeFromPageUrl` cases including `w3.org/WAI/` → `/WAI` and the three-spellings-of-`/help` case. If it fails, the extraction changed behaviour — fix the extraction, not the test.

- [ ] **Step 7: Commit**

```bash
git add src/domain/discovery.ts tests/domain/discovery.test.ts src/integrations/browser/journey-runner.ts
git commit -m "One answer to which URLs are the same page"
```

---

### Task 2: Discovery contracts and caps

Pure types and constants, and the schema the route validates against. No logic beyond the schema.

**Files:**
- Modify: `src/domain/discovery.ts`
- Modify: `tests/domain/discovery.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/domain/discovery.test.ts`:

```ts
import { discoveryRequestSchema, MAX_DISCOVERY_URLS } from '../../src/domain/discovery';

describe('discoveryRequestSchema', () => {
  it('accepts an http(s) target', () => {
    expect(discoveryRequestSchema.safeParse({ targetUrl: 'https://acme.test' }).success).toBe(true);
  });

  it('refuses a non-URL and a non-http scheme', () => {
    expect(discoveryRequestSchema.safeParse({ targetUrl: 'not-a-url' }).success).toBe(false);
    expect(
      discoveryRequestSchema.safeParse({ targetUrl: 'file:///etc/passwd' }).success,
    ).toBe(false);
  });

  it('refuses unknown keys, so a caller cannot smuggle a cap past the schema', () => {
    expect(
      discoveryRequestSchema.safeParse({ targetUrl: 'https://acme.test', maxUrls: 100_000 }).success,
    ).toBe(false);
  });

  it('caps discovery well above the run page cap of 20', () => {
    expect(MAX_DISCOVERY_URLS).toBeGreaterThan(20);
  });
});
```

Also add `discoveryRequestSchema, MAX_DISCOVERY_URLS` to the existing import at the top of the file rather than leaving two import statements — merge them into one.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/domain/discovery.test.ts
```

Expected: FAIL — `discoveryRequestSchema` is not exported.

- [ ] **Step 3: Implement**

First add the zod import as the **first line** of `src/domain/discovery.ts`, above the existing `normalizePathname` doc comment:

```ts
import { z } from 'zod';
```

Then append the rest to the bottom of the file:

```ts
/**
 * A ceiling that stops a pathological site, not a target the crawl expects to
 * reach. The wall-clock budget binds first on anything real — see below.
 */
export const MAX_DISCOVERY_URLS = 100;

/** How far from the entry page the crawl will walk. */
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

/** Says who we are, so a site operator reading logs can tell. */
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
 * `message` is the navigation failure's **first line only**. Playwright
 * appends a call log naming the URL it was dialling, and discovery's URLs come
 * from a client's own markup, where a query string routinely carries a reset
 * token or a session id. This text is shown to an operator, and
 * `services/logger.ts` redacts by field *name*, so a secret inside a value
 * under the key `message` would travel unredacted. `attemptStep` in
 * `journey-runner.ts` splits for the same reason, at more length.
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
 * `.max(2048)` matches the bound the journeys route already puts on the same
 * field. `journey-step.ts` explains why a size check is a separate question
 * from a shape check and belongs first — parsing junk before refusing it was
 * measured at 210ms against 1ms.
 *
 * Callers must use the **parsed** value, never the raw body: zod trims before
 * validating, so a padded target arrives here clean and arrives at the crawler
 * clean only if the parse output is what gets passed on.
 */
export const discoveryRequestSchema = z
  .object({
    targetUrl: z.url({ protocol: /^https?$/ }).max(2048),
  })
  .strict();
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run tests/domain/discovery.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/discovery.ts tests/domain/discovery.test.ts
git commit -m "Say what a discovery run may be asked for, and what bounds it"
```

---

### Task 3: The crawl, happy path

A breadth-first walk that finds pages and dedupes them. Guards and bounds land in Tasks 4 and 5 — this task proves the walk works.

**Files:**
- Create: `fixtures/discovery-site/index.html`
- Create: `fixtures/discovery-site/about.html`
- Create: `fixtures/discovery-site/pricing.html`
- Create: `fixtures/discovery-site/deep.html`
- Create: `src/integrations/browser/discover-links.ts`
- Create: `tests/integrations/browser/discover-links.test.ts`

- [ ] **Step 1: Create the fixture site**

`fixtures/discovery-site/index.html`:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Home</title></head>
  <body>
    <main>
      <h1>Home</h1>
      <a href="/about.html">About</a>
      <a href="/pricing.html">Pricing</a>
      <a href="/about.html#team">About, again, by fragment</a>
      <a href="#main">Same page</a>
      <a href="mailto:hi@acme.test">Mail</a>
      <a href="https://elsewhere.test/off">Off site</a>
    </main>
  </body>
</html>
```

`fixtures/discovery-site/about.html`:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>About</title></head>
  <body>
    <main>
      <h1>About</h1>
      <a href="/">Home</a>
      <a href="/deep.html">Deep</a>
    </main>
  </body>
</html>
```

`fixtures/discovery-site/pricing.html`:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Pricing</title></head>
  <body><main><h1>Pricing</h1><a href="/">Home</a></main></body>
</html>
```

`fixtures/discovery-site/deep.html`:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Deep</title></head>
  <body><main><h1>Deep</h1><a href="/">Home</a></main></body>
</html>
```

- [ ] **Step 2: Write the failing test**

Create `tests/integrations/browser/discover-links.test.ts`. The DNS and launcher mocks are the pattern from `journey-rebind.test.ts` — a fake hostname that resolves to a public address for Node, mapped to the loopback test server for Chromium.

```ts
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * A crawl with no network.
 *
 * The guards refuse loopback and private addresses, so a test server at
 * `http://127.0.0.1:PORT` is rejected by design and pointing the crawler at it
 * would only prove the guard works. Instead: a hostname that never resolves for
 * real, told to Node's resolver as public — the answer a pre-navigation check
 * would get — and mapped in Chromium to the loopback server.
 */

const HOST = 'discovery.example';
const shared = vi.hoisted(() => ({ port: 0 }));

vi.mock('node:dns/promises', () => ({
  lookup: async (hostname: string) => {
    if (hostname === HOST) return [{ address: '93.184.216.34', family: 4 }];
    throw new Error(`unexpected lookup: ${hostname}`);
  },
}));

vi.mock('../../../src/integrations/browser/launch', () => ({
  launchChromium: async ({ headless = true }: { headless?: boolean } = {}) =>
    chromium.launch({
      headless,
      args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1:${shared.port}`],
    }),
}));

const { discoverLinks } = await import('../../../src/integrations/browser/discover-links');

const FIXTURES = join(process.cwd(), 'fixtures/discovery-site');
let server: Server;

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', `http://${HOST}`).pathname;
    const file = path === '/' ? 'index.html' : path.replace(/^\//, '');

    try {
      const body = await readFile(join(FIXTURES, file), 'utf8');
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/html' });
      response.end('<!doctype html><title>Missing</title><h1>404</h1>');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  shared.port = address.port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe('discoverLinks', () => {
  it('finds every in-scope page reachable from the entry point', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });
    const paths = result.pages.map((page) => new URL(page.url).pathname).sort();

    expect(paths).toEqual(['/', '/about.html', '/deep.html', '/pricing.html']);
    expect(result.errors).toEqual([]);
    expect(result.truncated).toBeUndefined();
  }, 60_000);

  it('reports each page once, whatever spelling the links used', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });
    const keys = result.pages.map((page) => page.url);

    expect(new Set(keys).size).toBe(keys.length);
  }, 60_000);

  it('records the page title and its distance from the entry point', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });
    const byPath = new Map(result.pages.map((page) => [new URL(page.url).pathname, page]));

    expect(byPath.get('/')?.title).toBe('Home');
    expect(byPath.get('/')?.depth).toBe(0);
    expect(byPath.get('/about.html')?.depth).toBe(1);
    // Reachable only via /about.html, so it is one hop further out.
    expect(byPath.get('/deep.html')?.depth).toBe(2);
  }, 60_000);

  it('does not follow mailto or fragment-only links', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });

    expect(result.pages.every((page) => page.url.startsWith(`http://${HOST}/`))).toBe(true);
  }, 60_000);
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run --config vitest.browser.config.ts tests/integrations/browser/discover-links.test.ts
```

Expected: FAIL — cannot resolve `discover-links`.

- [ ] **Step 4: Implement the crawler**

Create `src/integrations/browser/discover-links.ts`:

```ts
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
        if (peerViolation) throw peerViolation;

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
```

- [ ] **Step 5: Run it and watch it pass**

```bash
npx vitest run --config vitest.browser.config.ts tests/integrations/browser/discover-links.test.ts
```

Expected: PASS, 4 tests. If Chromium is missing, run `npm run playwright:install` first.

- [ ] **Step 6: Commit**

```bash
git add fixtures/discovery-site src/integrations/browser/discover-links.ts tests/integrations/browser/discover-links.test.ts
git commit -m "Walk a site from one URL and report the pages"
```

---

### Task 4: The guards hold against hostile markup

Task 3 proved the walk. This proves the walk refuses what it must. These are the tests that matter most in this feature.

**Files:**
- Create: `fixtures/discovery-site/hostile.html`
- Modify: `fixtures/discovery-site/index.html`
- Modify: `tests/integrations/browser/discover-links.test.ts`

- [ ] **Step 1: Add a page whose links point where a crawler must not go**

Create `fixtures/discovery-site/hostile.html`:

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Hostile</title></head>
  <body>
    <main>
      <h1>Hostile</h1>
      <a href="http://169.254.169.254/latest/meta-data/">Cloud metadata</a>
      <a href="http://127.0.0.1:22/">Loopback</a>
      <a href="http://10.0.0.1/admin">Private range</a>
      <a href="http://[::1]:8080/">Loopback, v6</a>
      <a href="https://elsewhere.test/off">Another site</a>
      <a href="/">Home</a>
    </main>
  </body>
</html>
```

Then add one link to `fixtures/discovery-site/index.html`, immediately after the `Pricing` anchor:

```html
      <a href="/hostile.html">Hostile</a>
```

- [ ] **Step 2: Write the failing test**

Append to `tests/integrations/browser/discover-links.test.ts`:

```ts
describe('discoverLinks guards', () => {
  /**
   * The frontier is filled by markup, not by an operator. This is the whole
   * reason discovery re-runs a run's guards on every URL instead of trusting
   * that a link found on the target must belong to the target.
   */
  it('never queues a link to a private, loopback or metadata address', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });
    const visited = result.pages.map((page) => page.url).join(' ');

    for (const forbidden of ['169.254.169.254', '127.0.0.1:22', '10.0.0.1', '[::1]']) {
      expect(visited).not.toContain(forbidden);
    }
  }, 60_000);

  it('reaches the hostile page itself, so the test proves refusal and not absence', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });
    const paths = result.pages.map((page) => new URL(page.url).pathname);

    // If this fails the crawl never got there and the assertion above proved
    // nothing at all.
    expect(paths).toContain('/hostile.html');
  }, 60_000);

  it('stays on the target host', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });

    expect(result.pages.every((page) => new URL(page.url).hostname === HOST)).toBe(true);
  }, 60_000);

  it('refuses an entry point that is off-scheme before launching a browser', async () => {
    await expect(discoverLinks({ targetUrl: 'file:///etc/passwd' })).rejects.toThrow(
      /http or https/i,
    );
  });

  it('refuses an entry point resolving to a private address', async () => {
    await expect(discoverLinks({ targetUrl: 'http://10.0.0.1/' })).rejects.toThrow(
      /private or reserved/i,
    );
  });
});
```

Update the Task 3 expectation that lists every page — `/hostile.html` is now among them:

```ts
    expect(paths).toEqual(['/', '/about.html', '/deep.html', '/hostile.html', '/pricing.html']);
```

- [ ] **Step 3: Run it**

```bash
npx vitest run --config vitest.browser.config.ts tests/integrations/browser/discover-links.test.ts
```

Expected: PASS, 9 tests. The Task 3 implementation already calls `assertAllowedUrl` on every link, so these should pass without new code — that is the point of writing them, and if any fails the guard has a hole to close before moving on.

- [ ] **Step 4: Commit**

```bash
git add fixtures/discovery-site tests/integrations/browser/discover-links.test.ts
git commit -m "Prove the crawler refuses the links a hostile page offers it"
```

---

### Task 5: Bounds and errors

Depth, the URL cap, the budget, and a page that will not load.

**Files:**
- Modify: `fixtures/discovery-site/about.html`
- Modify: `tests/integrations/browser/discover-links.test.ts`

- [ ] **Step 1: Give the crawl a link that genuinely cannot be read**

A 404 is not an error to this crawler — Playwright resolves rather than throws on an HTTP error status, so a missing page is reported as a page with the server's error markup. What produces a real `errors` entry is a connection that dies, so the test server needs a path that hangs up.

In `fixtures/discovery-site/about.html`, add one link inside `<main>`:

```html
      <a href="/broken.html">Broken</a>
```

In `tests/integrations/browser/discover-links.test.ts`, add this as the **first** statement inside the `createServer` callback, before the existing `const path = ...` line:

```ts
    // A connection that dies mid-request, which is what `page.goto` actually
    // throws on. Serving a 404 here would prove nothing: Playwright resolves
    // for any status, so a missing page is a page, not an error.
    if (request.url === '/broken.html') {
      request.socket.destroy();
      return;
    }
```

- [ ] **Step 2: Write the failing test**

Append to `tests/integrations/browser/discover-links.test.ts`. The last two drive the exported constants by mocking the domain module, so the test needs neither a 100-page fixture nor a 60-second wait.

```ts
describe('discoverLinks bounds', () => {
  it('records a page it could not read and finishes the crawl', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.url).toContain('/broken.html');

    // The point of the assertion: one dead link must not end the walk.
    const paths = result.pages.map((page) => new URL(page.url).pathname);
    expect(paths).toContain('/deep.html');
    expect(paths).not.toContain('/broken.html');
  }, 60_000);

  it('reports a truncated crawl rather than implying it saw the whole site', async () => {
    vi.resetModules();
    vi.doMock('../../../src/domain/discovery', async () => {
      const actual = await vi.importActual<typeof import('../../../src/domain/discovery')>(
        '../../../src/domain/discovery',
      );
      return { ...actual, MAX_DISCOVERY_URLS: 2 };
    });

    const { discoverLinks: capped } = await import(
      '../../../src/integrations/browser/discover-links'
    );
    const result = await capped({ targetUrl: `http://${HOST}/` });

    expect(result.pages).toHaveLength(2);
    expect(result.truncated?.reason).toBe('url-cap');
    expect(result.truncated?.seen).toBeGreaterThan(2);

    vi.doUnmock('../../../src/domain/discovery');
    vi.resetModules();
  }, 60_000);

  it('does not walk past the depth limit', async () => {
    vi.resetModules();
    vi.doMock('../../../src/domain/discovery', async () => {
      const actual = await vi.importActual<typeof import('../../../src/domain/discovery')>(
        '../../../src/domain/discovery',
      );
      return { ...actual, MAX_DISCOVERY_DEPTH: 1 };
    });

    const { discoverLinks: shallow } = await import(
      '../../../src/integrations/browser/discover-links'
    );
    const result = await shallow({ targetUrl: `http://${HOST}/` });
    const paths = result.pages.map((page) => new URL(page.url).pathname);

    // /deep.html sits behind /about.html, so depth 1 must not reach it.
    expect(paths).not.toContain('/deep.html');
    // Depth is the crawl's shape, not a shortfall: it is never a truncation.
    expect(result.truncated).toBeUndefined();

    vi.doUnmock('../../../src/domain/discovery');
    vi.resetModules();
  }, 60_000);
});
```

- [ ] **Step 3: Run it**

```bash
npx vitest run --config vitest.browser.config.ts tests/integrations/browser/discover-links.test.ts
```

Expected: PASS, 12 tests. As in Task 4, the Task 3 implementation should already satisfy these. If `truncated.seen` is not greater than the page count, the seen set is being populated in the wrong place — it must record a URL when it is queued, not when it is visited, or a truncated crawl cannot say how much it had found.

- [ ] **Step 4: Commit**

```bash
git add fixtures/discovery-site tests/integrations/browser/discover-links.test.ts
git commit -m "A short crawl says it was short, and how much it had seen"
```

---

### Task 6: The steady-state assertion

That the crawler will not fetch a blocked address is a claim about what this system never does. It belongs in chaos, not only in a unit test.

**Files:**
- Modify: `scripts/chaos.ts`

- [ ] **Step 1: Add the assertion**

In `scripts/chaos.ts`, add to the imports at the top:

```ts
import { discoverLinks } from '../src/integrations/browser/discover-links';
```

Then, inside `main()`, after the `for (const scenario of CHAOS_SCENARIOS)` loop closes and before whatever success line ends the function, insert:

```ts
  // Discovery's frontier is filled by markup rather than by an operator, so
  // "the crawler will not fetch a private address" is a steady-state claim
  // about the product and not merely a property of one function.
  console.log('CHAOS: discovery refuses a private entry point');

  for (const forbidden of [
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:22/',
    'http://10.0.0.1/admin',
  ]) {
    let refused = false;
    try {
      await discoverLinks({ targetUrl: forbidden });
    } catch {
      refused = true;
    }

    if (!refused) {
      fail(`discovery accepted a blocked address: ${forbidden}`);
    }
  }

  logInfo('chaos_discovery_guard_ok', { checked: 3 });
```

- [ ] **Step 2: Run chaos**

```bash
CHAOS_ENABLED=true npm run chaos
```

Expected: the existing scenarios pass as before, then `CHAOS: discovery refuses a private entry point`, then the script exits 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/chaos.ts
git commit -m "Make the crawler's refusal a steady-state claim"
```

---

### Task 7: The route

**Files:**
- Create: `src/app/api/platform/discover/route.ts`
- Create: `tests/api/discover-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/api/discover-route.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

/**
 * The handler with the crawl removed. What is under test is authorisation and
 * validation — a route test that launches Chromium would belong in the browser
 * suite and would be run far less often than it needs to be.
 */
vi.mock('../../src/integrations/browser/discover-links', () => ({
  discoverLinks: vi.fn(async () => ({
    pages: [{ url: 'https://acme.test/', title: 'Home', depth: 0 }],
    errors: [],
  })),
}));

vi.mock('../../src/app/api/_lib/authorize', () => ({
  authorizePrincipal: vi.fn(async (request: Request) =>
    request.headers.get('authorization') === 'Bearer good' ? { kind: 'machine' } : null,
  ),
}));

const { POST } = await import('../../src/app/api/platform/discover/route');
const { discoverLinks } = await import('../../src/integrations/browser/discover-links');

function post(body: unknown, authorized = true): Request {
  return new Request('https://auditor.test/api/platform/discover', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorized ? { authorization: 'Bearer good' } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/platform/discover', () => {
  it('refuses an unauthenticated caller', async () => {
    const response = await POST(post({ targetUrl: 'https://acme.test' }, false));

    expect(response.status).toBe(401);
    expect(discoverLinks).not.toHaveBeenCalled();
  });

  it('refuses a body the schema does not accept', async () => {
    const response = await POST(post({ targetUrl: 'file:///etc/passwd' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_request' });
  });

  it('returns the pages a crawl found', async () => {
    const response = await POST(post({ targetUrl: 'https://acme.test' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      pages: [{ url: 'https://acme.test/', title: 'Home', depth: 0 }],
    });
  });

  it('answers 400 rather than 500 when the target is refused by a guard', async () => {
    vi.mocked(discoverLinks).mockRejectedValueOnce(
      Object.assign(new Error('Target URL resolves to a private or reserved address.'), {
        name: 'UnsafeTargetError',
      }),
    );

    const response = await POST(post({ targetUrl: 'https://acme.test' }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'unsafe_target' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/api/discover-route.test.ts
```

Expected: FAIL — cannot resolve the route module.

- [ ] **Step 3: Implement the route**

Create `src/app/api/platform/discover/route.ts`:

```ts
import { discoveryRequestSchema } from '../../../../domain/discovery';
import { discoverLinks } from '../../../../integrations/browser/discover-links';
import { UnsafeTargetError } from '../../../../integrations/browser/target-url';
import { authorizePrincipal } from '../../_lib/authorize';
import { createRequestId } from '../../_lib/request-id';

/**
 * Discovery renders every page it finds, so it needs the same headroom a run
 * does. `DISCOVERY_BUDGET_MS` stops it well inside this.
 */
export const maxDuration = 300;

/**
 * Propose the pages of a site, for an operator to turn into a journey.
 *
 * **This does not consume the run budget.** `AUDITOR_MAX_RUNS_PER_HOUR` exists
 * because audit runs cost money and the bill is shared; discovery is not a run,
 * and a shared counter would let an afternoon of picking pages exhaust a
 * client's audits. What bounds this is the 60s crawl budget and the operator
 * gate in front of it.
 */
export async function POST(request: Request): Promise<Response> {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'invalid_request', requestId }, { status: 400 });
  }

  const parsed = discoveryRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_request', detail: parsed.error.issues[0]?.message, requestId },
      { status: 400 },
    );
  }

  try {
    const result = await discoverLinks({ targetUrl: parsed.data.targetUrl });
    return Response.json({ requestId, ...result }, { status: 200 });
  } catch (error) {
    // A refused target is the caller naming somewhere we will not go — their
    // problem to fix, not ours to have failed at. 500 here would put an
    // operator's typo in the error budget.
    if (error instanceof UnsafeTargetError || (error as Error)?.name === 'UnsafeTargetError') {
      return Response.json(
        { error: 'unsafe_target', detail: (error as Error).message, requestId },
        { status: 400 },
      );
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run tests/api/discover-route.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/platform/discover tests/api/discover-route.test.ts
git commit -m "Serve a proposed page list to an authenticated operator"
```

---

### Task 8: The screen

A panel on the client journeys screen: enter a URL, see what was found, tick pages, create a journey.

**Files:**
- Create: `src/app/platform/components/client/discover-pages.tsx`
- Modify: `src/app/platform/components/client/client-journeys.tsx`

- [ ] **Step 1: Build the panel**

Create `src/app/platform/components/client/discover-pages.tsx`:

```tsx
'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DiscoveredPage, DiscoveryTruncation } from '../../../../domain/discovery';
import { FONT, T } from '../../lib/tokens';

/**
 * Turn one URL into a journey, without typing a step per page.
 *
 * The list is a *proposal*. Nothing here audits anything and nothing is saved
 * until the operator picks pages and creates the journey — which is what keeps
 * every run a fixed list of steps a person approved, and keeps regression
 * comparison honest across nights.
 */

/**
 * The run's page cap, mirrored for a warning only.
 *
 * Deliberately advisory. The cap belongs to the runner, which truncates loudly
 * and logs `audit_page_cap_reached`; enforcing it here as well would put one
 * rule in two places, and a journey stored today would become invalid the day
 * somebody lowered `AUDITOR_MAX_PAGES_PER_RUN`.
 */
const RUN_PAGE_CAP = 20;

type DiscoveryResponse = {
  pages?: DiscoveredPage[];
  truncated?: DiscoveryTruncation;
  errors?: Array<{ url: string; message: string }>;
  error?: string;
  detail?: string;
};

export function DiscoverPages({ clientId }: { clientId: string }) {
  const router = useRouter();
  const urlFieldId = useId();
  const nameFieldId = useId();

  const [targetUrl, setTargetUrl] = useState('');
  const [journeyName, setJourneyName] = useState('');
  const [pages, setPages] = useState<DiscoveredPage[] | null>(null);
  const [truncated, setTruncated] = useState<DiscoveryTruncation | undefined>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function discover() {
    setBusy(true);
    setProblem(null);
    setPages(null);

    try {
      const response = await fetch('/api/platform/discover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetUrl }),
      });
      const body = (await response.json()) as DiscoveryResponse;

      if (!response.ok) {
        setProblem(body.detail ?? body.error ?? 'Discovery failed.');
        return;
      }

      setPages(body.pages ?? []);
      setTruncated(body.truncated);
      setSelected(new Set((body.pages ?? []).slice(0, RUN_PAGE_CAP).map((page) => page.url)));
    } catch {
      setProblem('Discovery could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  async function createJourney() {
    if (selected.size === 0) return;
    setBusy(true);
    setProblem(null);

    const origin = new URL(targetUrl).origin;
    const steps = [...selected].map((url) => {
      const parsed = new URL(url);
      return {
        action: 'navigate',
        type: 'goto',
        // Origin-absolute. `resolveNavigationUrl` resolves a step's path
        // against the journey's target as a base, so the target must be the
        // bare origin — a target carrying a path silently discards the step's.
        path: `${parsed.pathname}${parsed.search}`,
      };
    });

    try {
      const response = await fetch(`/api/platform/clients/${clientId}/journeys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: journeyName, targetUrl: origin, steps }),
      });

      if (!response.ok) {
        const body = (await response.json()) as DiscoveryResponse;
        setProblem(body.detail ?? body.error ?? 'The journey could not be created.');
        return;
      }

      setPages(null);
      setSelected(new Set());
      setJourneyName('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function toggle(url: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  const overCap = selected.size > RUN_PAGE_CAP;

  return (
    <section style={{ fontFamily: FONT.sans, color: T.text }}>
      <h3>Find pages</h3>

      <label htmlFor={urlFieldId}>Site URL</label>
      <input
        id={urlFieldId}
        type="url"
        value={targetUrl}
        onChange={(event) => setTargetUrl(event.target.value)}
        placeholder="https://example.com"
      />
      <button type="button" onClick={discover} disabled={busy || targetUrl.trim() === ''}>
        {busy ? 'Looking…' : 'Find pages'}
      </button>

      {problem === null ? null : <p role="alert">{problem}</p>}

      {pages === null ? null : (
        <>
          {truncated === undefined ? null : (
            <p role="status">
              Stopped after {truncated.seen} pages ({truncated.reason === 'budget'
                ? 'time limit'
                : 'page limit'}). This is not the whole site.
            </p>
          )}

          {pages.length === 0 ? (
            <p>No pages were found.</p>
          ) : (
            <>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {pages.map((page) => (
                  <li key={page.url}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.has(page.url)}
                        onChange={() => toggle(page.url)}
                      />
                      <span>{new URL(page.url).pathname}</span>
                      <span> — {page.title}</span>
                    </label>
                  </li>
                ))}
              </ul>

              {overCap ? (
                <p role="status">
                  {selected.size} pages selected. A run audits the first {RUN_PAGE_CAP} and
                  reports the rest as truncated.
                </p>
              ) : null}

              <label htmlFor={nameFieldId}>Journey name</label>
              <input
                id={nameFieldId}
                type="text"
                value={journeyName}
                onChange={(event) => setJourneyName(event.target.value)}
              />
              <button
                type="button"
                onClick={createJourney}
                disabled={busy || selected.size === 0 || journeyName.trim() === ''}
              >
                Create journey from {selected.size} pages
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Mount it**

In `src/app/platform/components/client/client-journeys.tsx`, add to the imports:

```tsx
import { DiscoverPages } from './discover-pages';
```

Then render `<DiscoverPages clientId={detail.client.id} />` inside the `ClientJourneys` return, above the existing journey list. Read the surrounding JSX first and match its wrapper elements and token usage — do not paste it in bare if every sibling sits inside a card element.

- [ ] **Step 3: Build and check hydration**

```bash
npm run build && npm run test:hydration
```

Expected: PASS. The hydration suite runs the product's own axe engine over its own screens at **zero** violations, so a missing label or an unlabelled control fails here. If it does, fix the markup — the threshold is not negotiable.

- [ ] **Step 4: Commit**

```bash
git add src/app/platform/components/client/discover-pages.tsx src/app/platform/components/client/client-journeys.tsx
git commit -m "Pick pages from a list instead of typing a step for each"
```

---

### Task 9: Full verification

No claim of done without fresh evidence from every suite.

- [ ] **Step 1: Run everything**

```bash
npm test && npm run test:browser && npm run build && npm run test:hydration
```

- [ ] **Step 2: Run chaos**

```bash
CHAOS_ENABLED=true npm run chaos
```

- [ ] **Step 3: Run the database suite if a database is configured**

```bash
npm run test:db
```

Skip only if `DATABASE_URL` is unset, and say so rather than reporting a pass.

- [ ] **Step 4: Drive it against a real site**

Discovery has never met a site that was not a fixture, and the unit suites load modules unbundled — a packaging fault is invisible to them. Start the built server and exercise the real route:

```bash
npm run build && npm start
```

Then, in another shell:

```bash
curl -s -X POST http://localhost:3000/api/platform/discover -H "authorization: Bearer $AUDITOR_RUN_TOKEN" -H 'content-type: application/json' -d '{"targetUrl":"https://www.w3.org/WAI/demos/bad/"}' | head -60
```

Expected: a 200 with several pages, each carrying a title and depth. Record the page count, the duration and whether `truncated` came back — the spec's estimate of 40–45 pages in 60s is arithmetic, not a measurement, and this is the first real number. If `truncated.reason` is `budget` on a site this small, re-derive the bounds before shipping.

- [ ] **Step 5: Commit any fixes, then report**

Report the actual output of each command. If a suite was skipped, say which and why.

---

## What this plan deliberately does not build

- **Template clustering.** Cut in the spec: it does nothing on a twenty-page site, and a `+37 similar` count is an unvalidated claim about page equivalence. It is a pure function over the `DiscoveredPage[]` this endpoint already returns, so it is additive later against an unchanged contract.
- **sitemap.xml.** A second fetch path and an XML parser, whose URLs would still pass every guard, to find pages link-following already finds at this size.
- **A page-count cap at journey creation.** The runner owns that rule and keeps it.
- **Discovery behind a login**, discovery as a step type, and crawls past the 100-URL ceiling. The last needs a container worker, not a bigger number.
