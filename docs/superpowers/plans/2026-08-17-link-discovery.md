# Link Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an operator one URL and return the site's pages, so a static multi-page site can be audited without hand-writing a `goto` step per page.

**Architecture:** Three units. `domain/discovery.ts` holds pure contracts, caps and URL normalisation (a core now shared with `routeFromPageUrl`). `integrations/browser/discover-links.ts` owns the breadth-first crawl and runs every discovered URL through the three existing SSRF guards. `app/api/platform/discover/route.ts` is the edge. Discovery produces a proposed step list an operator reviews — it never audits, never writes a run, and adds no enforcement at journey creation.

**Tech Stack:** TypeScript, Next.js 16 (App Router), Playwright (`playwright-core`), zod 4, Vitest 4.

**Spec:** [`docs/superpowers/specs/2026-08-17-link-discovery-design.md`](../specs/2026-08-17-link-discovery-design.md)

---

## Read this before Task 1

**Do not add a `services/` module for the crawl.** The spec cut the clustering unit that would have lived there. There is no orchestration in this feature — a crawl is one integration call over pure domain rules — and an empty service to match the shape of other features is a layer with no job.

Operator-facing copy is not an exception to that — it goes in `src/app/platform/lib/discovery-copy.ts`, beside `run-failure-copy.ts`, which is the same job for the same screen and is already reached by the fast suite through `tests/app/`. `services/presentation/` is for product *semantics* with steady-state contracts behind them (whether we may say "pass"); refusal wording is not that.

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
| `src/app/platform/lib/discovery-copy.ts` | Create | Turns the API's error codes into sentences an operator can act on |
| `src/app/platform/components/client/discover-pages.tsx` | Create | Discovery panel: run discovery, tick pages, create journey |
| `src/app/platform/components/client/client-journeys.tsx` | Modify | Mount the panel |
| `fixtures/discovery-site/*.html` | Create | Multi-page static fixture for the crawl tests |
| `tests/domain/discovery.test.ts` | Create | Normalisation and dedupe table |
| `tests/integrations/browser/discover-links.test.ts` | Create | Crawl, guards, bounds, errors |
| `tests/api/discover-route.test.ts` | Create | Auth, schema, branch order, redaction |
| `tests/deploy/browser-routes-are-packaged.test.ts` | Create | A browser route must be traced and memoried |
| `next.config.mjs` / `vercel.json` / `docs/env.md` | Modify | Package the route for Chromium |
| `tests/app/discovery-copy.test.ts` | Create | Every code maps to an actionable sentence |
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

- [ ] **Step 4: Check where the page settled, not where it was asked for**

`page.goto` follows redirects. An in-scope URL that 302s off-host is currently reported as an in-scope page carrying the other host's title — the operator selects it, and the runner's `assertSettledOnTarget` fails the run days later. `journey-runner.ts` has that check; discovery needs its analogue.

Add a redirecting path to the test server. Inside the `createServer` callback in `tests/integrations/browser/discover-links.test.ts`, before the existing file-serving logic:

```ts
    // An in-scope URL that lands somewhere else entirely. Ordinary on real
    // sites — SSO, a marketing shortlink — and the reason the settled URL is
    // the one that gets checked.
    if (request.url === '/offsite-redirect.html') {
      response.writeHead(302, { location: 'https://elsewhere.test/landed' });
      response.end();
      return;
    }
```

Add the link to `fixtures/discovery-site/about.html`, inside `<main>`:

```html
      <a href="/offsite-redirect.html">Offsite redirect</a>
```

**The redirect target must actually resolve, or this test is vacuous.** `elsewhere.test` is a reserved TLD with no resolution, so without the mapping below Chromium fails with `ERR_NAME_NOT_RESOLVED`, `page.goto` rejects, and the existing per-page handler files an error — meaning both assertions pass *with the settled-URL check entirely absent*. Extend the launcher mock's resolver rules so the redirect genuinely lands and serves, leaving `assertAllowedUrl` as the only thing that can refuse it:

```ts
      args: [
        `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${shared.port},MAP elsewhere.test 127.0.0.1:${shared.port}`,
      ],
```

Add the test:

```ts
  it('refuses a page that redirected off the target host', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });
    const offsite = result.errors.find((error) => error.url.includes('offsite-redirect'));

    // Reported as a failure, not as a page. Recording it as in-scope would put
    // a foreign page into a journey under the client's own URL.
    expect(result.pages.some((page) => page.url.includes('offsite-redirect'))).toBe(false);
    expect(result.pages.every((page) => new URL(page.url).hostname === HOST)).toBe(true);

    // On the message, not merely the presence of an error: a DNS failure would
    // also produce an error here, and that is the vacuous version of this test.
    expect(offsite?.message).toMatch(/not in the allowed domains/i);
  }, 60_000);
```

**Prove it non-vacuous before moving on.** Comment out the `assertAllowedUrl(settled, ...)` line you add below and confirm this test fails on the message assertion. If it still passes, the redirect is not resolving and the mapping above did not take effect.

Then make it pass in `src/integrations/browser/discover-links.ts`. After the `page.goto` and the awaited peer checks, before pushing the page:

