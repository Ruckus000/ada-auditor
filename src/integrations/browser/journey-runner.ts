import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { Page } from 'playwright-core';
import type { Environment } from '../../domain/contracts';
import { isActionAllowed } from '../../domain/policy';
import { scanPageWithAxe } from './axe-scan';
import { launchChromium } from './launch';
import {
  buildDefaultDemoJourneySteps,
  resolveNavigationUrl,
} from './demo-journey';
import type { JourneyRunnerInput, JourneyRunnerResult } from './types';

export {
  buildDefaultDemoJourneySteps,
  DEFAULT_DEMO_JOURNEY_STEPS,
  getDemoCredentials,
  resolveNavigationUrl,
} from './demo-journey';

async function captureAxTree(page: Page, outputPath: string): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const { nodes } = await client.send('Accessibility.getFullAXTree');
  await writeFile(outputPath, JSON.stringify({ nodes }, null, 2), 'utf8');
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

  await mkdir(input.artifactsDir, { recursive: true });

  const browser = await launchChromium({ headless: input.headless });
  // axe is injected into every frame at scan time. A target site with a strict
  // `script-src` CSP would block that injection and silently return no
  // results, so the context opts out of CSP enforcement for the audit session.
  const context = await browser.newContext({ bypassCSP: true });
  const page = await context.newPage();

  try {
    const steps = input.steps ?? buildDefaultDemoJourneySteps();

    for (const step of steps) {
      if (!isActionAllowed(input.environment, step.action)) {
        throw new Error(`Action "${step.action}" is not allowed in ${input.environment}.`);
      }

      if (step.type === 'goto') {
        await page.goto(resolveNavigationUrl(input.fixtureDir, step.path, input.targetBaseUrl));
        continue;
      }

      if (step.type === 'fill') {
        await page.fill(step.selector, step.value);
        continue;
      }

      await page.click(step.selector);
      await page.waitForLoadState('domcontentloaded');
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

    if (!input.omitAxTree) {
      const axTreePath = `${artifactPrefix}.ax.json`;
      await captureAxTree(page, axTreePath);
      artifacts.axTreePath = axTreePath;
    }

    return {
      html,
      axe,
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
