import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Page, Response } from 'playwright-core';
import type { Environment } from '../../domain/contracts';
import { boundTitle } from '../../domain/evidence';
import { isActionAllowed } from '../../domain/policy';
import { pruneAxTree, type AxNodeSummary } from '../../services/ax-tree';
import { logWarn } from '../../services/logger';
import { scanPageWithAxe } from './axe-scan';
import { resolveCredential } from './credentials';
import { launchChromium } from './launch';
import { PartialJourneyError } from './partial-run';
import {
  assertAllowedUrl,
  assertPeerAddressAllowed,
  assertSafeTargetUrl,
} from './target-url';
import {
  buildDefaultDemoJourneySteps,
  resolveNavigationUrl,
} from './demo-journey';
import type {
  JourneyArtifacts,
  JourneyRunnerInput,
  JourneyRunnerResult,
  PageAudit,
} from './types';

export { buildDefaultDemoJourneySteps, resolveNavigationUrl } from './demo-journey';

/**
 * Writes the full tree as evidence and returns a pruned copy for analysis.
 *
 * The full tree is what an auditor reviews later; the pruned one is what the
 * advisory pass reads. Previously only the file was produced and nothing ever
 * read it back, so the tree was captured purely to prove it could be.
 */
async function captureAxTree(page: Page, outputPath: string): Promise<AxNodeSummary[]> {
  const client = await page.context().newCDPSession(page);
  const { nodes } = await client.send('Accessibility.getFullAXTree');
  await writeFile(outputPath, JSON.stringify({ nodes }, null, 2), 'utf8');
  return pruneAxTree(nodes);
}

/**
 * Builds the artifact path prefix, refusing anything that escapes artifactsDir.
 *
 * stepId reaches here from the request body, and `join` happily resolves `..`
 * segments, so without this an audit run is an arbitrary file write: a stepId
 * of `../../foo` drops foo.png / foo.html / foo.ax.json anywhere on disk and
 * overwrites whatever was there. The API schema rejects such values already;
 * this is the backstop for any other caller (tests, scripts, future routes).
 */
export function resolveArtifactPrefix(artifactsDir: string, stepId: string): string {
  const root = resolve(artifactsDir);
  const prefix = resolve(root, stepId);

  if (prefix !== root && !prefix.startsWith(root + sep)) {
    throw new Error('stepId must not escape the artifacts directory.');
  }
  if (prefix === root) {
    throw new Error('stepId must name a file within the artifacts directory.');
  }

  return prefix;
}

/**
 * A short, human-readable label for one captured page.
 *
 * For an http(s) page the label is the site's own path, because that is what
 * the operator and the client reading the report call the page.
 *
 * This used to keep only the last path segment, which collapsed every
 * directory-style URL to `/`: the pathname `/WAI/` splits to `['', 'WAI', '']`
 * and pops the empty string after the trailing slash. The first real audit run
 * through this code — six pages of `https://www.w3.org/WAI/` — reported every
 * one of them as `/`, and any site with clean URLs would have done the same.
 * It only ever looked correct because the fixtures are `.html` files.
 *
 * `file:` URLs keep the basename. Their pathname is an absolute path on
 * whichever machine ran the audit, which is noise in a report and would write
 * somebody's home directory into an artifact filename.
 */
export function routeFromPageUrl(url: string): string {
  const { protocol, pathname } = new URL(url);

  if (protocol === 'file:') {
    const fileName = pathname.split('/').pop() ?? '';
    return fileName && fileName !== 'index.html' ? `/${fileName}` : '/';
  }

  // `/a/`, `/a/index.html` and `/a` are one page; all three read best as `/a`.
  const trimmed = pathname.replace(/\/index\.html?$/i, '/').replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}

/**
 * Ceiling on pages per run.
 *
 * Every page costs an axe scan, a full-page screenshot and an AX tree against
 * the same 300s `maxDuration`. Twenty was a starting point rather than a law
 * of nature, and there is now one real datapoint behind it: a four-page run
 * of the W3C BAD demo on a production function
 * (`d62f13f4-4a33-4f14-b592-4b243c4f3e62`, 2026-08-15) took 23.0s — 20.5s of
 * journey plus 1.5s of upload — with the slowest page at 4.0s, of which 2.9s
 * was the axe scan. Twenty of that page is about 80s, comfortably inside the
 * ceiling.
 *
 * Read that as a floor, not a budget. It is one run, against four small static
 * documents with no framework, no login and nothing deferred; a real client
 * app renders more, waits on more, and will cost more per page. The number to
 * re-decide this from is `slowestPageMs` on an actual client run, not this
 * one. If real journeys exceed the cap, that is still the signal for a
 * container worker rather than a bigger number here.
 */
