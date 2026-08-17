import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * A journey that goes through somebody else's login page and comes back.
 *
 * This is the shape Phase 6 exists for and the shape the runner refuses today:
 * `allowedHosts` defaults to the target's own hostname, so an app that
 * redirects to Okta, Entra or Auth0 fails on its first step. The control test
 * below pins that, so the rest of this file is measured against the real
 * behaviour rather than against a description of it.
 *
 * What is being proved here is not the widening — nothing can widen the
 * allowlist over HTTP yet — but the two rules that have to exist *before*
 * anything can:
 *
 *  - a host the journey only passes through is walked, not audited;
 *  - the journey has to come to rest on the site it was auditing.
 *
 * Both are inert while the allowlist holds only the target, which is exactly
 * why they are worth shipping first: the guard lands before the capability,
 * and `allowedHosts` is a real `runJourney` input, so the widened case can be
 * driven here without a route that can produce it.
 *
 * Two hostnames, neither of which resolves for real. Node's resolver is told
 * both are public — the answer a pre-navigation check would get — and Chromium
 * is pointed at one loopback server, which serves both by reading the `Host`
 * header. No network.
 */

const APP = 'app.example';
const IDP = 'idp.example';

/**
 * The authorization code, in the place a real one lives.
 *
 * An SSO callback carries it in the query, and the runner's refusal names
 * where the journey ended. Nothing that names a URL a journey settled on may
 * carry this through to a log or a stored `failureReason`.
 */
const CODE = 'sso-code-must-not-be-logged';

const shared = vi.hoisted(() => ({ port: 0 }));

vi.mock('node:dns/promises', () => ({
  lookup: async (hostname: string) => {
    if (hostname === APP || hostname === IDP) {
      return [{ address: '93.184.216.34', family: 4 }];
    }
    throw new Error(`unexpected lookup: ${hostname}`);
  },
}));

vi.mock('../../../src/integrations/browser/launch', () => ({
  launchChromium: async ({ headless = true }: { headless?: boolean } = {}) =>
    chromium.launch({
      headless,
      args: [
        `--host-resolver-rules=MAP ${APP} 127.0.0.1:${shared.port},MAP ${IDP} 127.0.0.1:${shared.port}`,
      ],
    }),
}));

/**
 * The peer check, and only the peer check.
 *
 * Both hosts answer from 127.0.0.1, so the SSRF address guard would refuse
 * every navigation here and this file could not reach its own subject. It
 * stubs one export; the guard's real coverage is untouched next door in
 * `journey-rebind.test.ts`, which exists to prove it fires and would fail if
 * this stub ever spread there.
 */
vi.mock('../../../src/integrations/browser/target-url', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/integrations/browser/target-url')>()),
  assertPeerAddressAllowed: () => {},
}));

const { runJourney } = await import('../../../src/integrations/browser/journey-runner');
const { UnsafeTargetError } = await import('../../../src/integrations/browser/target-url');

let server: Server;
let artifactsDir: string;

const page = (marker: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>${marker}</title></head><body><h1>${marker}</h1>${body}</body></html>`;

beforeAll(async () => {
  server = createServer((request, response) => {
    const host = (request.headers.host ?? '').split(':')[0];
    const path = (request.url ?? '/').split('?')[0];

    if (host === APP && path === '/') {
      // The redirect an app performs when the session is cold.
      response.writeHead(302, { location: `http://${IDP}/login?code=${CODE}` });
      response.end();
      return;
    }

    if (host === IDP && path === '/login') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        page('IDP-LOGIN-PAGE', `<a id="continue" href="http://${APP}/dashboard">Continue</a>`),
      );
      return;
    }

    if (host === APP && path === '/bounce') {
      // A page that leaves for the provider *while it is being captured* — a
      // session expiring mid-audit, or a hostile page choosing its moment.
      //
      // The two numbers here are what make it land inside the capture rather
      // than before it: two thousand elements put the axe scan, the DOM read
      // and the full-page screenshot into the seconds, and the redirect fires
      // 400ms in, long after `capturePage` has read the URL and long before it
      // has finished writing artifacts.
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(
        page(
          'APP-BOUNCE',
          `${'<p>filler</p>'.repeat(2000)}<script>setTimeout(function(){location.href='http://${IDP}/login?code=${CODE}'},400)</script>`,
        ),
      );
      return;
    }

    if (host === APP && path === '/dashboard') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(page('APP-DASHBOARD', '<p>Signed in.</p>'));
      return;
    }

    response.writeHead(404, { 'content-type': 'text/html' });
    response.end(page('NOT-FOUND', ''));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  shared.port = (server.address() as { port: number }).port;
  artifactsDir = await mkdtemp(join(tmpdir(), 'offsite-'));
});

afterAll(async () => {
  server.close();
  await rm(artifactsDir, { recursive: true, force: true });
});

