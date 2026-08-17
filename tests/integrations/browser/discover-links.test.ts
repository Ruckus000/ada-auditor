import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MAX_HREF_LENGTH, MAX_LINKS_PER_PAGE } from '../../../src/domain/discovery';

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

/**
 * One export stubbed, and it is worth being precise about which and why.
 *
 * The mapping above sends Chromium to the loopback server, so the address the
 * browser actually connected to is `127.0.0.1` — which
 * `assertPeerAddressAllowed` refuses, correctly. Serving real HTML over real
 * HTTP on this machine means loopback, so a test about *what the crawl finds*
 * cannot also honour the address guard, and the honest move is to stub exactly
 * that one function and say so rather than to weaken it in `src/`. This is the
 * same trade `journey-page-status.test.ts` documents next door.
 *
 * What is *not* stubbed matters as much: `assertSafeTargetUrl`,
 * `assertAllowedUrl` and `UnsafeTargetError` come through untouched via
 * `importOriginal`, so the entry point is still resolved and range-checked and
 * every harvested link is still put through the allowlist. The peer check
 * keeps its own end-to-end coverage over this crawler in
 * `discover-links-rebind.test.ts`, which stubs nothing and asserts the crawl
 * refuses a rebinding host. This file must not become the pattern for avoiding
 * that one.
 */
vi.mock('../../../src/integrations/browser/target-url', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/integrations/browser/target-url')>()),
  assertPeerAddressAllowed: () => {},
}));

const { discoverLinks } = await import('../../../src/integrations/browser/discover-links');

const FIXTURES = join(process.cwd(), 'fixtures/discovery-site');
let server: Server;

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', `http://${HOST}`).pathname;

    // Generated rather than a fixture file, because the shape is the point and
    // the shape is arithmetic: exactly `MAX_LINKS_PER_PAGE` anchors before the
    // two that must not be read. A 500-line HTML file in `fixtures/` would say
    // none of that to whoever opened it next.
    if (path === '/many.html') {
      const anchors = [
        // Anchors 1..499. All one URL, so they cost the crawl a single visit
        // and leave the interesting ones exactly at the boundary.
        ...Array.from({ length: MAX_LINKS_PER_PAGE - 1 }, () => '<a href="/dup.html">Dup</a>'),
        // Anchor 500: inside the count cap, over the length cap.
        `<a href="/long.html?x=${'a'.repeat(MAX_HREF_LENGTH)}">Long</a>`,
        // Anchor 501: the first one past the count cap.
        '<a href="/late.html">Late</a>',
      ].join('');

      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(`<!doctype html><title>Many</title><main>${anchors}</main>`);
      return;
    }

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

  /**
   * The crawler's largest single input is one page's DOM, not its page count,
   * and both caps on it are applied in the page callback where nothing can
   * observe them directly. So they are observed by consequence: a link past
   * either cap is never harvested, so the page it names is never visited.
   *
   * `/dup.html`, `/long.html` and `/late.html` are all 404s, and that is
   * deliberate — a 404 still navigates and still lands in `pages`, so a page
   * missing from the result means the *link* was dropped, which is the claim.
   */
  it('stops reading links at the per-page cap, and drops oversized hrefs', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/many.html` });
    const paths = result.pages.map((page) => new URL(page.url).pathname).sort();

    // Anchor 501 was never read, so nothing knows `/late.html` exists.
    expect(paths).not.toContain('/late.html');
    // Anchor 500 was read and refused on length.
    expect(paths).not.toContain('/long.html');
    // And the 499 that were within both caps still did their job.
    expect(paths).toEqual(['/dup.html', '/many.html']);
  }, 60_000);

  it('does not follow mailto or fragment-only links', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });

    expect(result.pages.every((page) => page.url.startsWith(`http://${HOST}/`))).toBe(true);
  }, 60_000);
});