```ts
        // Where it settled, not where it was asked for. `assertSettledOnTarget`
        // in `journey-runner.ts` exists for the same reason: the allowlist
        // governs where a walk comes to rest, and a redirect is how a request
        // for one host produces a page from another.
        const settled = page.url();
        assertAllowedUrl(settled, allowedHosts);
```

Record `settled` as the page's `url` rather than `next.url` — a `goto` step should point at where the page lives, not at a URL that redirects to it. The `UnsafeTargetError` this throws is caught by the existing per-page handler, which is what puts it in `errors`.

- [ ] **Step 5: Test the take-and-clear behaviour that has no coverage**

Task 3 changed `peerViolation` from sticky to take-and-clear, because a crawl continues where a run stops — a sticky field would report the first bad page's message on every page after it, naming an unrelated URL. That change is currently untested: revert it to sticky and every test in the repo still passes.

In `tests/integrations/browser/discover-links-rebind.test.ts`, add a second case. The server must rebind for **one path only** and serve clean HTML elsewhere, with the entry page linking onward:

```ts
  it('keeps crawling cleanly after one page resolves to a private address', async () => {
    const result = await discoverLinks({ targetUrl: `http://${REBIND_HOST}/` });

    // The violation is recorded once, against the page that caused it.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.url).toContain('/rebound');
    expect(result.errors[0]?.message).toMatch(/127\.0\.0\.1/);

    // And the clean pages either side of it are still reported. A sticky
    // violation would have failed every page after the first, all carrying
    // the first page's message and its URL.
    expect(result.pages.length).toBeGreaterThanOrEqual(2);
    expect(result.pages.every((page) => !page.url.includes('/rebound'))).toBe(true);
  }, 60_000);
```

Structure the fixture so at least two clean pages are visited *after* the rebinding one, or the assertion cannot distinguish sticky from cleared.

- [ ] **Step 6: Run the guard suite**

```bash
npx vitest run --config vitest.browser.config.ts tests/integrations/browser/discover-links.test.ts tests/integrations/browser/discover-links-rebind.test.ts
```

Expected: PASS. Steps 1-3 should pass with no new code — the Task 3 implementation already guards every link, and if any of those fail the guard has a hole to close before moving on. Steps 4 and 5 do require the change above.

- [ ] **Step 7: Commit**

```bash
git add fixtures/discovery-site src/integrations/browser/discover-links.ts tests/integrations/browser/discover-links.test.ts tests/integrations/browser/discover-links-rebind.test.ts
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
```

**The url-cap reason already has coverage.** Task 3 added `tests/integrations/browser/discover-links-truncation.test.ts` when it fixed the frontier ceiling's suppression of truncation, mocking `MAX_DISCOVERY_URLS` down to 2. Do not write a second url-cap test here — read that file first, and if it already asserts what you were about to assert, say so and move on. What is *not* covered is the budget reason, which is the one a real site will almost always report. Retarget this case at `DISCOVERY_BUDGET_MS` instead, mocking it low the same way.

Keep the original url-cap case below only if reading Task 3's file shows a genuine gap; otherwise delete it from this step.

```ts
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

- [ ] **Step 3: Cover what a real static site emits and the fixtures do not**

Every link in `fixtures/discovery-site/` is root-absolute. That means `extractLinks`'s central documented claim — that the browser resolves relative, root-relative and absolute hrefs into one form, so nothing re-implements URL resolution — is asserted in a comment and tested by nothing. Real brochure sites emit relative hrefs constantly.

Add to `fixtures/discovery-site/pricing.html`, inside `<main>`:

```html
      <a href="deep.html">Relative, no leading slash</a>
      <a href="/pricing.html?tab=annual">Same page, different query</a>
```

Then assert both behaviours:

```ts
  it('follows a relative href without re-implementing URL resolution', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });
    const paths = result.pages.map((page) => new URL(page.url).pathname);

    // `deep.html` is reachable root-absolutely from /about.html and relatively
    // from /pricing.html. Either route finding it proves the browser resolved
    // the href; the dedupe assertion below proves both routes agree.
    expect(paths.filter((path) => path === '/deep.html')).toHaveLength(1);
  }, 60_000);

  it('treats a query string as a different page, matching discoveryKey', () => {
    // Deliberately not a crawl: this pins the domain rule the crawl relies on,
    // and the crawl asserting it too would only prove the same function twice.
    expect(discoveryKey('http://x.test/a?tab=annual')).not.toBe(discoveryKey('http://x.test/a'));
  });
```

Import `discoveryKey` from `../../../src/domain/discovery` at the top of the file.

**Also tighten two Task 3 assertions that cannot fail.** Shipping tests that cannot fail sets the local standard, and these are tests:

- *"reports each page once"* asserts `new Set(urls).size === urls.length`. **Read this before deleting it.** That assertion was true by construction when it was written, and Task 4 made it false: `seen` keys on the *requested* URL while `pages` now records the *settled* one, so `/old-pricing` and `/pricing` produce two rows carrying byte-identical `url` strings. It can now fail — on precisely the defect Step 4 below exists to fix. Replace it with an exact `expect(result.pages).toHaveLength(n)`, which is stronger, but do **not** carry away the belief that page uniqueness is guaranteed by construction. It is not, until Step 4 lands.
- *"does not follow mailto or fragment-only links"* asserts every URL starts with the host prefix — but a followed fragment link produces `http://HOST/#main`, which **passes**. The fragment half of its own name is untestable as written. Add `expect(result.pages.every((page) => !page.url.includes('#'))).toBe(true)`.

- [ ] **Step 4: Dedupe a same-host redirect**

The common case, and the one that costs real budget: `/old-pricing` 301s to `/pricing`, so the crawl reports both and navigates twice. Trailing-slash and apex-to-`www` redirects make this ordinary. Task 4 made the crawl *record* the settled URL; this makes it *dedupe* on it.

Add to the test server, beside the off-host redirect from Task 4:

```ts
    if (request.url === '/old-pricing.html') {
      response.writeHead(301, { location: '/pricing.html' });
      response.end();
      return;
    }
```

Link it from `fixtures/discovery-site/about.html`, and assert:

```ts
  it('reports a redirected page once, under the URL it settled on', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });
    const paths = result.pages.map((page) => new URL(page.url).pathname);

    expect(paths.filter((path) => path === '/pricing.html')).toHaveLength(1);
    expect(paths).not.toContain('/old-pricing.html');
  }, 60_000);
```

Make it pass by keying the `seen` set on the settled URL as well as the requested one: after `assertAllowedUrl(settled, allowedHosts)`, compute `discoveryKey(settled)` and, if it differs from the requested key and is already in `seen`, skip the page rather than recording it. Add the settled key to `seen` either way.

**`continue`, not merely skipping the push.** The settled page's links were already harvested when the canonical entry was visited, so re-extracting them is pure waste. Skipping only the push is also *correct*, just slower — pick the fast one deliberately rather than by accident.

**And note what termination does and does not depend on.** The design doc invokes the `routeFromPageUrl` scar, where wrong page identity means a crawl that never ends. That is not the risk here and the distinction is worth keeping straight: `seen` is still keyed on the requested URL, so `/a`→`/b` where `/b` links back to `/a` still short-circuits. What Task 4 created is duplicate *rows*, which is milder — but it is a genuinely new failure mode, and two rows now carry the same URL string where before they carried two different ones. That is what will collide as a React key in Task 8.

- [ ] **Step 5: An entry point that redirects off its own allowlist**

Probed, not theorised. Target `http://www.probe.example/` 302ing to `http://probe.example/` returns `pages: []`, one error, and `truncated: undefined` — a result claiming to be the whole site while holding nothing. `hostAllowed` matches an entry *or any subdomain of it*, so apex→www is fine (`www.acme.com` ends with `.acme.com`) but **www→apex is not**, and www→apex is what a large share of real sites do.

No fixture in this suite can surface this: every fixture host resolves to the host it was asked for, by construction.

Special-case depth 0. If the *entry* page settles outside the allowlist, let the `UnsafeTargetError` propagate out of `discoverLinks` rather than be caught by the per-page handler — an empty crawl is not a crawl, and the caller can say something useful. Task 7 owns the response: it should answer 4xx naming the host the target redirected to, so the operator is told to discover *that* instead. Add a test using a second mapped host.

- [ ] **Step 6: Comment the asymmetry between `pages[].url` and `errors[].url`**

The one load-bearing decision in Task 4 that carries no comment. `pages[].url` is the settled URL because it becomes a `goto` step, and a step pointing at a redirector re-pays the hop on every run forever. `errors[].url` is the *requested* URL because it is a diagnosis — telling an operator that `elsewhere.test/landed` failed is useless when nothing in their markup names it, and `Ctrl-F` finds nothing.

The row only reads correctly because both halves are present: `/offsite-redirect.html` plus `Host elsewhere.test is not in the allowed domains` is legible; `/offsite-redirect.html` alone reads as "your own page is not in your allowed domains", which is nonsense. Comment it at the catch site, or the next person tidying that block will "fix" it to use the settled URL and break diagnosis.

While there, add a clause to `DiscoveryError`'s doc comment: it currently argues at length that `message` must not carry a URL, directly above a `url` field carrying one whole. Both are right — one controlled copy in a field the UI knows is a URL beats a second uncontrolled one buried in prose — but unresolved it reads as though the message-splitting were theatre.

- [ ] **Step 7: Harden the peer-clearing test and index the suite**

Small, and they ride here rather than reopening Task 4.

`discover-links-peer-clearing.test.ts` discriminates on `pathname === REBOUND_PATH`. It degrades loudly if that path stops matching (no violation recorded, the length assertion fails) but **silently** if someone adds a new path to `PAGES` — it falls into the else branch and quietly opts out of the real check. Make the classification total so an unclassified page throws:

```ts
const CLEAN_PATHS = new Set(['/', '/clean-a', '/clean-b']);
// Total rather than binary: a page added to `PAGES` must be classified
// deliberately. Falling into the clean branch by default is how a page
// silently stops being judged on the address it truly reached.
if (pathname !== REBOUND_PATH && !CLEAN_PATHS.has(pathname)) {
  throw new Error(`unclassified page ${pathname}`);
}
```

