import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Page } from 'playwright';
import type { Environment } from '../../domain/contracts';
import { isActionAllowed } from '../../domain/policy';
import type { JourneyRunnerInput, JourneyRunnerResult, JourneyStep } from './types';

export const DEFAULT_DEMO_JOURNEY_STEPS: JourneyStep[] = [
  { action: 'navigate', type: 'goto', path: 'login.html' },
  { action: 'login', type: 'click', selector: '#login-button' },
];

async function captureAxTree(page: Page, outputPath: string): Promise<void> {
  const client = await page.context().newCDPSession(page);
  const { nodes } = await client.send('Accessibility.getFullAXTree');
  await writeFile(outputPath, JSON.stringify({ nodes }, null, 2), 'utf8');
}

function resolveFixtureUrl(fixtureDir: string, path: string): string {
  return pathToFileURL(join(fixtureDir, path)).href;
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
  await mkdir(input.artifactsDir, { recursive: true });

  const browser = await chromium.launch({ headless: input.headless ?? true });
  const page = await browser.newPage();

  try {
    const steps = input.steps ?? DEFAULT_DEMO_JOURNEY_STEPS;

    for (const step of steps) {
      if (!isActionAllowed(input.environment, step.action)) {
        throw new Error(`Action "${step.action}" is not allowed in ${input.environment}.`);
      }

      if (step.type === 'goto') {
        await page.goto(resolveFixtureUrl(input.fixtureDir, step.path));
        continue;
      }

      await page.click(step.selector);
      await page.waitForLoadState('domcontentloaded');
    }

    const html = await page.content();
    const title = await page.title();
    const url = page.url();
    const artifactPrefix = join(input.artifactsDir, input.stepId);
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
