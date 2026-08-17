import { createServer, type Server } from 'node:http';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * A real DNS rebind, against the real crawler.
 *
 * `discover-links.test.ts` has to stub `assertPeerAddressAllowed` to serve
 * fixtures over loopback at all, so on its own it proves the walk works while
 * proving nothing about the listener that judges where the bytes came from.
 * "The check was right, nothing called it" is how the bypass
 * `journey-rebind.test.ts` exists for came to ship, and a crawler is the worse
 * case of the two: a run's URLs are authored by an operator, a crawler's come
 * from whatever markup it just downloaded.
 *
 * So this file stubs nothing. Remove the `context.on('response')` handler,
 * drop the `await` on the collected peer checks, or stop rethrowing the
 * recorded violation, and the crawl below happily reports the internal page.
 *
 * The rebind is genuine rather than simulated at the seam, exactly as in
 * `journey-rebind.test.ts`: Node's resolver is told the host is public, which
 * is what a hostile 0-TTL answer gives the pre-navigation check, and Chromium
 * is told to send the connection to a local server instead.
 *
 * Every page of this host rebinds, so every page here is refused. That is what
 * makes the file able to stub nothing, and also what makes it blind to whether
 * the crawl *recovers* after a refusal — sticky and cleared `peerViolation`
 * look identical when there is no clean page to tell them apart.
 * `discover-links-violation-clearing.test.ts` covers that, and pays for a clean
 * page with a substitution this file must never adopt.
 */

const HOST = 'discovery-rebind.example';

// Hoisted so the mock factories below can read the port, which is not known
// until the server is listening.
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

let server: Server;

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html><head><title>Admin</title></head><body><h1>SECRET</h1></body></html>');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  shared.port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe('discoverLinks, against a host that rebinds to loopback', () => {
  it('reports the page as an error rather than as something it found', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });

    // A crawl is not a run: one refused page is an error entry, not the end of
    // the walk. What must not happen is the page arriving in `pages`.
    expect(result.pages).toEqual([]);
    expect(result.errors).toHaveLength(1);

    // The address, not just the hostname. A rebind's URL is unremarkable, so
    // an error naming only the URL would send the next reader to the wrong
    // place entirely.
    expect(result.errors[0].message).toMatch(/127\.0\.0\.1/);
  }, 60_000);
});