const DEFAULT_MAX_PAGES = 20;

/**
 * How long one interaction may wait for its element.
 *
 * Nothing set a timeout at all, so Playwright's 30s default applied. The step
 * loop has no `catch`, so the first stale selector ends the run — one wait, not
 * one per step — which makes this a smaller win than it looks: ten seconds
 * instead of thirty on a journey that was going to fail anyway.
 *
 * Ten because a selector that has not appeared in ten seconds on a page the
 * runner has already navigated to and waited for `domcontentloaded` on is
 * stale, not slow. Raise it with `AUDITOR_STEP_TIMEOUT_MS` for an app that
 * genuinely takes longer to paint a control.
 *
 * Passed to each `fill` and `click` rather than to `context.setDefaultTimeout`,
 * which was the first version of this and was wrong. That default is
 * context-wide: it also caps `page.goto` — which waits for `load`, so every
 * image, font and third-party tag on a real client page — and
 * `page.screenshot({fullPage: true})`, measured failing at exactly the cap on a
 * tall page. Both sit outside `attemptStep`, so both would have reported
 * `audit_run_failed`: a knob added to make failures legible would have
 * manufactured illegible ones, on precisely the heavy real-world pages this
 * product exists for. The axe scan is unaffected either way — it runs through
 * `page.evaluate`, which passes its own no-timeout.
 */
const DEFAULT_STEP_TIMEOUT_MS = 10_000;

export function resolveStepTimeoutMs(explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const configured = Number(process.env.AUDITOR_STEP_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_STEP_TIMEOUT_MS;
}

export function resolveMaxPages(explicit?: number): number {
  if (explicit !== undefined && Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit);
  }
  const configured = Number(process.env.AUDITOR_MAX_PAGES_PER_RUN);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_MAX_PAGES;
}

/**
 * A filesystem- and URL-safe id for one page's artifact set.
 *
 * The index leads so ordering survives a directory listing, and every other
 * character is normalised away — the route comes from the audited site, and it
 * ends up in a path.
 */
export function pageKeyFor(index: number, route: string): string {
  const slug = route
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .toLowerCase();

  return `${String(index + 1).padStart(2, '0')}${slug ? `-${slug}` : ''}`;
}

/**
 * Audits every page a journey walks through.
 *
 * This used to scan once, after the loop, so only the journey's final page was
 * ever audited. A journey stepping through a page with five real WCAG
 * violations and ending somewhere clean reported `pass` with zero findings —
 * for a product that audits *multi-step* apps, the one shape of wrongness that
 * matters most. The scan now happens after every navigation.
 *
 * Pages are deduplicated by settled URL against the previous capture, so a
 * click that changes nothing about the location does not pay for a second scan
 * of the same page or double every finding on it.
 */