Also tighten `expect(result.pages.length).toBeGreaterThanOrEqual(2)` to an exact `expect(paths.sort()).toEqual([...])` — the fixture produces a known set, and the loose form cannot notice the crawl failing to reach one of them.

Then add a four-line index to `discover-links.test.ts`'s header. Discovery now has four test files, each existing because its mock graph cannot coexist with the others' — that structure is correct and none should be merged, but `discover-links.test.ts` is the file a newcomer opens first and it points at none of its siblings. Name them and say why they are separate.

Rename `discover-links-peer-clearing.test.ts` to `discover-links-violation-clearing.test.ts` — "peer-clearing" reads as clearing the peer; the subject is clearing `peerViolation` after a refusal.

- [ ] **Step 8: Say which paths the fixture directory does not contain**

`fixtures/discovery-site/` is now served by two servers with different behaviour, and `about.html` links `/offsite-redirect.html`, which exists on disk in neither — a 302 in one test, a plain 404 in another. After this task it will also link `/broken.html` and `/old-pricing.html`. Three of four links pointing at paths that live only inside a server callback is the point where the directory stops defining the site.

Add one HTML comment in `about.html` naming the server-served paths and why they cannot be files: a redirect and a dropped socket are server behaviours, not documents. `hostile.html` is the counter-example done right — it is a real file because it *is* a document.

- [ ] **Step 9: Correct a comment that describes an unreachable state**

Task 3's frontier ceiling made the top-of-loop `url-cap` branch dead code. Proof: the ceiling caps the frontier at `MAX_DISCOVERY_URLS - pages.length`, so `frontier.length - (MAX - pages.length) <= 0` always holds, while the branch needs it `>= 1`. Deleting the branch leaves the whole browser suite green, and a sweep over 576 simulated site shapes never fired it once.

Behaviourally harmless — the post-loop path produces the same result. But the comment beside the post-loop assignment says *"the top-of-loop reason wins where both apply"*, describing a precedence that cannot occur: for `url-cap` the post-loop path is the only path. The top-of-loop **budget** branch is live and correct; only the `url-cap` half is dead.

Either keep the branch as a defensive guard and correct the comment to say its `url-cap` half is unreachable while the ceiling exists, or drop that case and leave `budget`. The false comment is the part that matters — in a codebase at this comment bar, a reader trusts it.

- [ ] **Step 10: Bound the error list**

**Before writing any cap test, read this.** `MAX_LINKS_PER_PAGE` is invisible to a naive test, because both `MAX_DISCOVERY_URLS` and the frontier ceiling sit *below* it: serving 600 links and asserting fewer pages come back passes with the link cap deleted, since the other two bounds do the work. Task 3 already added a boundary-precise test (`/many.html`) that puts the interesting links exactly at the cap edge and 404s them deliberately, so that a *missing page* proves a *dropped link*. Extend that pattern rather than writing a fresh volume test, and prove any new cap test non-vacuous by deleting the cap it targets — one at a time, not all together — and watching it fail.


`MAX_DISCOVERY_URLS` counts pages, and an errored page increments nothing — so a site of dead links never trips the URL cap, and every failure accumulates a full entry in the response body. Bounded in practice by the budget at roughly 240 navigations, so this is a precision fix rather than a memory one, but the response is served to a browser.

Cap `errors` at `MAX_DISCOVERY_URLS` in the crawler, and note in `src/domain/discovery.ts` beside `MAX_DISCOVERY_URLS` that it counts successes and that `errors` carries its own ceiling. Say the same about **deduped** pages while you are there: a page skipped by Step 4 increments nothing either, so a redirect-heavy site performs more navigations than the cap implies.

- [ ] **Step 11: Run it**

```bash
npx vitest run --config vitest.browser.config.ts tests/integrations/browser/discover-links.test.ts
```

Expected: PASS. The truncation and depth cases should already pass against the Task 3 implementation — Task 3 restored url-cap truncation after its frontier ceiling suppressed it, so if `truncated` comes back `undefined` here, that regression has returned rather than the `seen` set being wrong. If `truncated.seen` is not greater than the page count, the seen set is being populated in the wrong place — it must record a URL when it is queued, not when it is visited, or a truncated crawl cannot say how much it had found.

- [ ] **Step 12: Commit**

