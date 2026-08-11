import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * A real DNS rebind, against the real runner.
 *
 * `target-url.test.ts` proves `assertPeerAddressAllowed` decides correctly.
 * That is not the same as proving the runner asks it — and "the check was
 * right, nothing called it" is exactly how the bypass this fix closes came to
 * ship. So this drives `runJourney` end to end and deletes nothing from the
 * picture: remove the `page.on('response')` listener, drop the peer check, or
 * drop an `await` on `guardCurrentUrl`, and this test fails.
 *
 * The rebind is genuine rather than simulated at the seam. Node's resolver is
 * told the host is public, which is what a hostile 0-TTL answer gives our
 * pre-navigation check; Chromium is told to send the connection to a local
 * server instead, which is what the same host gives the browser a moment
 * later. Neither the hostname nor the settled URL changes — that is the whole
 * point, and why the three checks that came before could not see it.
 *
 * No network: the host never resolves for real, and the server is loopback.
 */

const HOST = 'rebind.example';

// Hoisted so the mock factories below can read the port, which is not known
// until the server is listening.
const shared = vi.hoisted(() => ({ port: 0 }));

vi.mock('node:dns/promises', () => ({
  lookup: async (hostname: string) => {
    if (hostname === HOST) {
      // A public address. This is the answer that makes the pre-navigation
      // check pass, and it is a lie the browser never sees.
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

const { runJourney } = await import('../../../src/integrations/browser/journey-runner');
const { UnsafeTargetError } = await import('../../../src/integrations/browser/target-url');

let server: Server;
let artifactsDir: string;

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<html><body><h1>SECRET-INTERNAL-ADMIN-PAGE</h1></body></html>');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  shared.port = (server.address() as { port: number }).port;
  artifactsDir = await mkdtemp(join(tmpdir(), 'rebind-'));
});

afterAll(async () => {
  server.close();
  await rm(artifactsDir, { recursive: true, force: true });
});

describe('runJourney, against a host that rebinds to loopback', () => {
  it('refuses the run rather than auditing an internal page', async () => {
    const run = runJourney({
      environment: 'staging',
      journeyId: 'rebind-probe',
      stepId: 'rebind',
      fixtureDir: process.cwd(),
      artifactsDir,
      targetUrl: `http://${HOST}/`,
      steps: [{ action: 'navigate', type: 'goto', path: '/' }],
    });

    await expect(run).rejects.toThrow(UnsafeTargetError);

    // The address, not just the hostname. A rebind's URL is unremarkable, so
    // an error naming only the URL would send the next reader to the wrong
    // place entirely.
    await expect(run).rejects.toThrow(/127\.0\.0\.1/);
  }, 60_000);
});
