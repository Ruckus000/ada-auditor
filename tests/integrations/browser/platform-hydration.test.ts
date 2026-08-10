import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { launchChromium } from '../../../src/integrations/browser/launch';
import {
  CONSOLE_COOKIE,
  createSessionValue,
} from '../../../src/app/api/_lib/console-session';

/**
 * Does the platform UI actually work in a browser?
 *
 * This exists because a completely inert UI was committed with `tsc`, 453 unit
 * tests and a clean build all green. Every platform route server-rendered
 * perfect HTML and then never hydrated: no handler ran, no error was reported,
 * and nothing in the suite could tell.
 *
 * That failure turned out not to be reproducible from the committed source —
 * the most likely explanation is a `next start` process serving a `.next`
 * directory that was rebuilt underneath it, which leaves the HTML referencing
 * client chunks the running server no longer matches. Silent, and invisible to
 * every other suite. Whatever it was, this is the thing that would have caught
 * it, and it stays whether or not it ever fires again.
 *
 * It is the same lesson as the `@axe-core/playwright` bundling incident: the
 * suites were green while the product was broken, because nothing exercised
 * the built application. So this asserts the only thing that actually matters
 * — that the page is *alive*:
 *
 *  1. React attached to the server HTML (a fiber on a real control), and
 *  2. clicking navigation changes the URL.
 *
 * Requires a build (`npm run build`). It drives `next start`, not `next dev`,
 * for the reason `AGENTS.md` gives: dev and the built bundle fail differently.
 */

const PORT = 3417;
const BASE = `http://localhost:${PORT}`;
const TOKEN = 'platform-hydration-test-token';

let server: ChildProcess;
let browser: Browser;

async function waitForServer(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`next start did not answer on ${BASE} within ${timeoutMs}ms`);
}

/**
 * Signs a session rather than posting the token.
 *
 * The unlock endpoint is rate limited and the cookie is `HttpOnly`, so minting
 * the value directly is both faster and less coupled to the unlock flow, which
 * has its own tests.
 */
async function openAuthenticatedPage(): Promise<Page> {
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: CONSOLE_COOKIE,
      value: createSessionValue(TOKEN),
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  return context.newPage();
}

/** True once React has attached a fiber to the element — i.e. it is alive. */
async function isHydrated(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) return false;
    return Object.keys(element).some((key) => key.startsWith('__react'));
  }, selector);
}

beforeAll(async () => {
  if (!existsSync(join(process.cwd(), '.next'))) {
    throw new Error('No build found. Run `npm run build` before `npm run test:hydration`.');
  }

  server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AUDITOR_RUN_TOKEN: TOKEN,
      // Keep the run store out of it: these tests never start an audit, and a
      // missing DATABASE_URL must not be why they fail.
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://unused/hydration-test',
    },
    stdio: 'ignore',
  });

  await waitForServer();
  browser = await launchChromium();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  server?.kill();
});

const ROUTES = [
  '/',
  '/activity',
  '/settings',
  '/reports',
  '/clients/acme-outfitters',
  '/clients/acme-outfitters/findings',
  '/clients/acme-outfitters/journeys',
];

describe('platform hydration', () => {
  it('locks every route behind the operator session', async () => {
    // The platform UI was fully public before Phase 2C. It is about to show
    // real client names and findings, so an unauthenticated visit must not
    // render the portfolio.
    const page = await browser.newPage();
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      const text = await page.innerText('body');
      expect(text).toContain('Unlock the console');
      expect(text).not.toContain('Portfolio');
    } finally {
      await page.close();
    }
  }, 60_000);

  it.each(ROUTES)('hydrates %s', async (route) => {
    const page = await openAuthenticatedPage();
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
      // The header renders on every platform route, so one selector covers all
      // of them — and it is above the screen, which is what made the original
      // failure so easy to miss: the whole root was inert, not just the page.
      await page.waitForSelector('button');
      await expect
        .poll(() => isHydrated(page, 'button'), { timeout: 15_000 })
        .toBe(true);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('navigates by changing the URL, not by swapping state', async () => {
    // The prototype navigated with `useState`, so nothing was linkable. This
    // is the assertion that the restructure actually delivered its point.
    const page = await openAuthenticatedPage();
    try {
      await page.goto(`${BASE}/clients/acme-outfitters`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);

      await page.getByRole('button', { name: 'Findings', exact: true }).click();
      await page.waitForURL('**/clients/acme-outfitters/findings', { timeout: 15_000 });

      expect(new URL(page.url()).pathname).toBe('/clients/acme-outfitters/findings');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('refuses a client that does not exist rather than showing another one', async () => {
    // `indexForSlug` falls back to index 0, so without a guard this URL renders
    // the first client's findings under a different client's address. That
    // looks like an answer, which makes it worse than an error page.
    const page = await openAuthenticatedPage();
    try {
      const response = await page.goto(`${BASE}/clients/does-not-exist`, {
        waitUntil: 'domcontentloaded',
      });

      expect(response?.status()).toBe(404);
      expect(await page.innerText('body')).not.toContain('Northwind Health');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('keeps a filter in the URL so it survives a reload', async () => {
    const page = await openAuthenticatedPage();
    try {
      await page.goto(`${BASE}/clients/acme-outfitters/findings?filter=must`, {
        waitUntil: 'domcontentloaded',
      });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);

      await page.reload({ waitUntil: 'domcontentloaded' });
      expect(new URL(page.url()).searchParams.get('filter')).toBe('must');
    } finally {
      await page.close();
    }
  }, 60_000);
});