```bash
git add fixtures/discovery-site src/domain/discovery.ts src/integrations/browser/discover-links.ts tests/integrations/browser/discover-links*.test.ts
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

Three parts, and the first is the one no test can catch after the fact.

**Files:**
- Modify: `next.config.mjs`, `vercel.json`, `docs/env.md`
- Create: `tests/deploy/browser-routes-are-packaged.test.ts`
- Modify: `src/integrations/browser/discover-links.ts` (error types)
- Create: `src/app/api/platform/discover/route.ts`
- Create: `tests/api/discover-route.test.ts`

#### Why the path stays `/api/platform/discover`

Moving it under `clients/` would be covered by the existing tracing glob, and it would also introduce a routing bug. `src/app/api/platform/clients/[clientId]/` is a sibling dynamic segment, and Next resolves a static segment ahead of a dynamic one — so a static `discover/` would permanently shadow the client whose id is `discover`. That id is producible: `clientIdFromName` slugs an operator-typed name, so a client called "Discover" loses its journeys, triage and reports URLs. Silently: no build error, no 404, just the discovery route answering. It would also only half-fix the packaging, because `vercel.json`'s key is `.../clients/**/runs/route.ts`, which a `clients/discover/route.ts` does not match either.

- [ ] **Step 1: Package the route for Chromium**

`next.config.mjs` copies `playwright-core` and `@sparticuz/chromium` beside only two path globs, and `vercel.json` grants `memory: 3009` to three literal paths. This route launches a browser from a path covered by neither, so it would deploy with no browser binaries and default memory — a production-only failure invisible to every suite, which is exactly what the comment already in `next.config.mjs` records paying for twice.

In `next.config.mjs`, inside `outputFileTracingIncludes`, after the `/api/platform/clients/**` entry:

```js
    // The first browser route outside the two subtrees above. Nothing in the
    // route file says "I need the tracer's help" — that knowledge lives only
    // here — which is why `tests/deploy/browser-routes-are-packaged.test.ts`
    // exists rather than a comment asking people to remember.
    '/api/platform/discover/**': [
      './node_modules/playwright-core/**',
      './node_modules/@sparticuz/chromium/**',
    ],
```

In `vercel.json`, inside `functions`:

```json
    "src/app/api/platform/discover/route.ts": {
      "memory": 3009
    },
```

A literal path, not a glob: the wildcard on the `clients` key exists only because `[clientId]` would be read as a character class.

Then update the "Function memory" section of `docs/env.md`, which enumerates the routes that launch Chromium. Left alone it becomes wrong the moment this merges.

- [ ] **Step 2: Stop the next person repeating it**

Create `tests/deploy/browser-routes-are-packaged.test.ts`. Keep it small — its one job is *walk imports, assert coverage*. Do not build a glob engine: `next.config.mjs` is ESM with a default export, so import it and compare keys directly. A hand-rolled matcher would be a third implementation of globbing sitting beside picomatch and Vercel's own.

The shape:

```ts
/**
 * The deployment config knows something the code does not, and nothing checks it.
 *
 * `next.config.mjs` names which routes get the browser packaged beside them;
 * `vercel.json` names which get enough memory to launch it. Both are keyed by
 * path. A route that launches Chromium from a path neither covers builds
 * clean, deploys clean, passes every suite, and dies on its first production
 * request. `next.config.mjs`'s own comment records paying for that twice.
 *
 * Static rather than dynamic on purpose: importing the routes would drag
 * Playwright into the fast suite, which `vitest.config.ts` exists to prevent.
 * `tests/services/log-shape.test.ts` is the precedent for a test that reads
 * the tree rather than running it.
 */
```

- Walk relative, non-`type` imports from each `src/app/api/**/route.ts`, depth-first with a `seen` set (cycles are ordinary here), and collect the routes that reach `src/integrations/browser/launch.ts`.
- Assert each such route has a `next.config.mjs` key whose value mentions both `playwright-core` and `@sparticuz/chromium`, and a `vercel.json` `functions` entry with `memory >= 2048`. Do not hardcode 3009 — `report.pdf` legitimately runs at 2048, and a floor keeps the config as the source of truth rather than duplicating it here.
- Add one non-vacuity assertion: the walk must find `/api/audit/run`. Without it, a resolver that silently stopped resolving would make every other case pass.

**Prove it.** Delete each config key you added in Step 1, one at a time, and confirm the discovery case fails. Restore, re-run.

- [ ] **Step 3: Two error types**

In `src/integrations/browser/discover-links.ts`.

First, give `EntryPointRedirectedError` a **one-argument** constructor that derives its message from `settledHost`. Today the message is built at the only throw site out of the same value the field carries, which permits the two to disagree — silently, since the message never crosses the wire. The message string stays byte-identical.

```ts
  /**
   * One argument, because the message is a function of the host.
   *
   * The sentence lives here rather than at the throw site so the field and the
   * prose cannot drift apart. What the message is *for* is a log line and a
   * stack trace; the route answers with `settledHost` as structured data, and
   * `run-failure.ts` explains why no message crosses the wire.
   */
  constructor(settledHost: string) {
```

Second, add `EntryPointUnreachableError`, thrown at the existing depth-0 site when the failure is **not** an `UnsafeTargetError`:

```ts
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
```

Also export the private `firstLine` as `firstErrorLine`, so the route splits a message with the same function the crawler does rather than a third copy. Same move Task 1 made for `normalizePathname`.

- [ ] **Step 4: Write the route test first**

Create `tests/api/discover-route.test.ts`, following `tests/api/platform-clients.test.ts` and `platform-triage.test.ts` exactly.

**Two things the earlier draft of this plan got wrong, both of which would have failed:**

1. **Mock `principalFromRequest`, not `authorizePrincipal`.** Every suite in `tests/api/` mocks one level deeper so the same-origin/CSRF check and the bearer comparison stay under test. Those are the two things a browser-launching endpoint most needs held.

```ts
const { principalFromRequest } = vi.hoisted(() => ({ principalFromRequest: vi.fn() }));
vi.mock('../../src/app/api/_lib/principal', () => ({ principalFromRequest }));
```

2. **The crawler mock must spread `importOriginal`.** The route does `error instanceof EntryPointRedirectedError`; replacing the module wholesale makes that identifier `undefined` at runtime, and `x instanceof undefined` throws `TypeError` — failing *every* test that reaches the catch block, including ones about private addresses that have nothing to do with redirects.

```ts
const { discoverLinks } = vi.hoisted(() => ({ discoverLinks: vi.fn() }));

vi.mock('../../src/integrations/browser/discover-links', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/integrations/browser/discover-links')>()),
  discoverLinks,
}));

