import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
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

/**
 * Identifies the server *this* run started.
 *
 * The port is fixed, so a second concurrent run's `next start` fails to bind
 * while `/api/health` keeps answering — from the first run's server. The suite
 * then drove a process it did not own, both runs seeded journeys into the same
 * in-memory store, and the duplicates surfaced as ordinary-looking assertion
 * failures ("expected 2 to be 1") that named the screen under test and never
 * the real cause. The server echoes this value back, so answering is not
 * enough: the answer has to come from our own process.
 */
const INSTANCE = randomUUID();

let server: ChildProcess;
let browser: Browser;
/** Kept so a startup failure reports what the server said, not just a timeout. */
let serverOutput = '';

/** Is something already listening on the port we are about to take? */
function portIsInUse(port: number, timeoutMs = 2_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    const settle = (inUse: boolean) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}

async function waitForServer(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let health: { instance?: string | null } | null = null;
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) health = (await response.json()) as { instance?: string | null };
    } catch {
      // Not listening yet.
    }

    if (health) {
      if (health.instance === INSTANCE) return;
      throw new Error(
        `${BASE}/api/health is answering, but from a server this run did not start ` +
          `(instance ${health.instance ?? 'unset'}, expected ${INSTANCE}).\n` +
          `Port ${PORT} belongs to another process — most likely a concurrent ` +
          `\`npm run test:hydration\`. This suite is not safe to run twice at once: ` +
          `both runs share one in-memory store, and the duplicate data fails the ` +
          `assertions below in ways that look like product bugs. Wait for the other ` +
          `run to finish, or kill it.`,
      );
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

/**
 * One axe pass, rendered as the string the assertions compare against ''.
 *
 * Always through `expect.poll` below, never once. Three assertions in this file
 * have now failed as a one-shot read of something that becomes true
 * asynchronously — `polls > 0`, the stage-heading focus check, and the
 * `document-title` violation that reddened master after #67 — and the scan is
 * the same shape as all three: it reads live DOM at whatever instant it
 * happens to run.
 *
 * The previous attempt at the last of those polled `page.title()` and then
 * scanned. That narrows the window; it cannot close it. `axe-core`'s
 * `doc-has-title` check is `var title = document.title; return
 * !!sanitize(title)` — evaluated *during* `analyze()`, a second or so after
 * the poll that proved the title was there. Polling the scan itself is what
 * closes it, because the thing being retried is the thing that can be
 * transiently wrong.
 *
 * It weakens nothing. A real violation is still a violation on every attempt,
 * so it survives to the timeout and fails with its rule id and selector
 * intact; only a state that stops being true clears. The cost is that a
 * genuine regression takes the timeout to go red instead of failing at once.
 */
async function axeViolations(page: Page, builder = { options: OUR_RULES }): Promise<string> {
  const results = await new AxeBuilder({ page }).options(builder.options).analyze();
  return results.violations
    .map((v) => `${v.id} (${v.impact}) × ${v.nodes.length}: ${v.nodes[0]?.target.join(' ')}`)
    .join('\n');
}

/** How long a scan may keep coming back dirty before the violations are real. */
const AXE_SETTLE = { timeout: 15_000, interval: 1_000 } as const;

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

  // Fail here, loudly, rather than 30 assertions later against someone else's
  // server. `next start` cannot bind a taken port, but the suite would never
  // notice: `/api/health` answers, from whatever is already there.
  if (await portIsInUse(PORT)) {
    throw new Error(
      `Port ${PORT} is already in use, so this run cannot start its own server.\n` +
        `Most likely another \`npm run test:hydration\` owns it — this suite is not ` +
        `safe to run concurrently, because both runs would share one in-memory store.\n` +
        `Stop the other run (or whatever holds ${PORT}) and try again.`,
    );
  }

  server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AUDITOR_RUN_TOKEN: TOKEN,
      // Echoed by `/api/health`, so `waitForServer` can tell our server from a
      // foreign one holding the port.
      AUDITOR_INSTANCE_ID: INSTANCE,
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
  '/clients/new',
  `/clients/${CLIENT}`,
  `/clients/${CLIENT}/setup`,
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

  it('starts with an empty portfolio and onboards a client through the wizard', async () => {
    // The one path that decides whether this product has a front door: the
    // portfolio is empty until an operator adds someone, and onboarding them
    // has to actually reach the store and come back at every stage.
    //
    // It runs first on purpose, and the client it onboards is the one every
    // client route below visits. Seeding in `beforeAll` instead would have made
    // "starts empty" untestable — and a seeded fixture is exactly what this
    // phase removed.
    //
    // The predecessor of this test clicked through a modal, and its central
    // assertion was that "No clients yet" disappeared — which it took as proof
    // that a write had reached the store and come back. Under the wizard that
    // proof evaporated without failing: the button now *navigates* to
    // `/clients/new`, a page that never contained that string, so the check
    // went green before any client existed. Hence every stage below ends by
    // reading state back from a fresh render of a screen that can only know it
    // from the database — the portfolio row, or the record over the API.
    const page = await openAuthenticatedPage();

    // Every poll the first-audit stage makes, timestamped. `FirstRunControl`
    // has two ways in — the click handler and the `pollUrl` effect that fires
    // when the refresh flips the stage to `running` — and since the dispatcher
    // renders both stages through one slot, the same mounted instance takes
    // both. A `watching` ref is the only thing making them mutually exclusive,
    // and nothing else in the suite would notice if it were refactored away:
    // the button still behaves and results still appear at twice the request
    // rate. Asserted below on the shape a doubled loop has, not on a count
    // alone, because run duration here is not ours to fix.
    const polls: number[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/audit/runs/')) polls.push(Date.now());
    });

    try {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);

      expect(await page.innerText('body')).toContain('No clients yet');

      // ---- Stage 1: the client. A route now, not a modal. ----
      await page.getByRole('button', { name: 'Add the first client', exact: true }).click();
      await expect.poll(() => page.url(), { timeout: 15_000 }).toContain('/clients/new');
      await page.getByLabel('Client name').fill('Harness Client');
      await page.getByLabel('Owner').fill('Alex Reed');
      await page.getByRole('button', { name: 'Add client', exact: true }).click();

      // The write is what earns the next stage: the URL is the client's own
      // setup route, so the slug came back from the store.
      await expect
        .poll(() => page.url(), { timeout: 15_000 })
        .toContain(`/clients/${CLIENT}/setup`);
      await expect
        .poll(() => page.innerText('body'), { timeout: 15_000 })
        .toContain('Where do we audit?');

      // A stage change that swaps the component moves focus to its heading, so
      // a screen-reader user hears where the flow went. Only these
      // transitions: `first-run` → `running` is served by one component and is
      // announced by its live region instead, so focus deliberately stays put
      // there and is not asserted.
      //
      // Polled, not read once. The heading text above is in the render; the
      // focus is set by `StageHeading`'s mount effect, which runs after it, so
      // a single read can land in the window between them and see `BODY`. That
      // window is small and this has never failed — but it is the same shape as
      // the assertion that did (a one-shot read of something that becomes true
      // asynchronously), and this suite's own idiom for anything after a
      // navigation is `expect.poll`.
      await expect
        .poll(() => page.evaluate(() => document.activeElement?.tagName), { timeout: 15_000 })
        .toBe('H2');

      // ---- The portfolio knows: a client with no completed run. ----
      // "Never audited" and the setup hint answer different questions, and
      // this is the only point in the walk where both are true at once.
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);
      const seeded = await page.innerText('body');
      expect(seeded).not.toContain('No clients yet');
      expect(seeded).toContain('Harness Client');
      expect(seeded).toContain('Never audited');
      expect(seeded).toContain('Setup incomplete');
      // The operator comes from the environment, not from a person we
      // invented — the header said "Jules Reyes" on every screen until it did.
      // Asserted on the accessible name, because the avatar renders initials
      // and the name is what a screen reader announces.
      expect(await page.getByLabel('Signed in as Harness Operator').innerText()).toBe('HO');
      expect(seeded).not.toContain('Jules Reyes');

      // Axe here, not only in the route loop at the bottom of this file. That
      // loop walks each route once, in whatever state the suite has left it —
      // and by then this client is fully onboarded, so the incomplete-setup
      // hint has retired and no axe pass has ever rendered it. State-dependent
      // UI only gets covered from inside the walk that produces the state.
      //
      // Polled, for the reason `axeViolations` gives: this scan is a live read
      // of the DOM, and a transient — `document-title` against a page whose
      // metadata has not landed yet — reddened master once already.
      await expect
        .poll(() => axeViolations(page), {
          ...AXE_SETTLE,
          message: 'portfolio with the setup-incomplete hint',
        })
        .toBe('');

      // ---- Stage 2: where. Deep-linked, because the wizard holds no state:
      // coming back to the route lands on whatever stage the record earned. ----
      await page.goto(`${BASE}/clients/${CLIENT}/setup`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);
      expect(await page.innerText('body')).toContain('Where do we audit?');

      // `.invalid` is reserved and cannot resolve, which is what makes the
      // failure stage below reachable on purpose rather than by luck.
      await page.getByLabel('Their website').fill('https://wizard-target.invalid/shop');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();

      // A runnable journey with no run yet: the first-audit stage.
      await expect
        .poll(() => page.innerText('body'), { timeout: 15_000 })
        .toContain('Run the first audit');

      // The homepage fast path wrote the journey and its one step itself, and
      // kept the pasted path rather than flattening it to "/" — asserted on
      // the record, which is the only place that can prove it.
      const listed = await fetch(`${BASE}/api/platform/clients/${CLIENT}/journeys`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      const { journeys } = (await listed.json()) as {
        journeys: Array<{ id: string; name: string; steps?: Array<{ path?: string }> }>;
      };
      const wizardJourney = journeys.find((journey) => journey.name === 'Homepage');
      expect(wizardJourney, `journeys: ${JSON.stringify(journeys)}`).toBeTruthy();
      expect(wizardJourney!.steps?.[0]?.path).toBe('/shop');

      // ---- Saving steps verifies them, with nothing else pressed. ----
      // The stage's copy promises the sequence; this is the half that used to
      // be an instruction. Asserted here because this is the only place in the
      // suite where the editor and the verify control are on screen together —
      // the journeys screen has the editor and no verify, which is also why
      // that test can prove a save there does *not* start a walk.
      // Unscoped, unlike the journeys-screen test: there the editor sits in a
      // per-journey <li>, and here the stage renders exactly one, directly.
      await page.getByRole('button', { name: 'Edit steps for Homepage' }).click();
      await page.getByRole('button', { name: 'Add a step' }).click();
      const newStep = page.locator('fieldset').nth(1);
      await newStep.getByLabel('Does').selectOption('expect');
      await newStep.getByLabel('URL contains (optional)').fill('/shop');
      await page.getByRole('button', { name: 'Save steps' }).click();

      // The walk starts itself and reports. `.invalid` cannot resolve, so the
      // outcome is a failure panel — which is still proof the verify ran
      // without the button being pressed, and cheaper to wait for than a
      // success would be.
      await expect
        .poll(() => page.innerText('body'), { timeout: 90_000, interval: 1000 })
        .toContain('The walk stopped before the end.');

      // ---- The failure stage: an operator's first audit not finishing is a
      // state the product has to explain, not a dead end. ----
      const startedAt = Date.now();
      await page.getByRole('button', { name: /Run the first audit/ }).click();
      await expect
        .poll(() => page.innerText('body'), { timeout: 120_000, interval: 1000 })
        .toContain('The first audit stopped');

      const failed = await page.innerText('body');
      expect(failed).toContain('Stopped:'); // the classified reason
      expect(failed).toContain('Verify so far'); // the editor's way back
      expect(failed).toContain('start over'); // the URL's way back

      // The failed stage is the richest composite state the wizard renders —
      // banner, editor, credentials, verify, run, archive all at once — and
      // the route sweep at the bottom of this file only ever sees terminal
      // states (it walks each route once, cold). After Fixes 1-2 this state
      // includes the editor and the credentials panel, which is the point:
      // nothing here has been swept by axe until this assertion exists.
      //
      // This is the scan that reported `document-title (serious) × 1: html`
      // and turned master red after #67 — see `axeViolations` for why polling
      // the scan is the fix and polling `page.title()` in front of it was not.
      await expect
        .poll(() => axeViolations(page), {
          ...AXE_SETTLE,
          message: 'the failed stage, with the editor and credentials panel restored',
        })
        .toBe('');

      // One watcher, not two. A doubled loop shows up as near-simultaneous
      // pairs — both loops sleep the same 3s, so they stay in lockstep a few
      // hundred ms apart — and as a total that outruns the elapsed time. One
      // loop cannot fire twice inside its own interval, so any gap this short
      // is a second watcher.
      const elapsed = Date.now() - startedAt;
      // No `polls.length > 0` here, deliberately. A watcher sleeps 3s before
      // its first fetch, and this journey's target cannot resolve — the run
      // reaches its failed row well inside that window, `start()`'s refresh
      // renders `FailedStage` in a different JSX slot, and unmounting
      // `FirstRunControl` cancels the watcher before it ever fetched. Zero
      // polls is what entirely healthy code does here often enough to have
      // flaked in CI once already. The two assertions below carry the whole
      // regression value and are vacuously true when the run dies that fast.
      //
      // Which used to be the whole problem: on CI, where zero polls is the
      // normal outcome, these assertions check nothing, so a green suite was
      // not evidence the doubled-watcher defect was still fixed. That is no
      // longer what the property rests on. `FirstRunControl` has one entry
      // into its watcher — the `[pollUrl]` effect, which also owns the
      // cancellation — so a second loop is not something a guard refuses, it
      // is something the code cannot express. `start()` no longer polls.
      //
      // These stay as a tripwire against that being undone, and they are
      // honest about their reach: armed only when a poll actually fires,
      // which on this journey is seldom. The guarantee is structural; this is
      // the alarm on top of it.
      const gaps = polls.slice(1).map((at, index) => at - polls[index]!);
      expect(gaps.filter((gap) => gap < 500), `poll gaps (ms): ${gaps.join(', ')}`).toEqual([]);
      // The bound has no slack on purpose. A watcher sleeps *before* its first
      // fetch and before every retry, so one loop cannot have polled more times
      // than whole intervals have elapsed — and `elapsed` is measured from
      // before the click, so it is generously larger than the last poll's own
      // timestamp. Slack of `+1` here would have made this assertion useless
      // against the defect it exists for: this journey's target cannot resolve,
      // so the run dies on its first poll, and a second watcher shows up as
      // exactly 2 polls where 1 was possible.
      expect(polls.length, `polls in ${elapsed}ms: ${polls.length}`).toBeLessThanOrEqual(
        Math.floor(elapsed / 3000),
      );

      // ---- Still unfinished, and now with a run to its name. This is the
      // case `lastRun` cannot express: the row carries a verdict, so the
      // never-audited copy is gone, and setup is still not done. ----
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);
      const afterFailure = await page.innerText('body');
      expect(afterFailure).not.toContain('Never audited');
      expect(afterFailure).toContain('Setup incomplete');

      // ...and the state it names is reachable from where the row lands. This
      // is the assertion the hint's own correctness depends on: the overview
      // renders `lastRun ? summary : empty`, and only the empty state used to
      // carry the Finish-setup link — so a *failed* first audit set `lastRun`,
      // skipped the empty state, and left the one client who most needed the
      // wizard with no way back into it. The route sweep at the bottom of this
      // file cannot catch that: it reaches this page only after the walk has
      // completed a run, when `hasCompletedRun` is true and the link is
      // correctly absent. The client name comes first because a bare check for
      // the link would pass just as happily on a locked shell.
      await page.goto(`${BASE}/clients/${CLIENT}`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);
      const overview = await page.innerText('body');
      expect(overview).toContain('Harness Client');
      expect(overview).toContain('Finish setup');

      // ---- The terminal stage. The chaos scenario is how this suite gets a
      // run that completes against a real browser; `?wait=1` holds the
      // connection so there is nothing to poll for here. ----
      const completed = await fetch(`${BASE}/api/audit/run?wait=1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({
          journeyId: wizardJourney!.id,
          environment: 'staging',
          chaosScenario: 'browser_passthrough_violations',
        }),
      });
      expect([200, 202], await completed.clone().text()).toContain(completed.status);

      // Rendered, not redirected: revisiting /setup on a finished client is a
      // page, so the route stays idempotent.
      await page.goto(`${BASE}/clients/${CLIENT}/setup`, { waitUntil: 'domcontentloaded' });
      await expect
        .poll(() => page.innerText('body'), { timeout: 30_000 })
        .toContain('First audit complete');
      const terminal = await page.innerText('body');
      expect(terminal).toContain('Go to the findings');

      // The enrichment prompt. This client has exactly the one journey the
      // wizard walked, which is the only state the prompt appears in — an
      // operator who has already recorded a second one is not asked again.
      expect(terminal).toContain('record that journey to audit what they actually hit');
      expect(
        await page.getByRole('link', { name: 'Record another journey' }).getAttribute('href'),
      ).toBe(`/clients/${CLIENT}/journeys`);

      // And the hint retires itself — derived, never stored, so nothing had to
      // remember to clear it. The row is asserted positively first: a negative
      // alone would pass on a locked shell or an error page.
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);
      const finalPortfolio = await page.innerText('body');
      expect(finalPortfolio).toContain('Harness Client');
      expect(finalPortfolio).not.toContain('Setup incomplete');
    } finally {
      await page.close();
    }
  }, 240_000);


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
    // Typed, because the inferred union of `{}` and `{ RSC: string }` is not
    // assignable to `HeadersInit` — the empty shape widens `RSC` to
    // `undefined`. `tsc` never saw this file until the typecheck config that
    // includes `tests/integrations/**` existed.
    const requestShapes: Array<Record<string, string>> = [{}, { RSC: '1' }];

    for (const route of ROUTES) {
      for (const headers of requestShapes) {
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
          { timeout: 60_000, interval: 3000 },
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
      // Polled like the two in the wizard walk. This one sits behind a
      // client-side click with no navigation in front of it, so it is the same
      // live-DOM read they are — it was simply not among the two the previous
      // fix reached.
      await expect
        .poll(() => axeViolations(page), {
          ...AXE_SETTLE,
          message: 'the steps editor, open on a half-finished row',
        })
        .toBe('');

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
          { timeout: 30_000, interval: 1000 },
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
      // Still open, still refusing. `save()` guards `!writable.ok` itself, so
      // this alone would pass with the guard in `inertWhen` deleted — the
      // request it uniquely stops is a *second* PATCH while one is in flight,
      // which `disabled` used to stop at the DOM level. Asserted below.
      await expect.poll(() => row.innerText()).toContain('needs a path');

      // 2b. Reordering, where the place can be lost a second way that
      // `aria-disabled` does not touch: React moves the keyed <li>, and a DOM
      // move that is remove-then-insert blurs the focused element inside it.
      //
      // Read this before trusting it: React 19.2 moves with
      // `Element.moveBefore` where it exists, which preserves focus, and this
      // browser has it — so these three assertions pass with the component's
      // refocus effect deleted. They pin the *outcome*, not that mechanism.
      // What they would catch is the fallback path arriving here: an older
      // Chromium, or React reverting to `insertBefore`. The engines where that
      // fallback is live today — Firefox and Safari — this suite never runs.
      const later = row.getByRole('button', { name: 'Move step 1 later' });
      await later.focus();
      await page.keyboard.press('Enter');
      // The same step's button, one row down — so pressing again keeps moving
      // the same step, rather than whatever swapped into the old position.
      await expect.poll(focused).toBe('Move step 2 later');
      await page.keyboard.press('Enter');
      // Now at the end, and inert rather than gone: still focused, still the
      // last step.
      expect(await focused()).toBe('Move step 2 later');
      expect(
        await page.evaluate(() => document.activeElement?.getAttribute('aria-disabled')),
      ).toBe('true');

      // Put it back, so the assertions below are about the step that was
      // half-finished rather than about the order.
      const earlier = row.getByRole('button', { name: 'Move step 2 earlier' });
      await earlier.focus();
      await page.keyboard.press('Enter');
      await expect.poll(focused).toBe('Move step 1 earlier');

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
              // A subdomain of the target, which a crawl returns because it
              // must: `hostAllowed` matches subdomains, and without that the
              // apex-to-www redirect ends every crawl at depth 0. A journey
              // holds one `targetUrl` and a list of paths and cannot say this.
              { url: 'https://docs.discovered.invalid/guide', title: 'Guide', depth: 1 },
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

      // A page on another host, refused for a different and worse reason. The
      // route would have answered **201** to a step built from its path — the
      // body is perfectly valid — and the run would then have audited
      // `discovered.invalid/guide`, a page nobody picked, and reported it
      // clean. Nothing downstream could have caught it: the host is discarded
      // before the step is written.
      const offHostBox = page.getByRole('checkbox', { name: /Guide/ });
      expect(await offHostBox.isDisabled()).toBe(true);
      // The whole URL, not the path: the host is the thing that makes this row
      // different, and two pages sharing a path across two hosts would
      // otherwise render as the same row twice.
      expect(text).toContain('https://docs.discovered.invalid/guide');
      expect(text).toContain('on docs.discovered.invalid, not discovered.invalid');
      // And what to do about it, which is the half that makes this a rule
      // rather than a dead end.
      expect(text).toContain('crawl docs.discovered.invalid on its own');

      // The bulk control takes the four it may and leaves both it may not,
      // which is the state no click could otherwise produce.
      await page.getByRole('button', { name: 'Select every page' }).click();
      await expect.poll(() => panel.innerText()).toContain('4 pages picked');
      expect(await longBox.isChecked()).toBe(false);
      expect(await offHostBox.isChecked()).toBe(false);

      // With the name still empty, so the sentence explaining the disabled
      // Create button is on the page when axe looks.
      await expect.poll(() => panel.innerText()).toContain('Give the journey a name');

      // The selection count is a live region as well as a describedby target.
      // Both bulk controls leave focus on themselves, so as a describedby
      // target alone this sentence is read on focus and never on change — and
      // axe cannot see the difference, which is why it is asserted here.
      expect(await panel.locator('p[aria-live="polite"]', { hasText: 'picked.' }).count()).toBe(1);

      // `OUR_RULES`, like every other scan here. This one called `.analyze()`
      // bare, so it ran axe's defaults — which leave `target-size` and the rest
      // of `ENABLED_BY_US` switched off, and held this panel to a lower
      // standard than the product holds a client's site to. That is the exact
      // thing the block at the top of this file exists to prevent, and it was
      // the only scan in the file not doing it.
      await expect
        .poll(() => axeViolations(page), {
          ...AXE_SETTLE,
          message: 'the discovery panel, four pages picked and the name still empty',
        })
        .toBe('');

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
          { timeout: 30_000, interval: 1000 },
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

  /**
   * The discovery panel's two buttons, held to what #57 settled everywhere
   * else in the workspace.
   *
   * `lib/inert-button` landed on master while this panel was on a branch, and
   * its commit said so: "`discover-pages.tsx` is not on this branch; its three
   * sites are on claude/auditor-static-websites-4eae70". Git merged the two
   * without a word, which is the whole danger — a clean merge would have
   * shipped the exact keyboard defect that commit removed, into the panel that
   * is now the main way a journey gets made, in a product that audits other
   * people's sites for this.
   *
   * Two of the three sites convert. The third, the `tooLong` checkbox, is
   * unavailable on arrival rather than by the operator's own click, and the
   * component says why beside it.
   *
   * Nothing but a browser can see any of this: both spellings are valid markup
   * and correctly marked unavailable, so the zero-violation sweep at the foot
   * of this file passes either way.
   */
  it('keeps focus on the discovery buttons their own click makes unavailable', async () => {
    const page = await openAuthenticatedPage();

    /** What a screen reader would be on, right now. */
    const focused = () =>
      page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return 'body';
        return active.getAttribute('aria-label') ?? active.textContent?.trim() ?? active.tagName;
      });

    try {
      // Held open until this test releases it, so "crawling" is a state the
      // assertions can stand in rather than a frame between two renders. A
      // stub that answers at once would make this a race with React.
      let release = () => {};
      const crawled = new Promise<void>((resolve) => {
        release = resolve;
      });

      let crawlRequests = 0;

      await page.route('**/api/platform/discover', async (route) => {
        crawlRequests += 1;
        await crawled;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            requestId: 'stubbed',
            pages: [{ url: 'https://inert.invalid/', title: 'Front door', depth: 0 }],
            errors: [],
          }),
        });
      });

      await page.goto(`${BASE}/clients/${CLIENT}/journeys`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);

      const panel = page.locator('section', { hasText: 'Discover pages' }).first();
      await page.getByLabel('Site address').fill('https://inert.invalid/');

      // 1. Find pages, mid-crawl. The panel's own copy says a crawl "takes
      // about a minute", so this is a minute of the operator having lost their
      // place — the longest window of the four controls #57 fixed.
      const find = page.getByRole('button', { name: 'Find pages' });
      await find.focus();
      // Enter on a focused button, not a mouse click: the defect is about the
      // keyboard and a mouse user never had a place to lose.
      await page.keyboard.press('Enter');

      // Waited on the visible label, which changes either way. Polling
      // `aria-disabled` would make the fix's own attribute the thing that
      // decides when to look, and the assertion that matters is the focus.
      await expect.poll(() => find.innerText(), { timeout: 15_000 }).toBe('Looking…');
      expect(await focused()).toBe('Find pages');
      // And how, so an edit that reinstates `disabled` fails here rather than
      // quietly reintroducing the defect.
      expect(await find.getAttribute('aria-disabled')).toBe('true');
      expect(await find.evaluate((node: HTMLButtonElement) => node.disabled)).toBe(false);
      // The accessible name did not move with the visible one. Under
      // `disabled` that rename was free, because focus had already gone to
      // `<body>`; with focus staying it is announced, over the polite region
      // below that is the thing actually saying the crawl started.
      expect(await focused()).not.toBe('Looking…');

      // 1b. And the half `aria-disabled` gives away, which has to be bought
      // back by the guard inside `inertWhen`.
      //
      // `discover()` has no `crawling` check of its own — under `disabled` the
      // DOM was what stopped a second Enter, and `aria-disabled` stops nothing.
      // So this is the one assertion here that the guard uniquely holds up:
      // delete the early return in `inertWhen` and a second Enter starts a
      // second crawl of the same site while the first is in flight.
      await page.keyboard.press('Enter');

      release();
      await expect.poll(() => panel.innerText(), { timeout: 15_000 }).toContain('Front door');

      // Counted after the results are on screen rather than straight after the
      // key: the request would be made by Chromium's network stack, not
      // synchronously by the handler, so an assertion taken immediately would
      // pass whether or not a second crawl had been started.
      expect(crawlRequests).toBe(1);

      // 2. Create journey, inert because nothing is ticked — the state the
      // panel spends most of its life in, and the one an operator meets first.
      const create = page.getByRole('button', { name: 'Create journey' });
      expect(await create.getAttribute('aria-disabled')).toBe('true');
      await create.focus();
      await page.keyboard.press('Enter');
      expect(await focused()).toBe('Create journey');
      // Still refusing, and still saying why in the live region beside it —
      // which a `disabled` button could never be reached to be told about.
      //
      // Read this for what it is: `create()` opens with its own
      // `if (!found || createBlockedBy) return;`, so this line survives
      // deleting the guard inside `inertWhen`. It pins the outcome, not that
      // mechanism. What the guard uniquely stops is a *second* Enter while a
      // create is in flight, which `disabled` used to stop at the DOM level.
      await expect.poll(() => panel.innerText()).toContain('Tick at least one page');
      expect(await panel.innerText()).not.toContain('It is in the list below');
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

      // Name the rule and the element on failure: "expected 0, got 2" would
      // send the next reader back to a browser to find out what broke. The
      // landmark outline comes along because a landmark rule is meaningless
      // without knowing what the page actually rendered — CI once failed
      // `landmark-one-main` on routes that were green locally, and the bare
      // rule id said nothing about why.
      //
      // Polled like the in-page scans, and the outline is built inside the
      // poll so it describes the attempt that actually failed rather than a
      // snapshot taken before the last one. This sweep navigates cold and
      // waits for hydration, so it is the least exposed scan in the file — but
      // "least exposed" is what was said about the other four before three of
      // them failed, and a retry costs nothing on a green run.
      await expect
        .poll(
          async () => {
            const detail = await axeViolations(page);
            if (!detail) return '';

            const outline = await page.evaluate(() => ({
              mains: document.querySelectorAll('main').length,
              banners: document.querySelectorAll('header').length,
              locked: document.body.innerText.includes('Sign in'),
              bodyChars: document.body.innerHTML.length,
            }));

            return `${detail}\npage outline: ${JSON.stringify(outline)}`;
          },
          { ...AXE_SETTLE, message: `axe on ${route}` },
        )
        .toBe('');
    } finally {
      await page.close();
    }
  }, 60_000);
});
