import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * A real HTTP error page, against the real runner.
 *
 * The bug this guards: `page.goto`'s response was discarded and nothing in
 * `src/` read a status, so a 500, a 404 or an expired-session 403 was
 * navigated to, scanned, screenshotted and stored exactly like the page it
 * stood in for. Error pages are small and clean, so a run that hit one scored
 * *higher* than a real audit and reported `pass`.
 *
 * It has to be driven end to end. `evidence.test.ts` proves the `>= 400` rule
 * decides correctly, and that is not the same as proving the runner ever hands
 * it a status — "the check was right, nothing called it" shipped three times
 * in the phase before this one.
 *
 * A server rather than a fixture file, and that is forced: the fixtures are
 * `file://`, which has no HTTP status to serve. This is the same harness
 * `journey-rebind.test.ts` uses, for the same reason — a `targetUrl` run is
 * the only way to reach `http`.
 */

const HOST = 'status.example';

// Hoisted so the mock factories below can read the port, which is not known
// until the server is listening.
const shared = vi.hoisted(() => ({ port: 0 }));

vi.mock('node:dns/promises', () => ({
  lookup: async (hostname: string) => {
    if (hostname === HOST) {
      return [{ address: '93.184.216.34', family: 4 }];
    }
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
 * Reaching an `http` status at all means a real server, a real server on this
 * machine means loopback, and loopback is an address `assertPeerAddressAllowed`
 * exists to refuse — correctly. So a test about status codes cannot also honour
 * the address guard, and the honest move is to stub exactly that one function
 * and say so, rather than to weaken it in `src/` for testability.
 *
 * What is *not* stubbed matters as much: `assertSafeTargetUrl`,
 * `assertAllowedUrl` and `UnsafeTargetError` come through untouched via
 * `importOriginal`, so the allowlist and the pre-navigation checks still run.
 * And the peer check keeps its own end-to-end coverage next door in
 * `journey-rebind.test.ts`, which drives the same runner and asserts the run is
 * refused. This file must not become the pattern for avoiding that one.
 */
vi.mock('../../../src/integrations/browser/target-url', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/integrations/browser/target-url')>()),
  assertPeerAddressAllowed: () => {},
}));

const { runJourney } = await import('../../../src/integrations/browser/journey-runner');
const { runBrowserAudit } = await import('../../../src/integrations/browser/run-browser-audit');

let server: Server;
let artifactsDir: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    const body = '<html><head><title>Page</title></head><body><h1>Hello</h1></body></html>';

    if (request.url === '/boom') {
      response.writeHead(500, { 'content-type': 'text/html' });
      response.end('<html><head><title>Server Error</title></head><body>500</body></html>');
      return;
    }

    // A 500 that rewrites its own URL the instant it loads. This is the
    // evasion the first implementation fell to: the status was keyed by
    // `response.url()` and read by `page.url()`, and the page controls the
    // second.
    if (request.url === '/sneaky') {
      response.writeHead(500, { 'content-type': 'text/html' });
      response.end(
        '<html><head><title>Server Error</title></head><body>500' +
          '<script>history.pushState({}, "", "/looks-fine");</script>' +
          '</body></html>',
      );
      return;
    }

    if (request.url === '/hashed') {
      response.writeHead(500, { 'content-type': 'text/html' });
      response.end(
        '<html><head><title>Server Error</title></head><body>500' +
          '<script>location.hash = "evaded";</script>' +
          '</body></html>',
      );
      return;
    }

    // A page that renames itself as the landing page. `capturePage` skips a
    // page it has already audited, so a page that can pass for one deletes
    // itself from the report rather than merely mislabelling itself.
    if (request.url === '/hide') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        '<html><head><title>Hidden</title></head><body><img src="x.png">' +
          '<script>history.pushState({}, "", "/");</script>' +
          '</body></html>',
      );
      return;
    }

    if (request.url === '/moved') {
      response.writeHead(302, { location: '/ok' });
      response.end();
      return;
    }

    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  shared.port = (server.address() as { port: number }).port;
  artifactsDir = await mkdtemp(join(tmpdir(), 'page-status-'));
});

afterAll(async () => {
  server.close();
  await rm(artifactsDir, { recursive: true, force: true });
});

