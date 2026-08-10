import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { Page } from 'playwright-core';
import type { Environment } from '../../domain/contracts';
import { isActionAllowed } from '../../domain/policy';
import { pruneAxTree, type AxNodeSummary } from '../../services/ax-tree';
import { logWarn } from '../../services/logger';
import { scanPageWithAxe } from './axe-scan';
import { resolveCredential } from './credentials';
import { launchChromium } from './launch';
import { assertAllowedUrl, assertSafeTargetUrl } from './target-url';
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

function routeFromPageUrl(url: string): string {
  const pathname = new URL(url).pathname;
  const fileName = pathname.split('/').pop() ?? '';
  if (!fileName || fileName === 'index.html') {
    return '/';
  }
  return `/${fileName}`;
}

/**
 * Ceiling on pages per run.
 *
 * Every page costs an axe scan, a full-page screenshot and an AX tree against
 * the same 300s `maxDuration`. Twenty is a starting point, not a law of
 * nature: if real journeys exceed it, that is the signal for a container
 * worker rather than a bigger number here.
 */
const DEFAULT_MAX_PAGES = 20;

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

  try {
    const steps = input.steps ?? buildDefaultDemoJourneySteps();

    const pages: PageAudit[] = [];
    let truncatedPages = 0;

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

      const route = routeFromPageUrl(url);
      const pageKey = pageKeyFor(pages.length, route);
      const artifactPrefix = resolveArtifactPrefix(
        input.artifactsDir,
        join(input.stepId, pageKey),
      );
      await mkdir(dirname(artifactPrefix), { recursive: true });

      const axe = await scanPageWithAxe(page);

      const html = await page.content();
      const title = await page.title();
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

      pages.push({
        page: { url, route, title },
        html,
        axe,
        axTree,
        artifacts,
        pageKey,
      });
    };

    // A redirect can land somewhere the pre-navigation checks never saw, and a
    // rebinding host can answer differently for the browser than it did for our
    // resolver. Re-checking the URL the page actually settled on is what closes
    // both. Only applies to remote targets; fixture runs are file:// and local.
    const guardCurrentUrl = () => {
      if (!input.targetUrl) {
        return;
      }
      assertAllowedUrl(page.url(), allowedHosts);
    };

    for (const step of steps) {
      if (!isActionAllowed(input.environment, step.action)) {
        throw new Error(`Action "${step.action}" is not allowed in ${input.environment}.`);
      }

      if (step.type === 'goto') {
        const url = resolveNavigationUrl(input.fixtureDir, step.path, input.targetUrl);
        if (input.targetUrl) {
          await assertSafeTargetUrl(url, allowedHosts);
        }
        await page.goto(url);
        guardCurrentUrl();
        await capturePage();
        continue;
      }

      if (step.type === 'fill') {
        const value =
          'credentialRef' in step
            ? resolveCredential(step.credentialRef, step.field)
            : step.value;
        await page.fill(step.selector, value);
        continue;
      }

      await page.click(step.selector);
      await page.waitForLoadState('domcontentloaded');
      guardCurrentUrl();
      await capturePage();
    }

    // A journey whose steps never navigated still landed somewhere, and that
    // somewhere is what the old single-scan behaviour would have audited.
    if (pages.length === 0) {
      await capturePage();
    }

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
  } finally {
    await browser.close();
  }
}

export function assertActionAllowed(environment: Environment, action: string): void {
  if (!isActionAllowed(environment, action)) {
    throw new Error(`Action "${action}" is not allowed in ${environment}.`);
  }
}
