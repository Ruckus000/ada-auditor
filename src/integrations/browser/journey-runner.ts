import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { Page } from 'playwright-core';
import type { Environment } from '../../domain/contracts';
import { isActionAllowed } from '../../domain/policy';
import { pruneAxTree, type AxNodeSummary } from '../../services/ax-tree';
import { scanPageWithAxe } from './axe-scan';
import { resolveCredential } from './credentials';
import { launchChromium } from './launch';
import { assertAllowedUrl, assertSafeTargetUrl } from './target-url';
import {
  buildDefaultDemoJourneySteps,
  resolveNavigationUrl,
} from './demo-journey';
import type { JourneyRunnerInput, JourneyRunnerResult } from './types';

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

export async function runJourney(input: JourneyRunnerInput): Promise<JourneyRunnerResult> {
  // Validate before launching a browser or creating directories, so a bad
  // stepId costs nothing and leaves nothing behind.
  const artifactPrefix = resolveArtifactPrefix(input.artifactsDir, input.stepId);

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
    }

    // Scan before capturing artifacts so the evidence on disk is the same DOM
    // the findings were derived from.
    const axe = await scanPageWithAxe(page);

    const html = await page.content();
    const title = await page.title();
    const url = page.url();
    const screenshotPath = `${artifactPrefix}.png`;
    const domSnapshotPath = `${artifactPrefix}.html`;

    await page.screenshot({ path: screenshotPath, fullPage: true });
    await writeFile(domSnapshotPath, html, 'utf8');

    const artifacts: JourneyRunnerResult['artifacts'] = {
      screenshotPath,
      domSnapshotPath,
    };

    let axTree: AxNodeSummary[] = [];
    if (!input.omitAxTree) {
      const axTreePath = `${artifactPrefix}.ax.json`;
      axTree = await captureAxTree(page, axTreePath);
      artifacts.axTreePath = axTreePath;
    }

    return {
      html,
      axe,
      axTree,
      page: {
        url,
        route: routeFromPageUrl(url),
        title,
      },
      artifacts,
    };
  } finally {
    await browser.close();
  }
}

export function assertActionAllowed(environment: Environment, action: string): void {
  if (!isActionAllowed(environment, action)) {
    throw new Error(`Action "${action}" is not allowed in ${environment}.`);
  }
}
