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
      // The end-to-end test below runs a real audit through the real endpoint.
      // The chaos scenario is how it gets deterministic findings without a
      // site to point at.
      CHAOS_ENABLED: 'true',
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

const CLIENT = 'harness-client';

/**
 * The report id behind a share URL.
 *
 * The share link deliberately carries only the token — the id is an internal
 * handle and putting it in a public URL would hand a holder of the link a
 * second thing to guess with.
 */
async function reportIdFor(shareUrl: string): Promise<string> {
  const token = shareUrl.replace('/r/', '');
  const response = await fetch(`${BASE}/api/platform/clients/${CLIENT}/reports`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const { reports } = (await response.json()) as {
    reports: Array<{ id: string; shareToken?: string }>;
  };
  const match = reports.find((report) => report.shareToken === token);
  if (!match) throw new Error(`No report found for ${shareUrl}`);
  return match.id;
}

const ROUTES = [
  '/',
  '/activity',
  '/settings',
  '/reports',
  `/clients/${CLIENT}`,
  `/clients/${CLIENT}/findings`,
  `/clients/${CLIENT}/journeys`,
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

  it('starts with an empty portfolio and adds a client through the modal', async () => {
    // The one path that decides whether this product has a front door: the
    // portfolio is empty until an operator adds someone, and adding someone
    // has to actually reach the store and come back. Every unit test around
    // this passed while the modal was still scenery that jumped to a fixture.
    //
    // It runs first on purpose, and the client it adds is the one every client
    // route below visits. Seeding in `beforeAll` instead would have made
    // "starts empty" untestable — and a seeded fixture is exactly what this
    // phase removed.
    const page = await openAuthenticatedPage();
    try {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);

      expect(await page.innerText('body')).toContain('No clients yet');

      await page.getByRole('button', { name: 'Add the first client', exact: true }).click();
      await page.getByLabel('Client name').fill('Harness Client');
      await page.getByLabel('Owner').fill('Alex Reed');
      await page.getByRole('button', { name: 'Add client', exact: true }).click();

      // The row, not the toast: the toast says the same words and would appear
      // even if the write were discarded. Only the row can come from a re-read
      // of the store, so the empty state disappearing is the real assertion.
      await expect
        .poll(() => page.innerText('body'), { timeout: 15_000 })
        .not.toContain('No clients yet');

      const body = await page.innerText('body');
      expect(body).toContain('Harness Client');
      expect(body).toContain('Never audited');
    } finally {
      await page.close();
    }
  }, 60_000);


  it('shows the findings a real run produced', async () => {
    // The check this whole phase is judged on. A client, a journey, an audit
    // through the real endpoint, and the defects it found rendered on that
    // client's screen — no fixture anywhere in the chain.
    //
    // It also covers the linkage that was missing until this slice: `saveRun`
    // materialises an unknown journey under `client-unassigned`, so a run only
    // reaches a client's screen if the journey was registered against that
    // client first.
    const journey = await fetch(`${BASE}/api/platform/clients/${CLIENT}/journeys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ name: 'Checkout' }),
    });
    expect(journey.status, await journey.clone().text()).toBe(201);
    const { journey: created } = await journey.json();

    const run = await fetch(`${BASE}/api/audit/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        journeyId: created.id,
        environment: 'staging',
        chaosScenario: 'browser_passthrough_violations',
      }),
    });
    // 202 with a poll URL: a run launches a browser and walks a journey, so
    // the endpoint hands back a request id rather than holding the connection.
    expect([200, 202]).toContain(run.status);
    const { pollUrl, requestId } = await run.json();

    const deadline = Date.now() + 90_000;
    let finished = false;
    while (Date.now() < deadline && !finished) {
      const poll = await fetch(`${BASE}${pollUrl ?? `/api/audit/runs/${requestId}`}`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      const state = await poll.json();
      finished = state.run?.status === 'complete' || state.run?.status === 'failed';
      if (!finished) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(finished, 'the audit never finished').toBe(true);

    const page = await openAuthenticatedPage();
    try {
      await page.goto(`${BASE}/clients/${CLIENT}/findings`, { waitUntil: 'domcontentloaded' });
      const body = await page.innerText('body');

      // Grouped by page, because a run is a journey and a journey is several
      // pages. The scenario walks through a page with violations on it, which
      // is exactly the bug that made a run report only its last page.
      expect(body).toContain('violations.html');
      expect(body).toContain('button-name');
      expect(body).toContain('MUST FIX');
      expect(body).not.toContain('Nothing audited yet');
    } finally {
      await page.close();
    }
  }, 120_000);

  it('dismisses a finding, with a reason, and it sticks', async () => {
    // `finding_triage` had a store, a contract and a place on the screen for
    // three slices before anything could write it. This is the write.
    const page = await openAuthenticatedPage();
    try {
      await page.goto(`${BASE}/clients/${CLIENT}/findings`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);

      await page.getByRole('button', { name: /^Dismiss button-name/ }).first().click();
      await page.getByLabel('Why is this not a barrier?').fill('Decorative, hidden from the tree.');
      await page.getByRole('button', { name: 'Dismiss', exact: true }).click();

      await expect
        .poll(() => page.innerText('body'), { timeout: 15_000 })
        .toContain('Decorative, hidden from the tree.');

      // Re-read from the server rather than trusting the optimistic-looking
      // DOM: the point of the decision is that it survives.
      await page.reload({ waitUntil: 'domcontentloaded' });
      const body = await page.innerText('body');
      expect(body).toContain('Dismissed: Decorative, hidden from the tree.');
      expect(body).toContain('Reopen this finding');
    } finally {
      await page.close();
    }
  }, 60_000);

  it('issues a shareable report that anyone can read, until it is revoked', async () => {
    // The one surface outside the auth gate. The token is the whole access
    // story, so this checks both halves of it: the link works without a
    // session, and it stops working when revoked.
    const page = await openAuthenticatedPage();
    let shareUrl: string;
    try {
      await page.goto(`${BASE}/clients/${CLIENT}/findings`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);

      await page.getByRole('button', { name: 'Issue a shareable report' }).click();
      await page.waitForSelector('a[href^="/r/"]', { timeout: 15_000 });
      shareUrl = (await page.getAttribute('a[href^="/r/"]', 'href')) ?? '';
      expect(shareUrl).toMatch(/^\/r\/.{40,}$/);
    } finally {
      await page.close();
    }

    // A fresh context: no cookie, no session, nothing but the URL.
    const anonymous = await browser.newPage();
    try {
      const response = await anonymous.goto(`${BASE}${shareUrl}`, {
        waitUntil: 'domcontentloaded',
      });
      expect(response?.status()).toBe(200);

      const body = await anonymous.innerText('body');
      expect(body).toContain('Harness Client');
      expect(body).toContain('button-name');
      // The criterion by name, not just its number: this is the page read by
      // people who do not know what 4.1.2 is.
      expect(body).toContain('Name, Role, Value');
      expect(body).toContain('Success criteria not met');
      // The shared page is the audit and nothing else: no way into the console
      // from it, and no other client's name on it.
      expect(body).not.toContain('Portfolio');
    } finally {
      await anonymous.close();
    }

    const reports = await fetch(`${BASE}/api/platform/clients/${CLIENT}/reports`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ id: await reportIdFor(shareUrl) }),
    });
    expect(reports.status, await reports.clone().text()).toBe(200);

    const afterRevoke = await browser.newPage();
    try {
      const response = await afterRevoke.goto(`${BASE}${shareUrl}`, {
        waitUntil: 'domcontentloaded',
      });
      expect(response?.status()).toBe(404);
    } finally {
      await afterRevoke.close();
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

  it('navigates by changing the URL, not by swapping state', async () => {
    // The prototype navigated with `useState`, so nothing was linkable. This
    // is the assertion that the restructure actually delivered its point.
    const page = await openAuthenticatedPage();
    try {
      await page.goto(`${BASE}/clients/${CLIENT}`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);

      await page.getByRole('link', { name: 'Journeys', exact: true }).click();
      await page.waitForURL(`**/clients/${CLIENT}/journeys`, { timeout: 15_000 });

      expect(new URL(page.url()).pathname).toBe(`/clients/${CLIENT}/journeys`);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('refuses a client that does not exist rather than showing another one', async () => {
    // The fixture lookup this replaces fell back to the first client, so any
    // unknown slug rendered one client's findings under another client's
    // address. That looks like an answer, which makes it worse than an error
    // page.
    const page = await openAuthenticatedPage();
    try {
      const response = await page.goto(`${BASE}/clients/does-not-exist`, {
        waitUntil: 'domcontentloaded',
      });

      expect(response?.status()).toBe(404);
      expect(await page.innerText('body')).not.toContain('Harness Client');
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
