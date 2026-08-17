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

  /**
   * The discovery panel, in the only state that has all of its markup on
   * screen at once.
   *
   * **Nothing in CI can be crawled.** `target-url.ts` blocks loopback and
   * RFC1918 and re-checks every address a hostname resolves to, so this
   * suite's own `localhost:3417` is refused by design — there is no site here
   * to point discovery at. The crawl is therefore stubbed at the route with
   * `page.route`. The *write* below is not, and that asymmetry is the point:
   * a stubbed crawl still exercises every line of the panel that turns a
   * response into markup, while a stubbed write would prove nothing about
   * whether the panel can create a journey.
   *
   * One stub carrying pages, errors and truncation, because all three are
   * different markup — grouped fieldsets, a labelled error list, an advisory
   * paragraph — and a browser run costs two minutes. The refusal wording is
   * pinned by `tests/app/discovery-copy.test.ts`, which needs no browser at
   * all, so there is no second stub here for it.
   *
   * The inline axe run has the same justification as the step editor's: the
   * route-level sweep below only ever sees this panel idle and empty, so
   * without this the list an operator actually works in is the one screen the
   * auditor never audits.
   */
  it('renders discovered pages, errors and truncation with no axe violations', async () => {
    const page = await openAuthenticatedPage();
    try {
      await page.route('**/api/platform/discover', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            requestId: 'stubbed',
            // Three depths, so more than one `<fieldset>`/`<legend>` group is
            // on screen. No title here may contain a journey name — the list
            // below this panel is matched with `hasText`, and a page titled
            // "Editable Journey" would be found by the step editor's test.
            pages: [
              { url: 'https://discovered.invalid/', title: 'Front door', depth: 0 },
              { url: 'https://discovered.invalid/pricing', title: 'Pricing', depth: 1 },
              // No `<title>` on the document. Playwright's `page.title()`
              // returns `''` for one, which is ordinary on real sites, and
              // every other stub here has a title — so this is the row that
              // catches a label built with `title || path` printing the path
              // twice.
              { url: 'https://discovered.invalid/untitled', title: '', depth: 1 },
              { url: 'https://discovered.invalid/pricing/teams', title: 'Teams', depth: 2 },
              // Longer than a `goto` step's path may be. A discovered href may
              // run to `MAX_HREF_LENGTH`, four times `MAX_STEP_TEXT`, so this
              // is a real shape and not a contrivance.
              {
                url: `https://discovered.invalid/long/${'a'.repeat(600)}`,
                title: 'Very long address',
                depth: 2,
              },
            ],
            // The URL *and* the message, which is the pair the crawler's own
            // comment argues for: either alone is unreadable.
            errors: [
              {
                url: 'https://discovered.invalid/offsite-redirect.html',
                message: 'Host elsewhere.test is not in the allowed domains',
              },
            ],
            errorsOmitted: 4,
            truncated: { reason: 'budget', seen: 137 },
          }),
        }),
      );

      await page.goto(`${BASE}/clients/${CLIENT}/journeys`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);

      await page.getByLabel('Site address').fill('https://discovered.invalid/');
      await page.getByRole('button', { name: 'Find pages' }).click();

      // The panel is a client component talking to a route, so wait for the
      // markup rather than assuming the fetch resolved within a tick.
      const panel = page.locator('section', { hasText: 'Discover pages' }).first();
      await expect.poll(() => panel.innerText(), { timeout: 15_000 }).toContain('Front door');

      // All three shapes really are on screen. Without this the axe run below
      // would pass against a panel that rendered none of them.
      const text = await panel.innerText();
      expect(text).toContain('One click from there');
      expect(text).toContain('At least 137');
      // `kept + omitted`, not `errors.length`: one error listed, five counted.
      // One listed, five counted — and the grammar of the shape that produces
      // it, which is the commonest one: a hub of dead links fills the ceiling
      // and leaves a one-row list under the heading.
      expect(text).toContain('5 pages could not be read. The first one is listed below.');
      // Both halves of an error row, which is the crawler's own worked
      // example: the path alone reads as "your own page is not in your allowed
      // domains", which is nonsense, and the message alone names nothing the
      // operator can search their markup for.
      expect(text).toContain('/offsite-redirect.html');
      expect(text).toContain('Host elsewhere.test is not in the allowed domains');

      // An untitled page announces its path once, not twice. `exact` is the
      // whole assertion: `title || path` produces "/untitled /untitled", which
      // a substring match would happily find.
      await expect
        .poll(() => page.getByRole('checkbox', { name: '/untitled', exact: true }).count())
        .toBe(1);

      // A page the step format cannot hold: refused at selection time, beside
      // the row, rather than as a nameless `invalid_request_body` after the
      // journey is posted.
      const longBox = page.getByRole('checkbox', { name: /Very long address/ });
      expect(await longBox.isDisabled()).toBe(true);
      expect(text).toContain('too long to record as a step');

      // The bulk control takes the four it may and leaves the fifth, which is
      // the state no click could otherwise produce.
      await page.getByRole('button', { name: 'Select every page' }).click();
      await expect.poll(() => panel.innerText()).toContain('4 pages picked');
      expect(await longBox.isChecked()).toBe(false);

      // With the name still empty, so the sentence explaining the disabled
      // Create button is on the page when axe looks.
      await expect.poll(() => panel.innerText()).toContain('Give the journey a name');

      // The selection count is a live region as well as a describedby target.
      // Both bulk controls leave focus on themselves, so as a describedby
      // target alone this sentence is read on focus and never on change — and
      // axe cannot see the difference, which is why it is asserted here.
      expect(await panel.locator('p[aria-live="polite"]', { hasText: 'picked.' }).count()).toBe(1);

      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations
          .map((v) => `${v.id} (${v.impact}) × ${v.nodes.length}: ${v.nodes[0]?.target.join(' ')}`)
          .join('\n'),
      ).toBe('');

      // A failed *second* crawl. The list from the first deliberately stays —
      // blanking somebody's work over a typo'd address is the worse mistake —
      // but the status region must stop claiming a count for a site the
      // operator has moved off, or it contradicts the alert beside it.
      await page.unroute('**/api/platform/discover');
      await page.route('**/api/platform/discover', (route) =>
        route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'entry_point_redirected', host: 'www.elsewhere.test' }),
        }),
      );
      await page.getByLabel('Site address').fill('https://moved.invalid/');
      await page.getByRole('button', { name: 'Find pages' }).click();

      // The refusal names the host the route shipped as structured data.
      await expect
        .poll(() => panel.innerText(), { timeout: 15_000 })
        .toContain('www.elsewhere.test');
      // The list survived…
      expect(await panel.innerText()).toContain('Front door');
      // …and the status region is silent rather than re-announcing the count.
      expect(await panel.locator('p[role="status"]').first().innerText()).toBe('');
    } finally {
      await page.close();
    }
  }, 120_000);

  /**
   * The write: ticked pages become a stored journey of `goto` steps.
   *
   * Asserted by reading `GET /journeys` back rather than off the screen. The
   * panel clears its own selection on a 201, so the screen looks exactly the
   * same whether the route was called or not — a screen assertion here would
   * pass against a component that never spoke to the server, which is the
   * failure mode this whole suite exists for.
   *
   * The pages are ticked **deepest first**, which is what makes the order in
   * the assertion mean something: a `Set` iterates in insertion order, so a
   * panel that built its steps by spreading the selection would store the leaf
   * page as step 1 and this would fail. Ticking in crawl order would not tell
   * the two implementations apart.
   */
  it('creates a journey from the pages an operator ticks', async () => {
    const page = await openAuthenticatedPage();
    try {
      await page.route('**/api/platform/discover', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            requestId: 'stubbed',
            pages: [
              { url: 'https://picked.invalid/', title: 'Front door', depth: 0 },
              { url: 'https://picked.invalid/pricing', title: 'Pricing', depth: 1 },
              { url: 'https://picked.invalid/pricing/teams', title: 'Teams', depth: 2 },
            ],
            errors: [],
          }),
        }),
      );

      await page.goto(`${BASE}/clients/${CLIENT}/journeys`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);

      await page.getByLabel('Site address').fill('https://picked.invalid/');
      await page.getByRole('button', { name: 'Find pages' }).click();

      const panel = page.locator('section', { hasText: 'Discover pages' }).first();
      await expect.poll(() => panel.innerText(), { timeout: 15_000 }).toContain('Front door');

      await page.getByRole('checkbox', { name: 'Teams /pricing/teams' }).check();
      await page.getByRole('checkbox', { name: 'Pricing /pricing' }).check();
      await page.getByRole('checkbox', { name: 'Front door /' }).check();

      // The address box is edited *after* the result landed and before the
      // journey is saved, which is the ordinary thing an operator does when
      // they line up the next site while reading this list. It is also the
      // only way the `targetUrl` assertion below means anything: a panel that
      // read the origin off this box at save time would store
      // `https://somewhere-else.invalid` and pass every other assertion here.
      await page.getByLabel('Site address').fill('https://somewhere-else.invalid/');

      // The route's own cap, met while typing rather than as a nameless
      // `invalid_request_body` after the journey is posted.
      expect(await page.getByLabel('Journey name').getAttribute('maxlength')).toBe('120');

      // Neither substring of the two journey names the tests above locate by.
      await page.getByLabel('Journey name').fill('Picked Pages');
      await page.getByRole('button', { name: 'Create journey' }).click();

      // Server truth.
      await expect
        .poll(
          async () => {
            const stored = await fetch(`${BASE}/api/platform/clients/${CLIENT}/journeys`, {
              headers: { authorization: `Bearer ${TOKEN}` },
            });
            const { journeys } = (await stored.json()) as {
              journeys: Array<{ name: string; targetUrl?: string; steps?: unknown[] }>;
            };
            const match = journeys.find((one) => one.name === 'Picked Pages');
            return match ? { targetUrl: match.targetUrl, steps: match.steps } : null;
          },
          { timeout: 30_000, intervals: [1000] },
        )
        .toEqual({
          // The origin captured when the result landed, not re-read off the
          // address box at save time — the operator may have typed the next
          // site into it while reading the list.
          targetUrl: 'https://picked.invalid',
          // Crawl order, from a deepest-first set of ticks.
          steps: [
            { position: 1, action: 'navigate', type: 'goto', path: '/', recognised: true },
            { position: 2, action: 'navigate', type: 'goto', path: '/pricing', recognised: true },
            {
              position: 3,
              action: 'navigate',
              type: 'goto',
              path: '/pricing/teams',
              recognised: true,
            },
          ],
        });
    } finally {
      await page.close();
    }
  }, 120_000);

  /**
   * The bulk control at the boundary a crawl actually reaches.
   *
   * `authoredStepsSchema` caps a journey at `MAX_STEPS_PER_JOURNEY` (50)
   * *before* it parses an element, and a crawl stopped by `MAX_DISCOVERY_URLS`
   * returns exactly 100 pages. So one click of "Select every page" on a large
   * site used to build a body the route refuses with `invalid_request_body` —
   * a code naming neither the field nor the number, whose copy then told the
   * operator to shorten the name and untick the longest page. Neither is the
   * fix; the fix is to untick fifty.
   *
   * 60 pages rather than 100: past the cap by enough that the prefix and the
   * remainder are both unambiguous, and small enough that the stub stays
   * readable. No axe run here — the maximal-state test above covers the
   * markup, and this one is about a number.
   */
  it('will not build a journey longer than the route will store', async () => {
    const page = await openAuthenticatedPage();
    try {
      await page.route('**/api/platform/discover', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            requestId: 'stubbed',
            // Zero-padded defensively, not because anything here needs it:
            // the accessible name is `Page 5 /p5`, and the space before the
            // path already stops it being a substring of `Page 50 /p50`. An
            // earlier version of this comment claimed the padding was
            // load-bearing; it is not, and the collision it described exists
            // only when matching on the title alone, which this test does not
            // do.
            pages: Array.from({ length: 60 }, (_, index) => ({
              url: `https://sixty.invalid/p${String(index).padStart(2, '0')}`,
              title: `Page ${String(index).padStart(2, '0')}`,
              depth: index === 0 ? 0 : 1,
            })),
            errors: [],
          }),
        }),
      );

      await page.goto(`${BASE}/clients/${CLIENT}/journeys`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);

      await page.getByLabel('Site address').fill('https://sixty.invalid/');
      await page.getByRole('button', { name: 'Find pages' }).click();

      const panel = page.locator('section', { hasText: 'Discover pages' }).first();
      await expect.poll(() => panel.innerText(), { timeout: 15_000 }).toContain('Page 00');

      // Said before the click, so an operator is not left thinking the bulk
      // control half-worked.
      expect(await panel.innerText()).toContain('takes the first 50');

      // A name first, so the block asserted below is attributable to the
      // count and not to an empty name field.
      await page.getByLabel('Journey name').fill('Boundary Check');

      const create = page.getByRole('button', { name: 'Create journey' });

      // Select-all takes a storeable prefix rather than all 60 — the same move
      // as skipping a `tooLong` row: a state the operator could have reached
      // by clicking, with prose saying what was left out.
      await page.getByRole('button', { name: 'Select every page' }).click();
      await expect.poll(() => panel.innerText()).toContain('50 pages picked');
      expect(await create.isDisabled()).toBe(false);

      // And the cap is not merely a property of that button: ticking one more
      // by hand blocks the create, and the prose says how many to remove
      // rather than sending the operator to shorten a name that is fine.
      await page.getByRole('checkbox', { name: 'Page 55 /p55' }).check();
      await expect.poll(() => panel.innerText()).toContain('51 pages picked');
      expect(await create.isDisabled()).toBe(true);

      const text = await panel.innerText();
      expect(text).toContain('A journey holds at most 50 steps, and 51 pages are picked.');
      expect(text).toContain('Untick 1');

      // And inside the announced region, not merely on the page. The count
      // change is what a screen reader hears; without the remedy in the same
      // paragraph it hears "51 pages picked" and nothing about the Create
      // button having just died.
      expect(await panel.locator('p[aria-live="polite"]', { hasText: 'Untick 1' }).count()).toBe(1);

      // The count is reported *before* the missing name, and until now that
      // ordering was argued in a comment and exercised by nothing — this test
      // filled the name first precisely so the block would be attributable.
      // An operator who is told to name the journey, does so, and is still
      // blocked has learned nothing, so the more structural problem wins.
      await page.getByLabel('Journey name').fill('');
      await expect.poll(() => panel.innerText()).toContain('Untick 1');
      expect(await panel.innerText()).not.toContain('Give the journey a name');
    } finally {
      await page.close();
    }
  }, 120_000);

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
