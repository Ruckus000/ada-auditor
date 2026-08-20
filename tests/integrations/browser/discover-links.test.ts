import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { discoveryKey, MAX_HREF_LENGTH, MAX_LINKS_PER_PAGE } from '../../../src/domain/discovery';

/**
 * A crawl with no network.
 *
 * The guards refuse loopback and private addresses, so a test server at
 * `http://127.0.0.1:PORT` is rejected by design and pointing the crawler at it
 * would only prove the guard works. Instead: a hostname that never resolves for
 * real, told to Node's resolver as public — the answer a pre-navigation check
 * would get — and mapped in Chromium to the loopback server.
 *
 * **Discovery's other three test files, and why none of them belong here.**
 * Each exists because its mock graph cannot coexist with this one's, so merging
 * any of them would cost the coverage it was written for:
 *
 *   - `discover-links-rebind.test.ts` — stubs *nothing*, so the peer check runs
 *     for real end to end. This file stubs `assertPeerAddressAllowed` (see
 *     below) and must never become the reason that one weakens.
 *   - `discover-links-violation-clearing.test.ts` — needs clean pages *after* a
 *     refused one, which no locally-served page can be, so it varies the peer
 *     check's input per path rather than replacing it.
 *   - `discover-links-truncation.test.ts` — mocks `MAX_DISCOVERY_URLS` down to
 *     2 for the whole module, which would break every assertion here about
 *     finding the whole site.
 */

const HOST = 'discovery.example';

/**
 * The same site under its `www` name, which 302s to the apex — see the entry
 * point test at the bottom. A second *mapped* host is the only way to reach
 * that case: every other host in this suite resolves to the host it was asked
 * for, by construction, so no fixture can produce a settled entry point on a
 * host the allowlist refuses.
 */
const WWW_HOST = `www.${HOST}`;

/**
 * A name inside the target's domain that resolves into private space.
 *
 * Mapped in Chromium's resolver to the same loopback server as every other
 * host here, so that a crawler which fails to refuse it *succeeds* in reaching
 * it — the server records the `Host` it was asked for, and the test asserts
 * that name never arrives. A hostname that simply failed to resolve would make
 * the test pass with the guard deleted.
 */
const INTERNAL_HOST = `internal.${HOST}`;

const shared = vi.hoisted(() => ({ port: 0 }));