// `importOriginal` loads the real module, which statically imports
// `playwright-core` through `./launch`. Nothing launches a browser, but the
// fast suite's boundary erodes one heavy import at a time.
vi.mock('../../src/integrations/browser/launch', () => ({ launchChromium: vi.fn() }));
```

Local `request(body, headers)`, `fromBrowser(body)` and `fromScript(body)` helpers as the neighbouring files define them. Open with the repo's two standard cases — `refuses an unauthenticated request` and `refuses a cookie carried cross-origin` — each also asserting `discoverLinks` was never called.

Then cover:

- the four `invalid_request_body` shapes (non-URL, non-http scheme, no target, a smuggled `maxUrls`), each asserting nothing was launched
- that `discoverLinks` receives `parsed.targetUrl` — post `'  https://acme.test/  '` and assert the call argument is trimmed, since reading the raw body would buy nothing from the schema
- a successful crawl, with `Object.keys(body)[0] === 'requestId'`
- `truncated` and `errorsOmitted` passed through — a route that dropped them would undo at the last hop the one thing `DiscoveryTruncation` exists to prevent
- `entry_point_redirected` returning `{ error, requestId, host }` and **no** other keys
- **that the redirect case does not fall through to `navigation_not_allowed`** — this is the only thing standing between a future branch-tidying pass and an operator being told a valid address is not allowed
- `entry_point_unreachable` answering **502**
- `navigation_not_allowed` answering 400 with the address absent from the body
- that a Playwright call log carrying a query-string secret reaches neither the response nor the log line

- [ ] **Step 5: Implement the route**

Create `src/app/api/platform/discover/route.ts`. Conventions verified against `platform/clients/[clientId]/triage/route.ts`:

- `const requestId = createRequestId();` as the first line, then `authorizePrincipal`, then the body
- the repo's single-`try` parse idiom, **not** `safeParse`:

```ts
  let parsed: z.infer<typeof discoveryRequestSchema>;
  try {
    parsed = discoveryRequestSchema.parse(await request.json());
  } catch {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }
