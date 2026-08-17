import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { ENABLED_BY_US } from '../../../src/integrations/browser/axe-scan';

/**
 * The same rule set the product applies to a client's site.
 *
 * `AxeBuilder` defaults are not what a real scan uses: `scanPageWithAxe`
 * switches on the rules axe ships disabled, `target-size` among them. Sweeping
 * our own screens with the defaults meant holding clients to a standard this
 * product does not meet itself — and "who audits the auditor" is the entire
 * reason this block exists.
 */
const OUR_RULES = {
  rules: Object.fromEntries(ENABLED_BY_US.map((rule) => [rule, { enabled: true }])),
};
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
      AUDITOR_OPERATOR_NAME: 'Harness Operator',
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
      expect(text).toContain('Sign in');
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
      // The operator comes from the environment, not from a person we
      // invented — the header said "Jules Reyes" on every screen until it did.
      // Asserted on the accessible name, because the avatar renders initials
      // and the name is what a screen reader announces.
      expect(await page.getByLabel('Signed in as Harness Operator').innerText()).toBe('HO');
      expect(body).not.toContain('Jules Reyes');
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
      // axe's own sentence for the rule, carried from the engine through the
      // store to the screen. Nothing in this string was written by us.
      expect(body).toContain('Buttons must have discernible text');
      // And the fix, in the group axe put it in. `button-name` is an any-of
      // rule — inner text *or* aria-label *or* title will do — so a screen
      // that merged the groups would tell a developer to do all of them.
      expect(body).toContain('Fix any one of these');
      expect(body).toContain('aria-label attribute does not exist');
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
      expect(body).toContain('Buttons must have discernible text');
      // The people who open this link are usually the ones who have to act on
      // it, so it carries the fix and not just the failure.
      expect(body).toContain('Fix any one of these');
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

  it('serves an anonymous request no data at all — in the bytes, not just on screen', async () => {
    // The gap the test above could not see.
    //
    // `locks every route behind the operator session` asserts on
    // `innerText`, and it was green while every one of these routes shipped
    // the portfolio to anonymous callers. The group was gated in its layout,
    // and a layout cannot stop a page from running — only from being
    // composed. So the queries ran, and Next serialised the results into the
    // RSC flight payload embedded in the same response that rendered the
    // unlock card. A browser showed "Sign in". `curl` showed the client list.
    //
    // This reads the raw bytes for that reason, and issues a live report
    // first, because the worst of it was at `/reports`: `buildReports`
    // carries each report's `shareToken`, and that token is the only thing
    // protecting the unauthenticated `/r/[token]` page. Anonymous read of
    // that payload was a working key to every published report.
    const runs = await fetch(`${BASE}/api/audit/runs?limit=1`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const { runs: recent } = (await runs.json()) as { runs: Array<{ requestId: string }> };
    expect(recent.length).toBeGreaterThan(0);

    const issued = await fetch(`${BASE}/api/platform/clients/${CLIENT}/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ requestId: recent[0]!.requestId }),
    });
    const { report } = (await issued.json()) as { report?: { shareUrl?: string } };
    const shareToken = (report?.shareUrl ?? '').replace('/r/', '');
    expect(shareToken.length).toBeGreaterThan(20);

    // No cookie, and both request shapes: the plain document and the RSC
    // fetch a client navigation makes. Both leaked.
    for (const route of ROUTES) {
      for (const headers of [{}, { RSC: '1' }]) {
        const response = await fetch(`${BASE}${route}`, { headers });
        const body = await response.text();
        const where = `${route} ${JSON.stringify(headers)}`;

        expect(response.status, where).toBeLessThan(400);

        // The client's display name. It exists only in the store, so its
        // presence means `buildPortfolio`, `buildActivity`,
        // `buildClientDetail` or `buildFindingsView` ran for this caller.
        expect(body, where).not.toContain('Harness Client');

        // The slug too, but only where the caller did not supply it: a client
        // route echoes its own path segment back in the router state, which
        // tells an anonymous caller nothing it did not already type.
        if (!route.startsWith('/clients/')) {
          expect(body, where).not.toContain(CLIENT);
        }

        // A live key to a published report.
        expect(body, where).not.toContain(shareToken);

        // Findings are the substance of the product and the most sensitive
        // thing here: a client's unfixed accessibility barriers.
        expect(body, where).not.toContain('button-name');

        // And it must still be the locked screen rather than an error page: a
        // guard that threw would satisfy every assertion above. `PlatformLocked`
        // is a client component, so the plain document carries its rendered
        // text while the flight response carries only the module reference.
        expect(body, where).toContain('PlatformLocked');
        if (!('RSC' in headers)) {
          expect(body, where).toContain('Sign in');
        }
      }
    }
  }, 120_000);

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
      expect(await page.innerText('body')).not.toContain('Sign in');
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

  /**
   * The journeys screen can now start a run.
   *
   * Asserted against the *built* bundle, because that is the only thing that
   * catches the class of fault this suite exists for. The journey seeded here
   * names a target that is not reachable from CI, so the run is expected to
   * fail — the assertion is that the click reached the server and the journey
   * stopped reading "Never run", not that an audit of a real site succeeded.
   *
   * It uses its own journey and asserts only on the journeys screen, so it
   * cannot change which run is "latest" for the findings assertions above.
   *
   * The steps are load-bearing, not decoration. Seeded without them this
   * journey was the exact shape the fixture-walk bug ran on — a target and no
   * path through it — and the button it clicks is now correctly absent for
   * that shape, so the test would have polled a row reading "Never run" for
   * its full sixty seconds and called it a hydration failure.
   */
  it('starts a run from the journeys screen', async () => {
    await fetch(`${BASE}/api/platform/clients/${CLIENT}/journeys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        name: 'Run Now Journey',
        targetUrl: 'https://run-now.invalid/',
        steps: [{ action: 'navigate', type: 'goto', path: '/' }],
      }),
    });

    const page = await openAuthenticatedPage();
    try {
      await page.goto(`${BASE}/clients/${CLIENT}/journeys`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);

      // The per-row accessible name — without it every row is another
      // identical "Run now" in a screen reader's list.
      const button = page.getByRole('button', { name: 'Run Now Journey now' });
      await expect.poll(() => button.count(), { timeout: 15_000 }).toBe(1);

      await button.click();

      // Server truth, not the optimistic label: reload and assert the row
      // reports a run rather than "Never run".
      await expect
        .poll(
          async () => {
            await page.reload({ waitUntil: 'domcontentloaded' });
            const row = await page
              .locator('li', { hasText: 'Run Now Journey' })
              .first()
              .innerText();
            return row.includes('Never run');
          },
          { timeout: 60_000, intervals: [3000] },
        )
        .toBe(false);
    } finally {
      await page.close();
    }
  }, 120_000);

  /**
   * The step editor, which is the first screen that writes a journey.
   *
   * Everything the form decides is unit-tested as pure functions; none of that
   * proves a control on the page is connected to any of it. This is the half
   * only a real browser can answer: open the editor, add the step the journey
   * is missing, save, and check the *database* changed — not the optimistic
   * label the button prints.
   *
   * The seeded journey is deliberately the failing shape this whole plan is
   * named for: it navigates and never says it arrived, so the editor's nudge
   * has something true to say and the edit that clears it is the edit worth
   * testing.
   */
  it('rewrites a journey’s steps from the journeys screen', async () => {
    const created = await fetch(`${BASE}/api/platform/clients/${CLIENT}/journeys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        name: 'Editable Journey',
        targetUrl: 'https://editable.invalid/',
        steps: [{ action: 'navigate', type: 'goto', path: '/' }],
      }),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const { journey } = (await created.json()) as { journey: { id: string } };

    const page = await openAuthenticatedPage();
    try {
      await page.goto(`${BASE}/clients/${CLIENT}/journeys`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);

      const open = page.getByRole('button', { name: 'Edit steps for Editable Journey' });
      await expect.poll(() => open.count(), { timeout: 15_000 }).toBe(1);
      await open.click();

      // The Phase 4 nudge, on the screen where steps are written rather than
      // on a run result — a warning attached to an audit fires on healthy runs
      // and teaches an operator to dismiss the one that matters.
      const row = page.locator('li', { hasText: 'Editable Journey' }).first();
      await expect.poll(() => row.innerText()).toContain('never says it arrived');

      await row.getByRole('button', { name: 'Add a step' }).click();

      // Zero violations with the form open, and open in its *worst* state: a
      // half-finished row, so the red "needs a path" sentence and the reason
      // the disabled save button gives are both on the page when axe looks.
      // The route-level sweep below only ever sees the editor closed, so
      // without this the largest form in the product is the one screen the
      // auditor never audits.
      await expect.poll(() => row.innerText()).toContain('needs a path');
      const results = await new AxeBuilder({ page }).options(OUR_RULES).analyze();
      expect(
        results.violations
          .map((v) => `${v.id} (${v.impact}) × ${v.nodes.length}: ${v.nodes[0]?.target.join(' ')}`)
          .join('\n'),
      ).toBe('');

      const added = row.locator('fieldset').nth(1);
      await added.getByLabel('Does').selectOption('expect');
      await added.getByLabel('URL contains (optional)').fill('/dashboard');

      // Cleared by the edit, so the nudge is a live reading of the form and
      // not a sentence printed once when it opened.
      await expect.poll(() => row.innerText()).not.toContain('never says it arrived');

      await row.getByRole('button', { name: 'Save steps' }).click();

      // Server truth. The button clears itself on a 200, so asserting on the
      // screen would pass against a component that never spoke to the route.
      await expect
        .poll(
          async () => {
            const stored = await fetch(
              `${BASE}/api/platform/clients/${CLIENT}/journeys`,
              { headers: { authorization: `Bearer ${TOKEN}` } },
            );
            const { journeys } = (await stored.json()) as {
              journeys: Array<{ id: string; steps?: unknown[] }>;
            };
            return journeys.find((one) => one.id === journey.id)?.steps;
          },
          { timeout: 30_000, intervals: [1000] },
        )
        // The API's own projection, not the stored row: this route answers
        // with `toStepViews` so a literal value a legacy step is carrying
        // cannot be read back out of it. Still server truth — the shape and
        // order are the edit that was saved.
        .toEqual([
          { position: 1, action: 'navigate', type: 'goto', path: '/', recognised: true },
          {
            position: 2,
            action: 'navigate',
            type: 'expect',
            urlIncludes: '/dashboard',
            recognised: true,
          },
        ]);
    } finally {
      await page.close();
    }
  }, 120_000);

  /**
   * A control the operator just pressed keeps their place.
   *
   * Four call sites disabled a button as a *direct result* of clicking it. The
   * browser takes a `disabled` element out of the tab order, so focus fell to
   * `<body>` mid-interaction and the operator had to tab from the top of the
   * document — past the whole workspace nav — to get back to the thing they had
   * just asked for. The worst instance never came back at all: the handler
   * cleared the form, so the condition stayed true and the control stayed
   * disabled with focus nowhere.
   *
   * `lib/inert-button` is the fix: `aria-disabled` plus a guard in the handler,
   * so the control is inert without leaving the tab order, and the polite live
   * region beside it is not interrupted by having to announce some other
   * control instead.
   *
   * This is pinned in a browser because nothing else can see it. The markup is
   * valid and the control is correctly marked unavailable either way, so axe
   * passes on both — the zero-violation sweep below included. It was found by
   * reading the flow as a keyboard-only user, and this is what stops it coming
   * back the next time somebody reaches for `disabled`.
   */
  it('keeps focus on a control that its own click made unavailable', async () => {
    // Two journeys, because the run started below keeps polling and refreshing
    // the screen — the editor half should not be sharing a row with it.
    for (const name of ['Focus Journey', 'Focus Editor Journey']) {
      const created = await fetch(`${BASE}/api/platform/clients/${CLIENT}/journeys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          name,
          targetUrl: 'https://focus.invalid/',
          steps: [{ action: 'navigate', type: 'goto', path: '/' }],
        }),
      });
      expect(created.status, await created.clone().text()).toBe(201);
    }

    const page = await openAuthenticatedPage();

    /** What a screen reader would be on, right now. */
    const focused = () =>
      page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return 'body';
        return active.getAttribute('aria-label') ?? active.textContent?.trim() ?? active.tagName;
      });

    try {
      await page.goto(`${BASE}/clients/${CLIENT}/journeys`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);

      // 1. Run now — busy is the state its own click produces.
      const run = page.getByRole('button', { name: 'Run Focus Journey now' });
      await expect.poll(() => run.count(), { timeout: 15_000 }).toBe(1);
      await run.focus();
      // Enter on a focused button, not a mouse click: this is the interaction
      // the defect belongs to.
      await page.keyboard.press('Enter');

      // Waited on the label, which changes either way — polling the fix's own
      // attribute would make the wait part of what is being tested, and the
      // assertion that matters is the focus.
      await expect.poll(() => run.innerText(), { timeout: 15_000 }).not.toBe('Run now');
      expect(await focused()).toBe('Run Focus Journey now');
      // And how. `disabled` is what dropped focus, so its absence is the other
      // half: a future edit that reinstates it fails here rather than quietly
      // reintroducing the defect.
      expect(await run.getAttribute('aria-disabled')).toBe('true');
      expect(await run.evaluate((node: HTMLButtonElement) => node.disabled)).toBe(false);

      // 2. Save steps — inert because the form is incomplete, and inert has to
      // mean the handler does not run.
      const row = page.locator('li', { hasText: 'Focus Editor Journey' }).first();
      await row.getByRole('button', { name: 'Edit steps for Focus Editor Journey' }).click();
      await row.getByRole('button', { name: 'Add a step' }).click();
      await expect.poll(() => row.innerText()).toContain('needs a path');

      const save = row.getByRole('button', { name: 'Save steps' });
      expect(await save.getAttribute('aria-disabled')).toBe('true');
      await save.focus();
      await page.keyboard.press('Enter');
      expect(await focused()).toBe('Save steps');
      // Still open, still refusing: the guard held, so nothing was sent.
      await expect.poll(() => row.innerText()).toContain('needs a path');

      // 3. And the other half of the same problem — a save that succeeds
      // unmounts the form, so the focused button disappears with it. Closing
      // hands focus back to the control that opened the editor.
      const added = row.locator('fieldset').nth(1);
      await added.getByLabel('Does').selectOption('expect');
      await added.getByLabel('URL contains (optional)').fill('/done');
      await save.click();

      await expect.poll(focused, { timeout: 30_000 }).toBe('Edit steps for Focus Editor Journey');
    } finally {
      await page.close();
    }
  }, 120_000);

  /**
   * Evidence links must never appear on the public report.
   *
   * `/r/<token>` is deliberately outside the auth gate — the token is the whole
   * access-control story. The evidence behind a finding is screenshots and DOM
   * snapshots of a client's *authenticated* pages, so linking it from a page
   * anyone with the URL can read would hand those out with it. The shared
   * report is the sanitised view and has to stay that way.
   */
  it('never links run evidence from the public report page', async () => {
    // Issues its own report rather than borrowing one, so it does not depend
    // on the order of the tests above.
    const runs = await fetch(`${BASE}/api/audit/runs?limit=1`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const { runs: recent } = (await runs.json()) as { runs: Array<{ requestId: string }> };
    expect(recent.length).toBeGreaterThan(0);

    const issued = await fetch(`${BASE}/api/platform/clients/${CLIENT}/reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ requestId: recent[0]!.requestId }),
    });
    const { report } = (await issued.json()) as { report?: { shareUrl?: string } };
    expect(report?.shareUrl).toBeTruthy();

    const page = await browser.newPage();
    try {
      await page.goto(`${BASE}${report!.shareUrl}`, { waitUntil: 'domcontentloaded' });

      const hrefs = await page.evaluate(() =>
        [...document.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href') ?? ''),
      );

      expect(hrefs.some((href) => href.includes('/artifacts/'))).toBe(false);
    } finally {
      await page.close();
    }
  }, 60_000);

  it('marks no workspace tab as current while on a client screen', async () => {
    // `parseRoute` resolves anything that is not a workspace path to the
    // portfolio, so this said `aria-current="page"` on Portfolio — and painted
    // it accented — while the operator was looking at a client.
    const page = await openAuthenticatedPage();
    try {
      await page.goto(`${BASE}/clients/${CLIENT}`, { waitUntil: 'domcontentloaded' });

      const current = await page.locator('nav[aria-label="Workspace"] [aria-current]').count();
      expect(current).toBe(0);

      // And it comes back on a workspace screen, or the marker means nothing.
      await page.goto(`${BASE}/activity`, { waitUntil: 'domcontentloaded' });
      expect(
        await page.locator('nav[aria-label="Workspace"] [aria-current="page"]').innerText(),
      ).toBe('Activity');
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

      const results = await new AxeBuilder({ page }).options(OUR_RULES).analyze();

      // Name the rule and the element on failure: "expected 0, got 2" would
      // send the next reader back to a browser to find out what broke. The
      // landmark outline comes along because a landmark rule is meaningless
      // without knowing what the page actually rendered — CI once failed
      // `landmark-one-main` on routes that were green locally, and the bare
      // rule id said nothing about why.
      const outline = await page.evaluate(() => ({
        mains: document.querySelectorAll('main').length,
        banners: document.querySelectorAll('header').length,
        locked: document.body.innerText.includes('Sign in'),
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