vi.mock('node:dns/promises', () => ({
  lookup: async (hostname: string) => {
    if (hostname === HOST || hostname === `www.${HOST}`) {
      return [{ address: '93.184.216.34', family: 4 }];
    }
    // The whole point of `INTERNAL_HOST`: a public-looking name in the
    // target's own domain, answering with an address inside RFC1918.
    if (hostname === INTERNAL_HOST) {
      return [{ address: '10.0.0.5', family: 4 }];
    }
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
        `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${shared.port},MAP elsewhere.test 127.0.0.1:${shared.port},MAP www.${HOST} 127.0.0.1:${shared.port},MAP ${INTERNAL_HOST} 127.0.0.1:${shared.port}`,
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

const { discoverLinks, EntryPointRedirectedError } = await import(
  '../../../src/integrations/browser/discover-links'
);
// Through the mocked module, which spreads the original — so this is the same
// class `discover-links` throws, and `instanceof` below is judging for real.
const { UnsafeTargetError } = await import('../../../src/integrations/browser/target-url');

const FIXTURES = join(process.cwd(), 'fixtures/discovery-site');
let server: Server;
const requestedHosts: string[] = [];

/** Path and query, which together are what this crawl calls one page. */
function locationOf(rawUrl: string): string {
  const url = new URL(rawUrl);
  return `${url.pathname}${url.search}`;
}

beforeAll(async () => {
  server = createServer(async (request, response) => {
    // A connection that dies mid-request, which is what `page.goto` actually
    // throws on. Serving a 404 here would prove nothing: Playwright resolves
    // for any status, so a missing page is a page, not an error.
    //
    // `/dropped-*.html` are the same thing in bulk, for the errors-cap case.
    if (request.url === '/broken.html' || request.url?.startsWith('/dropped-')) {
      request.socket.destroy();
      return;
    }

    // Every host the server is actually asked for. The guard under test is
    // supposed to stop a request being made at all, and the only witness to
    // that is the server it would have reached.
    requestedHosts.push((request.headers.host ?? '').split(':')[0]);

    // The whole site under `www`, canonicalising to the apex. Discriminated on
    // the `Host` header rather than the path because the *host* is the point:
    // both names serve the same paths, and only the name the browser asked for
    // distinguishes them.
    if ((request.headers.host ?? '').split(':')[0] === WWW_HOST) {
      response.writeHead(302, { location: `http://${HOST}/` });
      response.end();
      return;
    }

    const path = new URL(request.url ?? '/', `http://${HOST}`).pathname;

    // The everyday same-host redirect: a renamed page kept alive by a 301.
    // Trailing slashes and apex-to-www make this shape ordinary, and it is the
    // one that costs real budget, because without deduping on where a page
    // settles the crawl reports it twice and navigates to it twice.
    if (path === '/old-pricing.html') {
      response.writeHead(301, { location: '/pricing.html' });
      response.end();
      return;
    }

    // Two pages of dead links, shaped so that the errors outnumber a lowered
    // `MAX_DISCOVERY_URLS` — see the errors-cap test for the arithmetic. Not a
    // fixture file, because the shape is the claim and a file would say none of
    // it: three dead links *then* the next hub, so the frontier drains to empty
    // before the second hub is visited and the ceiling lets it refill.
    if (path === '/dead-hub.html' || path === '/dead-hub-2.html') {
      const first = path === '/dead-hub.html';
      const dead = (first ? [1, 2, 3] : [4, 5, 6])
        .map((n) => `<a href="/dropped-${n}.html">Dead ${n}</a>`)
        .join('');
      const nextHub = first ? '<a href="/dead-hub-2.html">Next hub</a>' : '';

      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(`<!doctype html><title>Dead hub</title><main>${dead}${nextHub}</main>`);
      return;
    }

    // An entry point that comes to rest on a blocked literal address. The
    // redirect target is this same server named as `127.0.0.1`, so the
    // navigation genuinely settles there and the only guard left standing is
    // the settled-URL check — which must report it as the refusal it is, not
    // as a canonicalisation to follow.
    if (path === '/loopback-redirect.html') {
      response.writeHead(302, { location: `http://127.0.0.1:${shared.port}/landed` });
      response.end();
      return;
    }

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
    const paths = result.pages.map((page) => locationOf(page.url)).sort();

    // Path *and* query, because `?tab=annual` is a page here and a bare
    // pathname would silently collapse it onto `/pricing.html`.
    expect(paths).toEqual([
      '/',
      '/about.html',
      '/deep.html',
      '/docs/guide.html',
      '/docs/handbook.html',
      '/hostile.html',
      '/pricing.html',
      '/pricing.html?tab=annual',
    ]);

    // Two failures, both of which have their own tests below: a page that is in
    // scope when it is asked for and out of scope by the time it answers, and a
    // connection that dies. Named here so that any *other* error fails this one.
    expect(result.errors.map((error) => new URL(error.url).pathname).sort()).toEqual([
      '/broken.html',
      '/offsite-redirect.html',
    ]);
    expect(result.truncated).toBeUndefined();
  }, 60_000);

  it('reports each page once, whatever spelling the links used', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });

    // An exact count, not `new Set(urls).size === urls.length`.
    //
    // That set assertion was true by construction when it was written and is
    // not any more: `seen` keys on the URL a page was *requested* under while
    // `pages` records the one it *settled* on, so `/old-pricing.html` and
    // `/pricing.html` would produce two rows carrying byte-identical `url`
    // strings — which is precisely the defect the redirect dedupe fixes, and
    // precisely what a set of URLs cannot see. Page uniqueness is a property
    // the crawler maintains, not one the shape of the data guarantees.
    expect(result.pages).toHaveLength(8);
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

    // The fragment half of this test's name, which the line above cannot make.
    // A followed `#main` produces `http://HOST/#main`, and that starts with the
    // host prefix like everything else — so without this the crawl could be
    // walking every fragment on the site and the assertion would still pass.
    expect(result.pages.every((page) => !page.url.includes('#'))).toBe(true);
  }, 60_000);

  it('agrees on one page when two pages spell its link differently', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });
    const paths = result.pages.map((page) => locationOf(page.url));

    // `/deep.html` is linked root-absolutely from /about.html and relatively
    // from /pricing.html, and comes back once — the two spellings agree.
    //
    // Named for what it is. It was called a test of relative-href *resolution*,
    // which it is not: deleting the relative link leaves it green, because the
    // root-absolute route finds the page anyway. Resolution has its own test
    // below, on the only link here whose two possible answers differ.
    expect(paths.filter((path) => path === '/deep.html')).toHaveLength(1);
  }, 60_000);

  it('resolves a relative href against the document, not the origin', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });
    const paths = result.pages.map((page) => locationOf(page.url));

    // `/docs/guide.html` links `handbook.html`, whose two candidate resolutions
    // differ: `/docs/handbook.html` against the document, `/handbook.html`
    // against the origin. That is what `extractLinks` claims the browser does
    // for it, and until this fixture nothing in the suite could tell.
    expect(paths).toContain('/docs/handbook.html');

    // Load-bearing, and the half a "did we find it" assertion would miss.
    // Playwright resolves for any status, so a mis-resolution does not make a
    // page vanish — `/handbook.html` would 404 and arrive as an *extra* page
    // sitting beside the right one, leaving the line above true.
    expect(paths).not.toContain('/handbook.html');
  }, 60_000);

  it('treats a query string as a different page, matching discoveryKey', () => {
    // Deliberately not a crawl: this pins the domain rule the crawl relies on,
    // and the crawl asserting it too would only prove the same function twice.
    expect(discoveryKey('http://x.test/a?tab=annual')).not.toBe(discoveryKey('http://x.test/a'));
  });

  it('reports a redirected page once, under the URL it settled on', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });
    const paths = result.pages.map((page) => locationOf(page.url));

    // On path *and* query rather than pathname alone: `/pricing.html?tab=annual`
    // is a second legitimate page sharing the pathname, so counting pathnames
    // would count it as the duplicate this test is looking for and pass with the
    // dedupe removed.
    expect(paths.filter((path) => path === '/pricing.html')).toHaveLength(1);
    expect(paths).not.toContain('/old-pricing.html');
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

  /**
   * The guard the hostile fixture could not test.
   *
   * Every link in `hostile.html` is a literal address, and `assertAllowedUrl`
   * refuses those synchronously — twice over, since a literal also fails the
   * host allowlist. So the crawl's guards looked complete while the check that
   * matters for a *named* host was missing entirely.
   *
   * `assertAllowedUrl` resolves nothing. A link to a subdomain of the target
   * satisfies the allowlist and is not a literal, so before this the crawler
   * put it straight on the frontier and dialled it, whatever it resolved to.
   * `journey-runner` has never done that: every operator-authored `goto` goes
   * through `assertSafeTargetUrl`. The weaker check was reserved for the URLs
   * an audited page wrote, which is the wrong way round.
   *
   * The peer check is not what saves this, and is stubbed out in this file
   * anyway. It inspects `response.serverAddr()` *after* Chromium has connected
   * and sent the request — it can record an internal visit, not prevent one,
   * and for an endpoint that acts on a GET that distinction is the whole
   * vulnerability.
   *
   * The assertion is on the server, not on the result: `INTERNAL_HOST` is
   * mapped to this very server, so a crawler that fails to refuse it reaches
   * it and the `Host` header arrives. Asserting only that no page came back
   * would pass with the guard deleted, because the response is discarded
   * either way.
   */
  it('never dials a named host inside the target that resolves into private space', async () => {
    requestedHosts.length = 0;

    const result = await discoverLinks({
      targetUrl: `http://${HOST}/internal-link.html`,
    });

    // The request was never made.
    expect(requestedHosts).not.toContain(INTERNAL_HOST);
    // And the server was genuinely reachable under that name, so the assertion
    // above is about the guard rather than about a dead mapping.
    expect(requestedHosts).toContain(HOST);

    // Refused, not silently skipped. An in-scope link into private space is a
    // fact about the operator's own markup, and it produced an error row
    // before this guard existed — from the peer check, after the visit. Losing
    // the diagnosis to gain the refusal would trade one defect for another.
    //
    // Exactly one row, and the fixture links to it twice on purpose. Recording
    // before marking the URL seen files a row per occurrence, so a nav bar
    // carrying one internal link across forty pages would file forty identical
    // rows and spend the error budget real diagnoses need.
    const refused = result.errors.filter((error) => error.url.includes(INTERNAL_HOST));
    expect(refused, 'the refused link should be reported').toHaveLength(1);
    expect(refused[0].message).toMatch(/private or reserved address/);

    // And it is not among the pages an operator could pick.
    expect(result.pages.some((page) => page.url.includes(INTERNAL_HOST))).toBe(false);
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

  /**
   * The entry point is the one page whose redirect cannot be filed as an error
   * and walked past. `hostAllowed` matches an allowlist entry or any subdomain
   * of it, so apex→www is fine and www→apex is not — and www→apex is what a
   * large share of real sites do. Handled as an ordinary page failure it
   * returns zero pages, one error and no truncation: an empty result claiming
   * to be the whole site.
   *
   * This needs a second *mapped* host and cannot be reached any other way:
   * every other host in this suite resolves to the host it was asked for.
   */
  it('refuses an entry point that redirects off its own allowlist', async () => {
    const failure = await discoverLinks({ targetUrl: `http://${WWW_HOST}/` }).catch(
      (error: unknown) => error,
    );

    // The type, and the host as a *field*. A DNS failure or a dead connection
    // would also reject here — that is the vacuous version of this test — and
    // only the settled host proves the redirect was followed and then refused.
    // Task 7 answers from this field rather than by matching prose, which is
    // what `run-failure.ts` records the cost of getting wrong.
    expect(failure).toBeInstanceOf(EntryPointRedirectedError);
    expect((failure as InstanceType<typeof EntryPointRedirectedError>).settledHost).toBe(HOST);

    // `name` stays the parent's, because `classifyRunFailure` keys on it and
    // maps that one string to `navigation_not_allowed` — the right answer here
    // too. Overriding it would silently drop this into the uncategorised bucket.
    expect((failure as Error).name).toBe('UnsafeTargetError');
  }, 60_000);

  /**
   * The other way an entry point can settle wrong, and the one the polite
   * answer must never cover. `EntryPointRedirectedError` exists so a refusal
   * can end with "Discover <host> instead" — and a target that redirects to
   * `127.0.0.1` (or the cloud metadata address) would put a private address in
   * that sentence: an SSRF refusal reported as a benign redirect, with our own
   * copy advising the operator to point the crawler at the address the guard
   * exists to refuse.
   *
   * The peer check is stubbed out in this file, so the settled-URL check is
   * the only thing standing between this navigation and a page result — which
   * is exactly the configuration that proves the settled check itself makes
   * the distinction, rather than being rescued by the peer check upstream.
   */
  it('refuses an entry point that redirects to a private address as a refusal, not a redirect', async () => {
    const failure: unknown = await discoverLinks({
      targetUrl: `http://${HOST}/loopback-redirect.html`,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UnsafeTargetError);
    expect(failure).not.toBeInstanceOf(EntryPointRedirectedError);
    // The sentence that must not be said: advice to discover a private address.
    expect((failure as Error).message).not.toMatch(/discover/i);
  }, 60_000);

  it('names the request its completion log belongs to', async () => {
    // `discovery_completed` carries the duration and the page count, and this
    // is the only place that knows either — but the request id lives only in
    // the route. Without it threaded through, a slow crawl is a log line with
    // no way back to the response an operator is holding, which is exactly the
    // question a real-site run asks first.
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    let lines: string[];
    try {
      await discoverLinks({ targetUrl: `http://${HOST}/about.html`, requestId: 'req-42' });
    } finally {
      // Read before restoring: `mockRestore` clears `mock.calls` as well as
      // putting the original back.
      lines = log.mock.calls.flat().map(String);
      log.mockRestore();
    }

    const completed = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.type === 'discovery_completed');

    expect(completed).toMatchObject({ requestId: 'req-42', target: `http://${HOST}` });
  }, 60_000);

  it('refuses an entry point that never answered, rather than returning an empty crawl', async () => {
    // The most common entry failure of the three — a dead server, a timeout, a
    // typo'd host — and the one that used to come back as `{ pages: [] }` with
    // no truncation, which a route would answer 200. One contract: a crawl or a
    // throw.
    await expect(discoverLinks({ targetUrl: `http://${HOST}/broken.html` })).rejects.toThrow(
      /net::ERR_/,
    );
  }, 60_000);
});