function ssoJourney(overrides: Record<string, unknown>) {
  return runJourney({
    environment: 'staging',
    journeyId: 'sso-probe',
    stepId: 'sso',
    fixtureDir: process.cwd(),
    artifactsDir,
    targetUrl: `http://${APP}/`,
    stepTimeoutMs: 5_000,
    ...overrides,
  } as Parameters<typeof runJourney>[0]);
}

describe('a journey whose app hands off to an identity provider', () => {
  /**
   * The bug, pinned as a control rather than described.
   *
   * Without a per-journey allowlist this is where every SSO customer stops:
   * one step in, on the redirect the app itself performs, with a refusal that
   * names a host they never wrote down.
   */
  it('is refused today, because the allowlist is the target host and nothing else', async () => {
    const run = ssoJourney({ steps: [{ action: 'navigate', type: 'goto', path: '/' }] });

    await expect(run).rejects.toThrow(UnsafeTargetError);
    await expect(run).rejects.toThrow(new RegExp(`Host ${IDP} is not in the allowed`));
  }, 60_000);

  /**
   * The rule that keeps a third party's login page out of a client's report.
   *
   * Widening the allowlist is what makes the hop possible; without this it
   * also makes Okta's page a page of Acme's audit — scanned, screenshotted,
   * and its violations scored as defects Acme cannot fix, in a document their
   * counsel may read.
   */
  it('walks through the provider without auditing it', async () => {
    const result = await ssoJourney({
      allowedHosts: [APP, IDP],
      steps: [
        { action: 'navigate', type: 'goto', path: '/' },
        { action: 'navigate', type: 'click', selector: '#continue' },
      ],
    });

    // One page, and it is the client's.
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].page.url).toBe(`http://${APP}/dashboard`);

    // Not just absent from the list — absent from the evidence. A page that
    // was scanned and then filtered out would still have written a screenshot
    // and a DOM snapshot of somebody else's login form.
    expect(result.pages.map((captured) => captured.html).join('')).not.toContain(
      'IDP-LOGIN-PAGE',
    );
  }, 60_000);

  /**
   * The rule that stops a widened allowlist becoming this plan's own headline
   * failure: a run that never got in, audited a login page, and reported it as
   * a clean pass because login pages are small and tidy.
   */
  it('refuses a run that comes to rest on the provider', async () => {
    const run = ssoJourney({
      allowedHosts: [APP, IDP],
      steps: [{ action: 'navigate', type: 'goto', path: '/' }],
    });

    await expect(run).rejects.toThrow(UnsafeTargetError);
    await expect(run).rejects.toThrow(/must finish on the site it is auditing/);
    await expect(run).rejects.toThrow(new RegExp(`not on ${APP}`));
  }, 60_000);

  /**
   * A page that leaves for the provider mid-capture is never reported.
   *
   * `capturePage` reads the URL, then spends real time on an axe scan, a DOM
   * read, a screenshot and an AX tree, and the page is free to move during all
   * of it. What the run must never do is finish and hand back a page whose
   * evidence is of somewhere else.
   *
   * **The assertion is that the run dies, not which guard killed it, and the
   * reason is a finding rather than a compromise.** The redirect lands inside
   * `scanPageWithAxe`, so Playwright's own `frame.evaluate` fails first with
   * "Execution context was destroyed" — before any check in this codebase gets
   * to speak. That is the failure a real operator meets when a session expires
   * mid-audit, and it classifies as `audit_run_failed`, which is worth knowing
   * and was not written down anywhere until this test found it.
   *
   * Which guard fires depends on where in the capture the navigation lands,
   * and that is a race with an axe scan — not something a test can pin without
   * being flaky on a slower machine. So this pins the property that holds
   * whichever way the race goes: nothing is captured, and the run does not
   * come back clean.
   */
  it('cannot finish cleanly when the page walks out mid-capture', async () => {
    const run = ssoJourney({
      allowedHosts: [APP, IDP],
      steps: [{ action: 'navigate', type: 'goto', path: '/bounce' }],
    });

    await expect(run).rejects.toThrow();
  }, 60_000);

  /**
   * The message names where the journey ended, and an SSO callback is the one
   * URL where that is a credential.
   *
   * `failureReason` is stored and logged verbatim, and `logger.ts` redacts by
   * key name — `failureReason` is not a redacted key — so a code interpolated
   * into this message is a code written to the log.
   */
  it('names where it ended without carrying the authorization code', async () => {
    const run = ssoJourney({
      allowedHosts: [APP, IDP],
      steps: [{ action: 'navigate', type: 'goto', path: '/' }],
    });

    // The path survives, because "it ended on the login page" is the whole
    // diagnostic and it is in the path.
    await expect(run).rejects.toThrow(/\/login/);
    await expect(run).rejects.not.toThrow(new RegExp(CODE));
  }, 60_000);
});
