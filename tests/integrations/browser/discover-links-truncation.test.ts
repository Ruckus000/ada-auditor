import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * A crawl that was cut short has to say so.
 *
 * Its own file because the only cheap way to reach the URL cap is to lower it:
 * at 100 the fixture site would have to grow to 100 pages, and a walk that long
 * would trip `DISCOVERY_BUDGET_MS` first and report the wrong reason. Lowering
 * it in the happy-path file would break every assertion there about finding the
 * whole site.
 *
 * The bug this guards is not the cap itself but the reporting of it. The
 * frontier ceiling drains the queue to empty exactly when the cap binds, so the
 * `while (frontier.length > 0)` loop ends on its own condition and the
 * top-of-loop check that records `truncated` is never reached. The result then
 * claims to be the whole site while holding two pages of four — which is
 * precisely what `DiscoveryTruncation` was added to prevent, and the failure is
 * silent, so nothing but this test would notice.
 */

const HOST = 'truncation.example';
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

// Two, so a four-page site is unambiguously cut short. Everything else about
// discovery — the keys, the depth, the other caps — comes through untouched.
vi.mock('../../../src/domain/discovery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/domain/discovery')>()),
  MAX_DISCOVERY_URLS: 2,
}));

// Loopback is what the mapping above makes the browser dial, and the peer guard
// refuses it correctly. Stubbed for the same reason and on the same terms as in
// `discover-links.test.ts`; its end-to-end coverage lives in
// `discover-links-rebind.test.ts`.
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
  shared.port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe('discoverLinks, on a site larger than the URL cap', () => {
  it('says the result was cut short rather than passing it off as the whole site', async () => {
    const result = await discoverLinks({ targetUrl: `http://${HOST}/` });

    expect(result.pages).toHaveLength(2);
    expect(result.truncated?.reason).toBe('url-cap');

    // `seen` counts the links the ceiling refused as well as the pages that
    // were visited, so it is a floor on how much more is out there. Equal to
    // `pages.length` would mean the count was taken after the evidence had been
    // thrown away, and the operator would read "2 of 2".
    expect(result.truncated!.seen).toBeGreaterThan(result.pages.length);
  }, 60_000);
});