/**
 * The bounds, driven by mocking the exported constants rather than by building
 * a site large enough or slow enough to reach them for real — so none of this
 * needs a 100-page fixture or a 60-second wait.
 *
 * The URL cap is deliberately absent: `discover-links-truncation.test.ts`
 * already mocks `MAX_DISCOVERY_URLS` to 2 and asserts the `url-cap` reason and
 * a `seen` count above the page count. Repeating it here would prove the same
 * thing twice. What that file cannot say is what the *budget* does, which is
 * the reason a real crawl will almost always report.
 */
describe('discoverLinks bounds', () => {
  it('records a page it could not read and finishes the crawl', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });
    const broken = result.errors.find((error) => error.url.includes('/broken.html'));

    expect(broken).toBeDefined();

    // The point of the assertion: one dead link must not end the walk.
    // `/deep.html` is queued from the same page as `/broken.html`.
    const paths = result.pages.map((page) => locationOf(page.url));
    expect(paths).toContain('/deep.html');
    expect(paths).not.toContain('/broken.html');
  }, 60_000);

  it('reports a crawl cut short by the clock rather than implying it saw the whole site', async () => {
    vi.resetModules();
    vi.doMock('../../../src/domain/discovery', async () => {
      const actual = await vi.importActual<typeof import('../../../src/domain/discovery')>(
        '../../../src/domain/discovery',
      );
      return { ...actual, DISCOVERY_BUDGET_MS: 1 };
    });

    const { discoverLinks: rushed } = await import(
      '../../../src/integrations/browser/discover-links'
    );
    const result = await rushed({ targetUrl: `http://${HOST}/` });

    // Zero pages, and deterministically so: the budget is checked at the top of
    // the loop, and launching a browser costs far more than a millisecond. A
    // budget large enough to admit some pages and not others would be a race
    // against the machine the suite runs on.
    //
    // Which makes this the honest counterpart to the entry-redirect case above:
    // an empty result is fine as long as it does not claim to be the whole site.
    expect(result.pages).toEqual([]);
    expect(result.truncated?.reason).toBe('budget');
    expect(result.truncated?.seen).toBeGreaterThan(0);

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
    const paths = result.pages.map((page) => locationOf(page.url)).sort();

    // /deep.html sits behind /about.html, so depth 1 must not reach it. The
    // exact set says the same thing from the other side: the depth-1 pages are
    // all still visited, so this is a boundary and not a stalled crawl.
    expect(paths).toEqual([
      '/',
      '/about.html',
      '/docs/guide.html',
      '/hostile.html',
      '/pricing.html',
    ]);
    expect(paths).not.toContain('/deep.html');
    // Depth is the crawl's shape, not a shortfall: it is never a truncation.
    expect(result.truncated).toBeUndefined();

    vi.doUnmock('../../../src/domain/discovery');
    vi.resetModules();
  }, 60_000);

  /**
   * Errors need a ceiling of their own because `MAX_DISCOVERY_URLS` counts
   * pages and a failed navigation adds none — so a site of dead links never
   * trips it while filing a full entry per failure into a response body.
   *
   * Boundary-precise rather than a volume test, for the reason `/many.html`
   * next door is: with the cap lowered to 5, this shape produces exactly 6
   * errors, so the cap is the *only* thing that can make the answer 5. The
   * arithmetic, which the fixture's ordering exists to arrange:
   *
   *   - `/dead-hub.html` is the entry (1 page). The frontier ceiling admits
   *     links while `frontier.length < 5 - 1`, so all four of its links queue.
   *   - Its three dead links error and drain the frontier to just the hub link.
   *   - `/dead-hub-2.html` loads (2 pages), and with the frontier empty the
   *     ceiling — now `< 5 - 2` — admits its three dead links.
   *   - Those error too: six failures against a cap of five.
   */
  it('stops accumulating errors at the cap, on a site that is all dead links', async () => {
    vi.resetModules();
    vi.doMock('../../../src/domain/discovery', async () => {
      const actual = await vi.importActual<typeof import('../../../src/domain/discovery')>(
        '../../../src/domain/discovery',
      );
      // Both, and they are not the same knob — which this test proves by
      // needing both set. `MAX_DISCOVERY_URLS` shapes the frontier, and the
      // arithmetic above depends on it; `MAX_DISCOVERY_ERRORS` is the ceiling
      // under test. Lowering only the first leaves six errors, because the
      // error ceiling is still 100. That is the separation being bought:
      // anyone tuning how many pages a crawl visits does not silently retune
      // how many failures it reports.
      return { ...actual, MAX_DISCOVERY_URLS: 5, MAX_DISCOVERY_ERRORS: 5 };
    });

    const { discoverLinks: capped } = await import(
      '../../../src/integrations/browser/discover-links'
    );
    const result = await capped({ targetUrl: `http://${HOST}/dead-hub.html` });

    expect(result.errors).toHaveLength(5);

    // What the cap dropped, said out loud. A bounded list reporting nothing
    // about its bound is the same defect as a truncated crawl claiming to be
    // whole — this shape produces six failures, so exactly one was refused.
    expect(result.errorsOmitted).toBe(1);

    // Both hubs were reached, so the six failures really did happen and the
    // fifth is a cap rather than the crawl having stopped early.
    expect(result.pages.map((page) => locationOf(page.url)).sort()).toEqual([
      '/dead-hub-2.html',
      '/dead-hub.html',
    ]);

    vi.doUnmock('../../../src/domain/discovery');
    vi.resetModules();
  }, 60_000);
});