```

- extra response fields go **after** `requestId`, matching `action_not_allowed_here` and `run_budget_exceeded`
- `export const runtime = 'nodejs'` (Chromium cannot run on edge)
- `export const maxDuration = 300`, with the reasoning written down: the crawl's own 60s budget is checked at the top of each iteration, an in-flight navigation can add Playwright's default 30s, and a cold start unpacks Chromium before any of it. **The inner bound must be the one that fires** — a crawl stopped by its budget returns the pages it found with `truncated`; a crawl stopped by the platform returns a 504 and nothing.
- a comment stating that `consumeRunBudget` is deliberately absent: it lives inside `startRun` and is scoped to audit runs, and sharing the counter would let an afternoon of picking pages exhaust a client's actual audits

The catch block, with the ordering comment as written:

```ts
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
```

| Caught | Answer |
|---|---|
| `EntryPointRedirectedError` | 400 `{ error: 'entry_point_redirected', requestId, host }` |
| `EntryPointUnreachableError` | 502 `{ error: 'entry_point_unreachable', requestId }` |
| `UnsafeTargetError` | 400, code from `classifyRunFailure(error.message, error.name)` |
| anything else | 500 `{ error: 'discovery_failed', requestId }` |

**The last one terminates here and does not rethrow.** No route in `src/app/api/` rethrows, and this one has a specific reason not to start: the errors arriving here are Playwright's, and a navigation failure carries its whole call log including the URL it was dialling. Handing that to whatever catches an uncaught route error hands it to something that applies no redaction. Log `firstErrorLine(error)` and answer a code.

Log the refusals — `logWarn('discovery_refused', { requestId, code, target, settledHost? })` and `logWarn('discovery_failed', { requestId, target, errorName, reason })`. `unauthorized` and `invalid_request_body` stay silent, matching every other route: a caller's typo says nothing about deployment health. `target` is `new URL(parsed.targetUrl).origin` and never the whole URL — `logger.ts` redacts by field *name*, so a token in a query string would travel whole, and the crawler's own `discovery_completed` logs the origin for the same reason. This layer owns the line, not the crawler: `requestId` and the principal are only in hand here, and one owner beats two.

- [ ] **Step 6: Run**

```bash
npx vitest run tests/api/discover-route.test.ts tests/deploy/browser-routes-are-packaged.test.ts
```

Then `npm test` and `npx tsc --noEmit`.

- [ ] **Step 7: Commit**

```bash
git add next.config.mjs vercel.json docs/env.md tests/deploy src/integrations/browser/discover-links.ts src/app/api/platform/discover tests/api/discover-route.test.ts
git commit -m "Serve a proposed page list, packaged so it can actually run"
```

---

### Task 8: The screen

**Files:**
- Create: `src/app/platform/lib/discovery-copy.ts`
- Create: `tests/app/discovery-copy.test.ts`
- Create: `src/app/platform/components/client/discover-pages.tsx`
- Modify: `src/app/platform/components/client/client-journeys.tsx`
- Modify: `tests/integrations/browser/platform-hydration.test.ts`

- [ ] **Step 1: The words**

Create `src/app/platform/lib/discovery-copy.ts` — **not** `services/presentation/`. The precedent is `src/app/platform/lib/run-failure-copy.ts`: operator-facing sentences for one screen's failure codes, already reached by the fast suite through `tests/app/`. `services/presentation/` holds product *semantics* with steady-state contracts behind them — whether the product may say "pass" — and refusal copy is not that.

Use a `switch`, not a `Record` lookup, and say why: `describeRunFailure` had to be repaired after `__proto__` resolved through the prototype chain to a non-string that React renders by throwing, and this code arrives off a parsed JSON body, which is exactly as untrusted.

**Two maps, not one.** `describeDiscoveryFailure(code, details?)` and `describeJourneyCreationFailure(code)` share no codes, and the failures are different events. Answering the create route's `client_not_found` with "check the address and try again" sends an operator back to a URL that already worked — the crawl had succeeded by then.

`describeDiscoveryFailure` must **consume `details.host`** for `entry_point_redirected`. The route ships the host as structured data precisely so this sentence can name it; a version that ignores it leaves the operator to find the destination themselves, which is the work discovery exists to save. Render it as text, never a link, and clip it — the value came from somebody else's redirect.

Also `describeTruncation(truncated)`, `describeErrorTotal(kept, omitted)` and `describeDepth(depth)`.

`describeErrorTotal` must report `kept + omitted` and say when the list is shorter than the count. `errorsOmitted` counts failures the ceiling *discarded*, so a heading built from `errors.length` alone would read as "100 problems" on a site with 300.

`describeTruncation` should say "at least", not a total: `DiscoveryTruncation.seen` documents itself as a floor that errs upward on a redirect-heavy site, so printing it as a count the list below contradicts would be wrong.

Then `tests/app/discovery-copy.test.ts`: every code the route can emit maps to a sentence naming something the operator can act on; an unrecognised code still says discovery did not finish without naming our own bookkeeping; `entry_point_redirected` includes the host when given one and stays sensible without.

- [ ] **Step 2: The panel**

Create `src/app/platform/components/client/discover-pages.tsx`, a `'use client'` component.

**Four corrections to the earlier draft of this plan, each of which would have failed:**

- `detail.id`, **not** `detail.client.id`. `ClientDetail` has `id` at the top level, and `client-journeys.tsx` already passes `clientId={detail.id}` to three children. The draft would not compile.
- `T.ink` / `T.inkMuted`, **not** `T.text`. There is no `T.text`; `T` is `as const`, so it is a type error.
- Derive steps by **filtering `pages` in crawl order**, not by spreading the selection `Set`. `[...selected]` is tick order, so a journey's first step could be a leaf page.
- Capture the origin **when the result lands**, not when the journey is saved. The operator may have edited the address box in between.

Placement: always visible, directly under the `<h2>Journeys</h2>` and above the list — not behind a disclosure. The step editor hides because there is one per row and twenty open forms is chaos; there is exactly one discovery panel and it is now the primary way a journey gets created. Visibility also earns idle-state axe coverage from the existing route sweep with no test registration. Heading `<h3>`, so `heading-order` stays clean.

Markup: one `<fieldset>` with a `<legend>` per depth group, a `<ul>` with `listStyle: 'none'` inside, and an explicit `id`/`htmlFor` pair per checkbox. Depth is said **once per group as prose**, never as a number repeated into forty accessible names. **No scroll container** — that is a scroll trap, and axe's `scrollable-region-focusable` would either fail it or force an extra tab stop ahead of every checkbox; select-all and clear at the top are what make a long list cheap.

Follow the accessibility conventions the neighbouring components already keep at zero violations: `useId()` for every field, a visible `<label htmlFor>` rather than a placeholder or an `aria-label`, `aria-invalid` with `aria-describedby` joining note and error ids, errors as `<p role="alert">`, and a disabled control always accompanied by visible prose saying why.

`role="status"` regions must be **rendered always**, holding an empty string when idle. `run-journey-button.tsx` documents the reason: a live region mounted in the same tick as its text is frequently not announced.

Error rows render `url` **and** `message`. The crawler's own comment explains that either alone is unreadable — the URL alone reads as "your own page is not in your allowed domains", which is nonsense.

The selection cap warning is advisory. `AUDITOR_MAX_PAGES_PER_RUN` stays enforced in the runner, which truncates loudly and logs; re-enforcing it here would put one rule in two places and invalidate stored journeys the day somebody lowered it.

- [ ] **Step 3: Mount it, and fix what it makes untrue**

In `client-journeys.tsx`, render `<DiscoverPages clientId={detail.id} />` above the list. Read the surrounding JSX first and match its wrappers.

Two pieces of prose in that file become false the moment this ships and must be rewritten: the `<Empty>` body, which says "There is no way to record one from these screens yet", and the closing paragraph of the file's header comment, which says creating a journey is still API work. A stale sentence on a screen teaches operators to distrust the screen.

- [ ] **Step 4: Two hydration tests**

Nothing in CI can be crawled: `target-url.ts` blocks loopback and RFC1918 and re-checks every resolved address, so the suite's own `localhost:3417` is refused by design. Stub the crawl with `page.route`; never stub the POST.

The existing route sweep already covers the panel's idle state for free. Add two tests inside the hydration describe:

1. **The maximal state.** One stub carrying pages, errors *and* truncation, then click through to render it and run `AxeBuilder` against it. The precedent is the step editor's inline axe run, added because "the largest form in the product is the one screen the auditor never audits". One stub covers all three markup shapes; a separate refusal test would cost another 120-second browser run to prove wording that `tests/app/discovery-copy.test.ts` already pins.
2. **The write.** Tick pages, name the journey, create it, then assert by reading `GET /journeys` back — not off the screen. The panel clears its own selection on a 201, so a screen assertion would pass against a component that never spoke to the route. Tick deepest-first so the assertion proves steps come back in **crawl** order rather than tick order.

Locator collisions were checked against every existing assertion in that file. Safe, with two constraints: no new journey name may contain `Editable Journey` or `Run Now Journey` as a substring, and no stubbed page *title* may contain a journey name.

- [ ] **Step 5: Build and verify**

```bash
npm run build && npm run test:hydration
```

The suite runs the product's own axe engine over its own screens at **zero** violations. A threshold would be a budget for shipping barriers, which is not a position this product can hold.

- [ ] **Step 6: Commit**

```bash
git add src/app/platform/lib/discovery-copy.ts tests/app/discovery-copy.test.ts src/app/platform/components/client/discover-pages.tsx src/app/platform/components/client/client-journeys.tsx tests/integrations/browser/platform-hydration.test.ts
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