describe('runJourney, against pages served with real HTTP statuses', () => {
  it('records the status of a page that was served fine', async () => {
    const result = await runJourney({
      environment: 'staging',
      journeyId: 'status-probe',
      stepId: 'ok',
      fixtureDir: process.cwd(),
      artifactsDir,
      targetUrl: `http://${HOST}/`,
      steps: [{ action: 'navigate', type: 'goto', path: '/ok' }],
    });

    expect(result.pages[0].page.statusCode).toBe(200);
  }, 60_000);

  it('records the status of the page it settled on, not of the redirect', async () => {
    // A journey passing through a redirect is the normal case — it is what a
    // login does. Recording the 302 would degrade every one of them.
    const result = await runJourney({
      environment: 'staging',
      journeyId: 'status-probe',
      stepId: 'moved',
      fixtureDir: process.cwd(),
      artifactsDir,
      targetUrl: `http://${HOST}/`,
      steps: [{ action: 'navigate', type: 'goto', path: '/moved' }],
    });

    expect(result.pages[0].page.statusCode).toBe(200);
    expect(result.pages[0].page.url).toContain('/ok');
  }, 60_000);

  it('records a 500', async () => {
    const result = await runJourney({
      environment: 'staging',
      journeyId: 'status-probe',
      stepId: 'boom',
      fixtureDir: process.cwd(),
      artifactsDir,
      targetUrl: `http://${HOST}/`,
      steps: [{ action: 'navigate', type: 'goto', path: '/boom' }],
    });

    expect(result.pages[0].page.statusCode).toBe(500);
  }, 60_000);

  /**
   * The audited page must not be able to erase its own status.
   *
   * Both of these defeated the first implementation, which keyed the status by
   * `response.url()` and looked it up by `page.url()`. A `pushState` or a
   * fragment change moves the second without producing a navigation response,
   * so the lookup missed, the status read as "not measured", and a 500 went
   * back to counting as clean evidence — the exact outcome this whole change
   * exists to prevent, reachable from one line in the page body.
   *
   * Keying on the page object is what makes these pass: neither trick produces
   * a navigation, so the last real navigation's status stands.
   */
  it.each([
    ['pushState to a different path', '/sneaky'],
    ['a fragment change', '/hashed'],
  ])('records the 500 despite %s', async (_label, path) => {
    const result = await runJourney({
      environment: 'staging',
      journeyId: 'status-probe',
      stepId: `evade-${path.slice(1)}`,
      fixtureDir: process.cwd(),
      artifactsDir,
      targetUrl: `http://${HOST}/`,
      steps: [{ action: 'navigate', type: 'goto', path }],
    });

    expect(result.pages[0].page.statusCode).toBe(500);
  }, 60_000);

  /**
   * The other direction: a page must not be able to *claim* someone else's 200.
   *
   * Visit a page that really was 200, then a 500 that rewrites its URL back to
   * the first one. Under URL keying the map answered 200 for the error
   * document — a spoofed clean page, not merely a missing status.
   */
  it('does not let an error page inherit an earlier page 200', async () => {
    const result = await runJourney({
      environment: 'staging',
      journeyId: 'status-probe',
      stepId: 'evade-inherit',
      fixtureDir: process.cwd(),
      artifactsDir,
      targetUrl: `http://${HOST}/`,
      steps: [
        { action: 'navigate', type: 'goto', path: '/ok' },
        { action: 'navigate', type: 'goto', path: '/sneaky' },
      ],
    });

    expect(result.pages[0].page.statusCode).toBe(200);
    expect(result.pages[1].page.statusCode).toBe(500);
  }, 60_000);

  /**
   * And a page must not be able to delete itself by claiming to be one
   * already audited.
   *
   * `capturePage` skips a page it has already audited — which is right, and
   * is what stops a looping journey counting one page's findings twice. But a
   * skip *removes* a page from the report, so deciding it on `page.url()`
   * alone made one line a deletion: `history.pushState({}, '', '/')` on a
   * page with violations makes it look like the landing page, which is the
   * first capture of every journey. The page is never scanned, and because a
   * revisit is deliberately not counted into `truncatedPages`, nothing in the
   * report says a page went missing.
   *
   * The fix is the same one the statuses above rely on: compare what the
   * network served, which no `pushState` can rewrite, as well as what the
   * document claims.
   */
  it('audits a page that renames itself as one already audited', async () => {
    const result = await runJourney({
      environment: 'staging',
      journeyId: 'status-probe',
      stepId: 'evade-capture',
      fixtureDir: process.cwd(),
      artifactsDir,
      targetUrl: `http://${HOST}/`,
      steps: [
        // The landing page first, because that is what the evasion imitates —
        // `/` is `pages[0]` on every journey, which is what made one constant
        // `pushState` enough to suppress an entire walk.
        { action: 'navigate', type: 'goto', path: '/' },
        { action: 'navigate', type: 'goto', path: '/hide' },
      ],
    });

    // Two captures: the landing page, and the page that tried to pass for it.
    expect(result.pages).toHaveLength(2);
    // And the second really is the hidden one — its own title, not the
    // landing page's, so this cannot pass by capturing `/ok` twice.
    expect(result.pages[1].page.title).toBe('Hidden');
  }, 60_000);
});

describe('runBrowserAudit, over a page served as an error', () => {
  /**
   * The whole chain, which is the point of this file.
   *
   * Recording the status is worth nothing on its own; what matters is that a
   * 500 can no longer be reported as a clean audit. Every one of these was
   * true in the opposite direction before this change: the page was complete,
   * its findings were derived, the run was scored and the verdict passed.
   */
  it('cannot report an error page as clean evidence', async () => {
    const report = await runBrowserAudit({
      environment: 'staging',
      journeyId: 'status-probe',
      stepId: 'boom-audit',
      fixtureDir: process.cwd(),
      artifactsDir,
      targetUrl: `http://${HOST}/`,
      steps: [{ action: 'navigate', type: 'goto', path: '/boom' }],
    });

    const [page] = report.pages;
    expect(page.page.statusCode).toBe(500);

    // All three artifacts, deliberately.
    //
    // The first draft of this test passed `omitAxTree: true` and asserted
    // `degraded` — and mutation testing showed it still passed with the whole
    // `>= 400` rule deleted, because a missing AX tree degrades the page on its
    // own. It was a test of the artifact rule wearing this one's name. The
    // capture has to be complete so that the status is the only thing left that
    // could have degraded it.
    expect(page.artifacts.screenshotPath).toBeTruthy();
    expect(page.artifacts.domSnapshotPath).toBeTruthy();
    expect(page.artifacts.axTreePath).toBeTruthy();

    expect(page.evidenceStatus).toBe('degraded');

    // Not merely flagged. An error page's findings are findings about an error
    // page, and reporting them would put a client's name on an audit of their
    // 500 handler.
    expect(report.findings).toEqual([]);

    // No number, rather than a low one. An unscoreable run has no denominator,
    // and printing a score here is the specific lie this phase exists to stop.
    expect(report.score ?? null).toBeNull();
    expect(report.ciStatus).toBe('inconclusive');
  }, 60_000);
});