export async function runJourney(input: JourneyRunnerInput): Promise<JourneyRunnerResult> {
  // Validate before launching a browser or creating directories, so a bad
  // stepId costs nothing and leaves nothing behind.
  resolveArtifactPrefix(input.artifactsDir, input.stepId);
  const maxPages = resolveMaxPages(input.maxPages);
  const stepTimeoutMs = resolveStepTimeoutMs(input.stepTimeoutMs);

  // Default the allowlist to the target's own host: an audit of one site has no
  // business navigating to another.
  const allowedHosts =
    input.allowedHosts ?? (input.targetUrl ? [new URL(input.targetUrl).hostname] : []);

  // Resolve and range-check the entry point before spending a browser launch
  // on it.
  if (input.targetUrl) {
    await assertSafeTargetUrl(input.targetUrl, allowedHosts);
  }

  await mkdir(input.artifactsDir, { recursive: true });

  const browser = await launchChromium({ headless: input.headless });
  // axe is injected into every frame at scan time. A target site with a strict
  // `script-src` CSP would block that injection and silently return no
  // results, so the context opts out of CSP enforcement for the audit session.
  const context = await browser.newContext({ bypassCSP: true });
  const page = await context.newPage();

  // Every main-frame document the browser fetched, judged as it arrives.
  //
  // Watching responses rather than checking the page afterwards, because the
  // page does not hold still. Three ways it moves:
  //
  //  - A redirect chain. Only the hop that survived used to be checked, so
  //    public -> internal -> public passed while the internal request was
  //    issued from inside our network.
  //  - A `meta refresh` or `setTimeout(() => location = …)`. The attacker
  //    serves the page, so they choose the delay — and `capturePage` spends
  //    seconds on an axe scan, a full-page screenshot and an AX tree. A guard
  //    that ran before all that was reading the previous document.
  //  - The address behind an unchanged hostname, which is the rebinding case.
  //
  // So each response is checked on arrival and the failure is remembered.
  // `assertNavigationsWereSafe` is what turns it into a thrown error, and it
  // runs after the capture as well as before it — anything the page did during
  // the capture has to invalidate that capture.
  const navigationChecks: Array<Promise<void>> = [];
  let navigationViolation: Error | undefined;

  // Bound to the context, not to a page.
  //
  // A page-level listener cannot cover popups, and attaching one when a popup
  // appears is always too late: both `context.on('page')` and
  // `page.on('popup')` are delivered asynchronously, after the popup has been
  // created and — measured — after it has already navigated and had its
  // response dispatched. A direct `window.open('http://169.254.169.254/…')`
  // was fetched and never checked. The context listener is registered before
  // any page exists, so there is no window to lose: every main-frame
  // navigation in the session passes through it, whichever page made it.
  context.on('response', (response) => {
    if (!input.targetUrl) return;

    const frame = response.frame();
    if (frame !== frame.page()?.mainFrame()) return;
    if (!response.request().isNavigationRequest()) return;

    navigationChecks.push(
      (async () => {
        // The address, not the allowlist.
        //
        // A redirect through a host that is not the target is ordinary — SSO,
        // consent walls, apex-to-www — and those are the journeys this product
        // exists to audit, so refusing every off-origin hop would break the
        // normal case to stop an abnormal one. The allowlist still governs
        // where the journey *settles*, which is the question it was written
        // for. What matters on the way there is whether a hop reached inside
        // our network, and that is an address question.
        const peer = await response.serverAddr();
        assertPeerAddressAllowed(response.url(), peer?.ipAddress);
      })().catch((error: unknown) => {
        // Recorded, never thrown from here. These promises are created inside
        // an event handler with nothing awaiting them yet, so a rejection
        // escaping this callback is an unhandled rejection — which on Node 20
        // kills the process. It very nearly did: the first version of this
        // threw for a cross-host redirect, so an audit of `https://youtu.be/`
        // took the whole function down, taking any concurrent background run
        // with it.
        navigationViolation ??= error instanceof Error ? error : new Error(String(error));
      }),
    );
  });

  // Declared out here, not inside the `try`, so the catch below can still see
  // what was captured before the throw. This was the first of three places a
  // partial run lost its work.
  const pages: PageAudit[] = [];
  let truncatedPages = 0;

  try {
    const { steps } = input;

    /**
     * Scans and captures whatever the page is showing right now.
     *
     * Ordering matters: the scan runs before the artifacts are written, so the
     * evidence on disk is the same DOM the findings were derived from.
     */
    const capturePage = async (): Promise<void> => {
      const url = page.url();

      // A click that did not move the page is not a second page. Scanning it
      // again would double its findings and pay twice for the same evidence.
      if (pages.length > 0 && pages[pages.length - 1].page.url === url) {
        return;
      }

      if (pages.length >= maxPages) {
        truncatedPages += 1;
        return;
      }

      const startedAt = Date.now();
      const route = routeFromPageUrl(url);
      const pageKey = pageKeyFor(pages.length, route);
      const artifactPrefix = resolveArtifactPrefix(
        input.artifactsDir,
        join(input.stepId, pageKey),
      );
      await mkdir(dirname(artifactPrefix), { recursive: true });

      const scanStartedAt = Date.now();
      const axe = await scanPageWithAxe(page);
      const scanMs = Date.now() - scanStartedAt;

      const html = await page.content();
      const title = boundTitle(await page.title());
      const screenshotPath = `${artifactPrefix}.png`;
      const domSnapshotPath = `${artifactPrefix}.html`;

      await page.screenshot({ path: screenshotPath, fullPage: true });
      await writeFile(domSnapshotPath, html, 'utf8');

      const artifacts: JourneyArtifacts = { screenshotPath, domSnapshotPath };

      let axTree: AxNodeSummary[] = [];
      if (!input.omitAxTree) {
        const axTreePath = `${artifactPrefix}.ax.json`;
        axTree = await captureAxTree(page, axTreePath);
        artifacts.axTreePath = axTreePath;
      }

      // Again, now that the capture is done.
      //
      // Everything above takes seconds, and the audited page is free to
      // navigate during them — a timed redirect lands mid-screenshot and the
      // evidence written above is of a page nothing ever checked. A guard that
      // runs on our schedule cannot contain a page that moves on its own, so
      // the capture is only accepted if the run is still safe afterwards.
      await assertNavigationsWereSafe();

      pages.push({
        page: { url, route, title },
        html,
        axe,
        axTree,
        artifacts,
        pageKey,
        // Measured across navigate-settle to artifacts-written, because that
        // is the unit the page cap is denominated in: the question this
        // answers is how many of these fit inside one function invocation.
        timing: { totalMs: Date.now() - startedAt, scanMs },
      });
    };

    // A redirect can land somewhere the pre-navigation checks never saw. That
    // is what re-checking the settled URL catches.
    //
    // It does *not* catch DNS rebinding, and this used to claim it did. The
    // settled URL still carries the hostname the caller supplied, which is on
    // the allowlist by construction — the allowlist defaults to that very host
    // — and it is not a literal IP, so nothing about it is range-checked. A
    // hostile resolver answering our `lookup()` with a public address and
    // Chromium's with 127.0.0.1 passed every check and had the internal page
    // archived as evidence.
    //
    // No re-inspection of a string can close that, because the string is not
    // where the answer is. The address the browser actually connected to is,
    // so that is what is checked here.
    const assertNavigationsWereSafe = async (): Promise<void> => {
      if (!input.targetUrl) {
        return;
      }

      // Settled first, so a violation on any hop is reported even when the
      // page came to rest somewhere unremarkable. Ordered before the check on
      // `page.url()` deliberately: a synchronous throw above this line would
      // leave the recorded violations unread.
      await Promise.all(navigationChecks);
      if (navigationViolation) {
        throw navigationViolation;
      }

      assertAllowedUrl(page.url(), allowedHosts);
    };

    for (const [index, step] of steps.entries()) {
      if (!isActionAllowed(input.environment, step.action)) {
        throw new Error(`Action "${step.action}" is not allowed in ${input.environment}.`);
      }

      if (step.type === 'goto') {
        const url = resolveNavigationUrl(input.fixtureDir, step.path, input.targetUrl);
        if (input.targetUrl) {
          await assertSafeTargetUrl(url, allowedHosts);
        }
        await page.goto(url);
        await assertNavigationsWereSafe();
        await capturePage();
        continue;
      }

      if (step.type === 'fill') {
        const value =
          'credentialRef' in step
            ? resolveCredential(step.credentialRef, step.field)
            : step.value;
        await attemptStep(index, step, () =>
          page.fill(step.selector, value, { timeout: stepTimeoutMs }),
        );
        continue;
      }

      // The settle is part of the click, not a separate act. Left outside the
      // wrapper it was the one line that undid the naming: a click that fires
      // and then stalls on its navigation threw a bare Playwright error and
      // reported `audit_run_failed` — for the step named one line above.
      //
      // No `stepTimeoutMs` on it. A step's element should already be there;
      // a page load legitimately takes longer, and capping navigation is the
      // mistake `DEFAULT_STEP_TIMEOUT_MS` documents not making.
      //
      // Untested, and worth saying so. Making this throw needs a navigation
      // that stalls, which needs a server holding a socket open — the fixtures
      // are `file://`, so nothing here can produce one, and the wait is
      // deliberately uncapped so it would take Playwright's full default to
      // fire. The wrapper it moved inside is covered; this one line's presence
      // in it is not.
      await attemptStep(index, step, async () => {
        await page.click(step.selector, { timeout: stepTimeoutMs });
        await page.waitForLoadState('domcontentloaded');
      });
      await assertNavigationsWereSafe();
      await capturePage();
    }

    // A journey whose steps never navigated still landed somewhere, and that
    // somewhere is what the old single-scan behaviour would have audited.
    if (pages.length === 0) {
      await capturePage();
    }

    // Once more, after the loop.
    //
    // Every other call site sits before a capture, and a popup's navigation
    // lands after the click that opened it — so a violation raised by the last
    // step's popup was recorded into `navigationViolation` and then never
    // read, because nothing looked again. A check nobody reads is not a check.
    await assertNavigationsWereSafe();

    // A silent cap reads as "we audited everything" when we did not. This is
    // the only record that the run was truncated, so it is emitted here rather
    // than left to a caller that might not look.
    if (truncatedPages > 0) {
      logWarn('audit_page_cap_reached', {
        journeyId: input.journeyId,
        stepId: input.stepId,
        maxPages,
        pagesAudited: pages.length,
        pagesSkipped: truncatedPages,
      });
    }

    return { pages, truncatedPages };
  } catch (error) {
    // A journey that died at step five of eight still audited four pages, and
    // they were thrown away with the stack: `executeRun` stored `findings: []`
    // and no pages, so a run that found real violations before it failed
    // reported nothing at all. The pages travel with the error now.
    //
    // Only when there are pages. Wrapping unconditionally changed the type of
    // every failure, and a caller testing `instanceof UnsafeTargetError` — the
    // rebind suite does — stopped recognising an SSRF refusal it had always
    // recognised. Nothing is partial about a run that captured nothing, so
    // those keep throwing exactly what they threw before.
    //
    // This asks about the pages and never about the error, deliberately: a
    // rebind on page three and a stale selector on page three take the same
    // road out. That is also why one error type covers the pages>0 branch —
    // the SSRF-after-capture pairing has no code of its own, and it is not
    // constructible against these fixtures anyway, because the peer check
    // refuses every response the rebind server sends, so no safe page can be
    // captured from it first.
    if (pages.length === 0) throw error;

    // The cap warning lives at the end of the `try` and never fired on this
    // path, so a run that was truncated and then died said nothing about
    // either. It is the only record that the walk was cut short.
    if (truncatedPages > 0) {
      logWarn('audit_page_cap_reached', {
        journeyId: input.journeyId,
        stepId: input.stepId,
        maxPages,
        pagesAudited: pages.length,
        pagesSkipped: truncatedPages,
      });
    }

    throw new PartialJourneyError(error, { pages, truncatedPages });
  } finally {
    await browser.close();
  }
}