Also point it at a site that canonicalises **www→apex** — `https://www.iana.org/` or similar. Every fixture in the browser suite resolves to the host it was asked for, so the entry-redirect hole from Task 5 Step 5 is invisible to the whole suite by construction, and this is the only place it can be caught.

**Three things Task 7's review says will surprise this run:**

- **A 502 may be our bug, not their site.** A crawler defect raised inside the per-URL try at depth 0 presents as `entry_point_unreachable`. Read the log line's `errorName` before spending the debugging time on DNS.
- **`truncated: { reason: 'budget' }` on a real site is the design working**, not a failure. The domain module predicts 40–45 pages in 60s, not 100. A ~20-page static site should come back untruncated; anything larger will truncate.
- **A local run proves nothing about packaging.** `npm start` passes with no tracing config at all, because the tracer only runs for a real build output. See Step 5.

- [ ] **Step 5: Prove it on a deployed preview**

This is the only step that can verify Task 7 Step 1, and it cannot be skipped in favour of the local run above. `outputFileTracingIncludes` decides which files are copied *beside a deployed function*; nothing local exercises that path, so a local pass is compatible with a completely unpackaged route.

Deploy a Vercel preview, then run the same two discoveries against it — the multi-page static site and the www→apex site. What is being proven:

1. Chromium launches at all on a Vercel function. That has never been observed for this route, and AGENTS.md lists it as an open question for the product generally.
2. 3009 MB is enough for a real crawl's accumulated context, as opposed to a four-page fixture.
3. The `www→apex` entry redirect answers `entry_point_redirected` with the right host, rather than an empty result.

**Ask before deploying.** A deploy is outward-facing and needs the operator's credentials; do not run it unprompted.

- [ ] **Step 6: Record what the run actually measured**

Expected: a 200 with several pages, each carrying a title and depth. Record the page count, the duration and whether `truncated` came back — the spec's estimate of 40–45 pages in 60s is arithmetic, not a measurement, and this is the first real number. If `truncated.reason` is `budget` on a site this small, re-derive the bounds before shipping.

- [ ] **Step 7: Commit any fixes, then report**

Report the actual output of each command. If a suite was skipped, say which and why.

---

## What this plan deliberately does not build

- **Template clustering.** Cut in the spec: it does nothing on a twenty-page site, and a `+37 similar` count is an unvalidated claim about page equivalence. It is a pure function over the `DiscoveredPage[]` this endpoint already returns, so it is additive later against an unchanged contract.
- **sitemap.xml.** A second fetch path and an XML parser, whose URLs would still pass every guard, to find pages link-following already finds at this size.
- **A page-count cap at journey creation.** The runner owns that rule and keeps it.
- **Discovery behind a login**, discovery as a step type, and crawls past the 100-URL ceiling. The last needs a container worker, not a bigger number.
