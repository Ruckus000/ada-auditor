import { createServer, type Server } from 'node:http';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * A navigation that failed can still have connected — and the peer check it
 * queued must be settled by the iteration that made it.
 *
 * Chromium reports a response (and the context listener queues a peer check)
 * before `page.goto` gives up on the document: a redirect hop that reached a
 * private address and then a dead end, a reset mid-body, a hang after headers.
 * The crawler's drain used to run only when `goto` returned, so a violation
 * from a failed navigation sat in `peerViolation` until the *next* iteration's
 * drain — where it was thrown against a page that had nothing to do with it.
 * The innocent page vanished from `pages` and gained an error row carrying the
 * previous page's message; on the entry point, a genuine SSRF refusal was
 * wrapped as `EntryPointUnreachableError` and answered "the site did not
 * answer".
 *
 * Same substitution as `discover-links-violation-clearing.test.ts`, for the
 * reason its header gives at length: every address this machine can bind is
 * blocked, correctly, so a locally served page can never pass the real peer
 * check. `assertPeerAddressAllowed` keeps its real body and makes every real
 * decision; only its *input* varies — the failing paths are judged on the
 * address Chromium actually reached (genuinely 127.0.0.1), the clean pages on
 * the public address their host resolves to. Nothing here can turn a refusal
 * into an acceptance for the pages under test.
 */

const HOST = 'discovery-failed-nav.example';

/**
 * The two paths whose navigations fail *after* queueing a peer check: each
 * 302s to a loopback port nobody listens on, so the redirect response itself
 * is judged on the real peer (127.0.0.1, blocked) and the navigation then dies
 * with a connection refusal on the second hop.
 */
const FAILING_PATHS = new Set(['/reset', '/entry-reset']);

/** Every other path this fixture serves. The classification must be total. */
const CLEAN_PATHS = new Set(['/', '/clean-a', '/clean-b']);

/** What `HOST` resolves to for the pre-navigation check. */
const PUBLIC_ADDRESS = '93.184.216.34';

const shared = vi.hoisted(() => ({ port: 0 }));

vi.mock('node:dns/promises', () => ({
  lookup: async (hostname: string) => {
    if (hostname === HOST) return [{ address: PUBLIC_ADDRESS, family: 4 }];
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

vi.mock('../../../src/integrations/browser/target-url', async (importOriginal) => {
  type TargetUrl = typeof import('../../../src/integrations/browser/target-url');
  const actual = await importOriginal<TargetUrl>();

  return {
    ...actual,
    assertPeerAddressAllowed: (pageUrl: string, ipAddress?: string): void => {
      const { pathname } = new URL(pageUrl);
      const isSubject = FAILING_PATHS.has(pathname);

      // Total rather than binary: a page added to `PAGES` must be classified
      // deliberately, or it silently stops being judged on the address it
      // truly reached.
      if (!isSubject && !CLEAN_PATHS.has(pathname)) {
        throw new Error(`unclassified page ${pathname}`);
      }

      actual.assertPeerAddressAllowed(pageUrl, isSubject ? ipAddress : PUBLIC_ADDRESS);
    },
  };
});

const { discoverLinks } = await import('../../../src/integrations/browser/discover-links');
const { UnsafeTargetError } = await import('../../../src/integrations/browser/target-url');

let server: Server;

/**
 * The failing page is linked *before* the clean ones, so its stale violation —
 * if one survives the iteration that caused it — lands on `/clean-a`, which is
 * exactly the page the assertions below insist is reported as a page.
 */
const PAGES: Record<string, string> = {
  '/': `<title>Home</title><main>
    <a href="/reset">Reset</a>
    <a href="/clean-a">Clean A</a>
    <a href="/clean-b">Clean B</a>
  </main>`,
  '/clean-a': '<title>Clean A</title><main><h1>Clean A</h1></main>',
  '/clean-b': '<title>Clean B</title><main><h1>Clean B</h1></main>',
};

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', `http://${HOST}`).pathname;

    // The subject shape: a real response — which queues the peer check, judged
    // on the loopback address genuinely reached — followed by a hop the
    // browser cannot complete. Port 1 is privileged and unassigned in
    // practice, so the second hop dies instantly with a refusal rather than a
    // timeout this suite would have to wait out.
    if (FAILING_PATHS.has(path)) {
      response.writeHead(302, { location: 'http://127.0.0.1:1/dead' });
      response.end();
      return;
    }

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

describe('discoverLinks, when a navigation fails after its peer check was queued', () => {
  it('attributes the violation to the page that made it, and keeps the pages after it', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });

    // One failure, filed against the page whose navigation reached the blocked
    // address — and it is the peer refusal, which names what actually
    // happened, not the connection error from the hop after it.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.url).toContain('/reset');
    expect(result.errors[0]?.message).toMatch(/private or reserved address/);

    // The pages visited after the failure are all reported as pages. A stale
    // violation drained one iteration late throws against `/clean-a`, which
    // then arrives as an error row carrying `/reset`'s message instead of as
    // the page it is.
    const paths = result.pages.map((page) => new URL(page.url).pathname).sort();
    expect(paths).toEqual(['/', '/clean-a', '/clean-b']);
  }, 60_000);

  it('reports an entry point that connected to a private address as a refusal, not as unreachable', async () => {
    const failure: unknown = await discoverLinks({
      targetUrl: `http://${HOST}/entry-reset`,
    }).catch((error: unknown) => error);

    // The peer refusal, not `EntryPointUnreachableError`: "the site did not
    // answer" is the benign reading of an entry whose first hop reached a
    // private address, and the type is what the route branches on.
    expect(failure).toBeInstanceOf(UnsafeTargetError);
    expect((failure as Error).message).toMatch(/private or reserved address/);
  }, 60_000);
});
