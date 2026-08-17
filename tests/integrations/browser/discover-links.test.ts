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
      // `elsewhere.test` is mapped as well as `discovery.example`, and the
      // mapping is load-bearing rather than tidy. The off-host redirect below
      // must genuinely resolve, connect and serve, or Chromium fails it with
      // `ERR_NAME_NOT_RESOLVED`, the per-page handler files that as the error,
      // and the test asserting the redirect was refused passes with the check
      // it exists to drive entirely absent.
      args: [
        `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${shared.port},MAP elsewhere.test 127.0.0.1:${shared.port}`,
      ],
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

    // An in-scope URL that lands somewhere else entirely. Ordinary on real
    // sites — SSO, a marketing shortlink — and the reason the settled URL is
    // the one that gets checked.
    //
    // `http:` rather than the `https:` an SSO hop would really use: this
    // server speaks plaintext, and an https redirect target would die in the
    // TLS handshake — which is the same vacuous outcome as a failed DNS
    // lookup. The scheme is not what the assertion is about; the host is.
    if (path === '/offsite-redirect.html') {
      response.writeHead(302, { location: 'http://elsewhere.test/landed' });
      response.end();
      return;
    }

    // Served, and served deliberately: the redirect has to come to rest on a
    // real document, so that the only thing left that can refuse it is the
    // settled-URL check. This branch answers whichever `Host` asked for it,
    // which for `/landed` is only ever `elsewhere.test`.
    if (path === '/landed') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><title>Elsewhere</title><main><h1>Elsewhere</h1></main>');
      return;
    }

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

    expect(paths).toEqual(['/', '/about.html', '/deep.html', '/hostile.html', '/pricing.html']);

    // The one failure is `/offsite-redirect.html`, which is in scope when it is
    // asked for and out of scope by the time it answers. It has its own test
    // below; here it is named so that any *other* error still fails this one.
    expect(result.errors.map((error) => new URL(error.url).pathname)).toEqual([
      '/offsite-redirect.html',
    ]);
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
});
