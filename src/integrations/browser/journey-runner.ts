import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Page, Response } from 'playwright-core';
import type { Environment } from '../../domain/contracts';
import { boundTitle } from '../../domain/evidence';
import { isActionAllowed } from '../../domain/policy';
import { pruneAxTree, redactSecrets, type AxNodeSummary } from '../../services/ax-tree';
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
async function captureAxTree(
  page: Page,
  outputPath: string,
  secrets: readonly string[],
): Promise<AxNodeSummary[]> {
  const client = await page.context().newCDPSession(page);
  const { nodes } = await client.send('Accessibility.getFullAXTree');

  // Before the write, not after: the file is the thing that gets uploaded, and
  // a redaction applied to the returned summary alone would leave the secret
  // sitting in blob storage. `pruneAxTree` reads the redacted copy for the
  // same reason — the summary is what the advisory pass sends to a model.
  const safe = redactSecrets(nodes, secrets);

  await writeFile(outputPath, JSON.stringify({ nodes: safe }, null, 2), 'utf8');
  return pruneAxTree(safe);
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

  /**
   * The status of the most recent main-frame navigation, per page.
   *
   * Filled from the response listener below rather than from `page.goto`'s
   * return value, which is what this looked like at first. `goto` is one of
   * three ways a capture happens — a click that navigates and the
   * no-navigation fallback are the others — so reading its return would have
   * recorded nothing for a journey that clicked its way onto a 500.
   *
   * **Keyed by the page, not by the URL, and that is the whole correctness
   * argument.** The first version was a `Map<url, status>` written with
   * `response.url()` and read with `page.url()`. Those are different layers:
   * `response.url()` is what the network fetched, `page.url()` is what the
   * document currently claims, and the audited site controls the second. A
   * single line in a 500's body — `location.hash = 'x'`, or
   * `history.pushState({}, '', '/looks-fine')` — made the lookup miss, and a
   * miss means "not measured", so the error page went back to counting as
   * clean evidence. The same trick ran the other way too: visit a good page,
   * then a 500, then `pushState` back to the good URL, and the map returned
   * that page's 200 for the error document. Verified in Chromium, not reasoned
   * about.
   *
   * Neither a fragment change nor a `pushState` produces a navigation
   * response, so keying on the page leaves the last *real* navigation's status
   * in place — which is exactly the document that is on screen. A redirect
   * chain overwrites per hop and ends on the settled document. And a popup
   * cannot poison the main page's entry, which the URL map allowed.
   *
   * A `WeakMap` because the key is a live Playwright object; there is one page
   * in practice, and nothing here should keep it alive.
   */
  const mainFrameStatus = new WeakMap<Page, number>();

  /**
   * Every credential value this run has resolved, so it can be kept out of
   * what gets stored.
   *
   * Collected as the steps run rather than read from the journey, because the
   * journey holds only the *reference* — resolving it is the whole point of
   * `credentialRef`, and the resolved value exists nowhere else.
   */
  const resolvedSecrets: string[] = [];

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

    // After the push, deliberately.
    //
    // The peer check is the security-critical half of this handler, and
    // anything that runs before its registration is something that could stop
    // it being registered at all — a throw here would leave that response
    // unchecked while the run carried on. These three calls are synchronous
    // accessors over a response already in hand and do not throw in practice,
    // so this is ordering as defence rather than a fix for a live bug. It
    // costs nothing to make the guard unconditionally first.
    const navigated = frame.page();
    if (navigated) {
      mainFrameStatus.set(navigated, response.status());
    }
  });

  /**
   * A silent cap reads as "we audited everything" when we did not, and this is
   * the only record that the walk was cut short — so both the success and the
   * failure path call it, rather than one of them forgetting.
   */
  const warnIfCapped = () => {
    if (truncatedPages === 0) return;
    logWarn('audit_page_cap_reached', {
      journeyId: input.journeyId,
      stepId: input.stepId,
      maxPages,
      pagesAudited: pages.length,
      pagesSkipped: truncatedPages,
    });
  };

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
     * Ordering: the scan runs first, then the DOM is read, then the screenshot
     * and the AX tree.
     *
     * That used to carry the claim "so the evidence on disk is the same DOM
     * the findings were derived from", and it does not follow. The scan does
     * precede the writes, but axe evaluates the live page in-process and never
     * hands back what it saw; `page.content()`, `page.screenshot()` and
     * `captureAxTree` are three *fresh reads* taken afterwards. A page that
     * moves in between — and the comment forty lines below says plainly that
     * it may — puts a DOM on disk that nothing was ever scanned against.
     *
     * The gap cannot be closed from here, so it is described instead of
     * papered over. Closing it would mean serialising the DOM inside the same
     * execution turn as the scan, which buys accuracy on a hostile page at the
     * cost of running our script on one. The reads are ordered tightest-first
     * to keep the window small, which is all the ordering actually earns.
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
        axTree = await captureAxTree(page, axTreePath, resolvedSecrets);
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
        page: { url, route, title, statusCode: mainFrameStatus.get(page) },
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
        let value: string;
        if ('credentialRef' in step) {
          value = resolveCredential(step.credentialRef, step.field);
          // Recorded before it is typed, so a capture triggered by this very
          // step cannot beat the redaction to the disk.
          resolvedSecrets.push(value);
        } else {
          // Not recorded, and the reason is not that a literal is safe.
          //
          // An earlier version of this comment said `containsInlineCredential`
          // refuses inline secrets at write time. It does not: it tests step
          // *key names* against /^(password|pass|secret|token)$/i, and a
          // literal's value lives under the key `value`. It also never runs on
          // the run route. `audit-run-handler.ts` and `run-persistence.ts` both
          // already say so — the claim here contradicted two true comments.
          //
          // The real reason is that a literal fill is ordinary content. Search
          // terms, filters and postcodes are all typed this way, and treating
          // every one as a secret would strike legitimate text out of the
          // evidence for every journey that types anything. `credentialRef` is
          // the only input this run *knows* is a secret, so it is the only one
          // redacted.
          //
          // So `{type:'fill', value:'hunter2'}` still reaches the AX tree, and
          // that is a real hole. It is closed at the write end, by refusing the
          // step, not at the capture end by guessing — Phase 5's job.
          value = step.value;
        }
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

    warnIfCapped();

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
    // road out, so one error type exercises the branch for both.
    //
    // That pairing is real in production — page one resolves honestly, page
    // two's connection is rebound — and it is untested. Not because it is
    // settled: because reaching it needs one page the peer check *allows*
    // followed by one it refuses, and every server a test can stand up is on
    // a private address, which is the thing being refused. Serving benign
    // content first does not help; the address is what fails, not the body. A
    // journey mixing a `file://` fixture with an http target cannot be
    // expressed either, since `resolveNavigationUrl` resolves every path
    // against one base. Recorded here rather than left as a passing test that
    // proved something else.
    if (pages.length === 0) throw error;

    // Both paths, because a run can be truncated and then die.
    warnIfCapped();

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
