import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
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
/** Kept so a startup failure reports what the server said, not just a timeout. */
let serverOutput = '';

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
  throw new Error(
    `next start did not answer on ${BASE} within ${timeoutMs}ms.\n` +
      `Usually a stale build, or port ${PORT} already held by an earlier run.\n` +
      `Server output:\n${serverOutput || '(none)'}`,
  );
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
      // The portfolio reads the catalog, so the server needs *a* store. CI has
      // no database, and pointing at one that is not there renders the error
      // page and fails every assertion below for the wrong reason. This asks
      // for the ephemeral store explicitly; nothing here persists anything.
      AUDITOR_STORE: 'memory',
      DATABASE_URL: '',
    },
    // Own process group, so teardown can kill `next start` and not just the
    // `npx` wrapper in front of it — an orphan keeps the port and makes the
    // next run fail against a stale server.
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  server.stdout?.on('data', (chunk) => {
    serverOutput += String(chunk);
  });
  server.stderr?.on('data', (chunk) => {
    serverOutput += String(chunk);
  });

  await waitForServer();
  browser = await launchChromium();
}, 120_000);

afterAll(async () => {
  await browser?.close();

  if (server?.pid) {
    try {
      // Negative pid targets the whole group.
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }
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

      // The unlock card has buttons too, so every assertion above passes
      // happily against a locked page. CI proved that is not hypothetical:
      // these tests went green while four routes were serving the locked
      // shell from a prerender.
      expect(await page.innerText('body')).not.toContain('Unlock the console');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('starts with an empty portfolio and adds a client through the modal', async () => {
    // The one path that decides whether this product has a front door: the
    // portfolio is empty until an operator adds someone, and adding someone
    // has to actually reach the database and come back. Every unit test around
    // this passed while the modal was still scenery that jumped to a fixture.
    const page = await openAuthenticatedPage();
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);

      expect(await page.innerText('body')).toContain('No clients yet');

      await page.getByRole('button', { name: 'Add the first client', exact: true }).click();
      await page.getByLabel('Client name').fill('Rosewood Dental');
      await page.getByLabel('Owner').fill('Alex Reed');
      await page.getByRole('button', { name: 'Add client', exact: true }).click();

      // The row, not the toast: the toast says the same words and would appear
      // even if the write were discarded. Only the row can come from a re-read
      // of the store, so the empty state disappearing is the real assertion.
      await expect
        .poll(() => page.innerText('body'), { timeout: 15_000 })
        .not.toContain('No clients yet');

      const body = await page.innerText('body');
      expect(body).toContain('Rosewood Dental');
      expect(body).toContain('Never audited');
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

/**
 * We audit other people's sites for a living.
 *
 * Running our own engine against our own screens is the cheapest possible
 * answer to "who audits the auditor", and it found real defects the first time
 * it ran: the client bar sat between the banner and `<main>` so its content
 * belonged to no landmark, and the search control's placeholder ink was
 * 2.36:1 against a 4.5:1 requirement.
 *
 * Asserted at zero deliberately. A threshold ("no more than five") is a budget
 * for shipping barriers, which is not a position this product can hold.
 */
describe('platform accessibility', () => {
  it.each([...ROUTES, '/console'])('has no axe violations on %s', async (route) => {
    const page = await openAuthenticatedPage();
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);

      const results = await new AxeBuilder({ page }).analyze();

      // Name the rule and the element on failure: "expected 0, got 2" would
      // send the next reader back to a browser to find out what broke. The
      // landmark outline comes along because a landmark rule is meaningless
      // without knowing what the page actually rendered — CI once failed
      // `landmark-one-main` on routes that were green locally, and the bare
      // rule id said nothing about why.
      const outline = await page.evaluate(() => ({
        mains: document.querySelectorAll('main').length,
        banners: document.querySelectorAll('header').length,
        locked: document.body.innerText.includes('Unlock the console'),
        bodyChars: document.body.innerHTML.length,
      }));

      const detail = results.violations
        .map((v) => `${v.id} (${v.impact}) × ${v.nodes.length}: ${v.nodes[0]?.target.join(' ')}`)
        .join('\n');

      expect(detail, `page outline: ${JSON.stringify(outline)}`).toBe('');
    } finally {
      await page.close();
    }
  }, 60_000);
});