/**
 * Names the step that failed, because "it failed" is not a fix.
 *
 * A stale selector is the most likely way a real journey dies, and it used to
 * arrive as a bare Playwright timeout that `classifyRunFailure` had no branch
 * for — so the operator was told the run stopped "for a reason it could not
 * categorise", about the one failure mode that is entirely theirs to fix. This
 * says which step, which action, and which selector.
 *
 * Only the interactions are wrapped, and the reason is not that the others are
 * better labelled — `UnsafeTargetError` from the address checks falls through
 * `classifyRunFailure` to the same generic code this exists to avoid. It is
 * that they are different failures. An SSRF refusal reported as "a step could
 * not click" is a worse answer than the vague one it replaced, and it would be
 * the wrong thing to hand an operator to go and fix.
 *
 * The reason is the first line of the underlying error and nothing after it.
 * That line is Playwright's own summary — "Element is not an <input>…", or the
 * timeout — while everything below it is the call log, and the call log is
 * where a `fill` prints the value it was asked to type. When that value is a
 * resolved credential, the split is the only thing between it and a log line.
 * The whole error is kept on `cause` for a debugger; nothing logs it.
 */
async function attemptStep(
  index: number,
  step: { action: string; type: string; selector: string },
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    // Not `error.name`. The case this was written for — a login input restyled
    // into a div — is not a timeout at all: Playwright rejects it immediately
    // with a plain `Error`, so naming the class said "it raised Error", which
    // is nothing the step's own `type` had not already said.
    const because =
      error instanceof Error
        ? (error.message.split('\n')[0] ?? '').trim() || `it raised ${error.name}`
        : 'it raised an unknown error';

    throw new Error(
      `Step ${index + 1} ("${step.action}") could not ${step.type} "${step.selector}": ${because}.`,
      { cause: error },
    );
  }
}

export function assertActionAllowed(environment: Environment, action: string): void {
  if (!isActionAllowed(environment, action)) {
    throw new Error(`Action "${action}" is not allowed in ${environment}.`);
  }
}
