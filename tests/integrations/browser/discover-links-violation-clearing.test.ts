import { createServer, type Server } from 'node:http';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * One page rebinds; the crawl carries on and the pages after it are its own.
 *
 * `discover-links.ts` takes and clears `peerViolation` rather than reading a
 * sticky field, and the comment there says why: a run stops at its first
 * violation, a crawl does not. Left in place, the violation would fail every
 * page after the refused one, each carrying the *first* page's message and its
 * URL. That behaviour had no coverage — reverting it to sticky left every test
 * in the repo passing — because `discover-links-rebind.test.ts` rebinds the
 * whole host, so every page there violates and sticky is indistinguishable
 * from cleared.
 *
 * **Why this file exists rather than a second case in that one.** Telling
 * sticky from cleared needs at least two *clean* pages visited after a refused
 * one, and a clean page is one whose peer address the real check accepts. Every
 * address this machine can bind is loopback, link-local or RFC1918 — all
 * blocked, correctly — so a page served locally can never pass the real peer
 * check. No arrangement of servers, ports or resolver rules changes that.
 * `discover-links-rebind.test.ts` stubs nothing and must keep doing so, so the
 * substitution below lives here, behind its own header, instead.
 *
 * **What is substituted, and what is not.** `assertPeerAddressAllowed` keeps
 * its real body and makes every real decision. Only its *input* is varied, and
 * only for the pages that are not the subject: the rebinding path is judged on
 * the address Chromium actually connected to — genuinely 127.0.0.1, which is
 * why the assertion on the message below matches for the real reason — while
 * the clean pages are handed the public address their host resolves to, which
 * is what they would have connected to on a network this test cannot have.
 * Nothing here can turn a refusal into an acceptance for the page under test.
 *
 * This is therefore a test about the crawl loop's handling of a violation, not
 * about the peer check itself. The peer check's own end-to-end coverage over
 * this crawler is `discover-links-rebind.test.ts`, and this file must not
 * become a reason to weaken it.
 */

const REBIND_HOST = 'discovery-clearing.example';

/** The path Chromium is allowed to reach over loopback, and the only one. */
const REBOUND_PATH = '/rebound';

/**
 * Every other path this fixture serves, named rather than implied.
 *
 * The classification below has to be *total*. Discriminating on
 * `pathname === REBOUND_PATH` alone degrades loudly if that path stops matching
 * — nothing violates, the assertions below fail — but silently if a page is
 * added to `PAGES`: the new page falls into the clean branch, is handed a
 * public address, and quietly stops being judged on the address it truly
 * reached. A page that is not judged is a page this file thinks it covered.
 */
const CLEAN_PATHS = new Set(['/', '/clean-a', '/clean-b']);

/** What `REBIND_HOST` resolves to for the pre-navigation check. */
const PUBLIC_ADDRESS = '93.184.216.34';

const shared = vi.hoisted(() => ({ port: 0 }));

vi.mock('node:dns/promises', () => ({
  lookup: async (hostname: string) => {
    if (hostname === REBIND_HOST) return [{ address: PUBLIC_ADDRESS, family: 4 }];
    throw new Error(`unexpected lookup: ${hostname}`);
  },
}));

vi.mock('../../../src/integrations/browser/launch', () => ({
  launchChromium: async ({ headless = true }: { headless?: boolean } = {}) =>
    chromium.launch({
      headless,
      args: [`--host-resolver-rules=MAP ${REBIND_HOST} 127.0.0.1:${shared.port}`],
    }),
}));

vi.mock('../../../src/integrations/browser/target-url', async (importOriginal) => {
  type TargetUrl = typeof import('../../../src/integrations/browser/target-url');
  const actual = await importOriginal<TargetUrl>();

  return {
    ...actual,
    // The real predicate, the real ranges and the real message. What changes is
    // which address it is asked about: the rebinding page is judged on the one
    // the browser truly reached, every other page on the one its host resolves
    // to. See the header for why the second half cannot be arranged for real.
    assertPeerAddressAllowed: (pageUrl: string, ipAddress?: string): void => {
      const { pathname } = new URL(pageUrl);
      const isSubject = pathname === REBOUND_PATH;

      // Total rather than binary: a page added to `PAGES` must be classified
      // deliberately. Falling into the clean branch by default is how a page
      // silently stops being judged on the address it truly reached.
      if (!isSubject && !CLEAN_PATHS.has(pathname)) {
        throw new Error(`unclassified page ${pathname}`);
      }

      actual.assertPeerAddressAllowed(pageUrl, isSubject ? ipAddress : PUBLIC_ADDRESS);
    },
  };
});

const { discoverLinks } = await import('../../../src/integrations/browser/discover-links');

let server: Server;

/**
 * The entry page is clean and fans out to three, so that the refused page is
 * visited *before* two clean ones rather than last. A violation that survived
 * into them is the only thing this shape can be measuring.
 */
const PAGES: Record<string, string> = {
  '/': `<title>Home</title><main>
    <a href="${REBOUND_PATH}">Rebound</a>
    <a href="/clean-a">Clean A</a>
    <a href="/clean-b">Clean B</a>
  </main>`,
  [REBOUND_PATH]: '<title>Admin</title><main><h1>SECRET</h1></main>',
  '/clean-a': '<title>Clean A</title><main><h1>Clean A</h1></main>',
  '/clean-b': '<title>Clean B</title><main><h1>Clean B</h1></main>',
};

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', `http://${REBIND_HOST}`).pathname;
    const body = PAGES[path];

    response.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
    response.end(`<!doctype html>${body ?? '<title>Missing</title>'}`);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  shared.port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe('discoverLinks, when one page of a site resolves to a private address', () => {
  it('keeps crawling cleanly after one page resolves to a private address', async () => {
    const result = await discoverLinks({ targetUrl: `http://${REBIND_HOST}/` });

    // The violation is recorded once, against the page that caused it.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.url).toContain(REBOUND_PATH);
    expect(result.errors[0]?.message).toMatch(/127\.0\.0\.1/);

    // And the clean pages either side of it are still reported. A sticky
    // violation would have failed every page after the first, all carrying
    // the first page's message and its URL.
    //
    // Exactly these three, not "at least two": the fixture's page set is known,
    // and the loose form cannot notice the crawl failing to reach one of them —
    // which is the same silent half-coverage the total classification above
    // exists to prevent.
    const paths = result.pages.map((page) => new URL(page.url).pathname).sort();
    expect(paths).toEqual([...CLEAN_PATHS].sort());
    expect(result.pages.every((page) => !page.url.includes(REBOUND_PATH))).toBe(true);
  }, 60_000);
});
