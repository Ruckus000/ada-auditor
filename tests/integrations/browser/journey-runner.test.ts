import { access } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createEvidenceBundle } from '../../../src/domain/evidence';
import {
  buildDefaultDemoJourneySteps,
  runJourney,
} from '../../../src/integrations/browser/journey-runner';

const FIXTURE_DIR = join(process.cwd(), 'fixtures/journey-app');

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('runJourney', () => {
  it('produces complete evidence artifact files for every page of the demo journey', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const result = await runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'dashboard',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        steps: buildDefaultDemoJourneySteps(),
      });

      // login.html, then dashboard.html after the login click.
      expect(result.pages.map((p) => p.page.route)).toEqual([
        '/login.html',
        '/dashboard.html',
      ]);
      expect(result.pages[1].html).toContain('<img src="hero.png"');
      expect(result.truncatedPages).toBe(0);

      for (const audited of result.pages) {
        expect(audited.artifacts.screenshotPath).toBeTruthy();
        expect(audited.artifacts.domSnapshotPath).toBeTruthy();
        expect(audited.artifacts.axTreePath).toBeTruthy();

        await expect(fileExists(audited.artifacts.screenshotPath!)).resolves.toBe(true);
        await expect(fileExists(audited.artifacts.domSnapshotPath!)).resolves.toBe(true);
        await expect(fileExists(audited.artifacts.axTreePath!)).resolves.toBe(true);

        const evidence = createEvidenceBundle({
          page: audited.page,
          run: {
            journeyId: 'demo-login',
            stepId: 'dashboard',
            environment: 'test',
          },
          artifacts: audited.artifacts,
        });

        expect(evidence.status).toBe('complete');
      }

      // Each page owns its artifact set, so one page's evidence cannot
      // overwrite another's.
      const keys = result.pages.map((p) => p.pageKey);
      expect(new Set(keys).size).toBe(keys.length);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('scans a page the journey only passes through', async () => {
    // The whole point. A journey stepping past a page with real violations and
    // ending somewhere clean used to report nothing at all, because only the
    // final page was ever scanned.
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const result = await runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'passthrough',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        steps: [
          { action: 'navigate', type: 'goto', path: 'login.html' },
          { action: 'navigate', type: 'goto', path: 'violations.html' },
          { action: 'navigate', type: 'goto', path: 'dashboard-clean.html' },
        ],
      });

      const violations = result.pages.find((p) => p.page.route === '/violations.html');

      expect(violations).toBeDefined();
      expect(violations!.axe.violations.length).toBeGreaterThanOrEqual(5);
      // The clean final page must not suppress what came before it.
      expect(result.pages[result.pages.length - 1].page.route).toBe('/dashboard-clean.html');
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('stops at the page cap and says how much it skipped', async () => {
    // A silent cap reads as "we audited everything" when we did not.
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const result = await runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'capped',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        maxPages: 2,
        steps: [
          { action: 'navigate', type: 'goto', path: 'login.html' },
          { action: 'navigate', type: 'goto', path: 'violations.html' },
          { action: 'navigate', type: 'goto', path: 'dashboard-clean.html' },
        ],
      });

      expect(result.pages).toHaveLength(2);
      expect(result.truncatedPages).toBe(1);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('returns degraded artifacts when ax tree capture is omitted', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const result = await runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'dashboard',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        steps: buildDefaultDemoJourneySteps(),
        omitAxTree: true,
      });

      for (const audited of result.pages) {
        expect(audited.artifacts.axTreePath).toBeUndefined();

        const evidence = createEvidenceBundle({
          page: audited.page,
          run: {
            journeyId: 'demo-login',
            stepId: 'dashboard',
            environment: 'test',
          },
          artifacts: audited.artifacts,
        });

        expect(evidence.status).toBe('degraded');
      }
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('never executes denied production actions', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      await expect(
        runJourney({
          environment: 'production',
          journeyId: 'demo-login',
          stepId: 'dashboard',
          fixtureDir: FIXTURE_DIR,
          artifactsDir,
          steps: [
            { action: 'navigate', type: 'goto', path: 'login.html' },
            { action: 'delete', type: 'click', selector: '#delete-account' },
          ],
        }),
      ).rejects.toThrow('Action "delete" is not allowed in production.');

      // The journey dies at the denied step, so nothing past it was ever
      // navigated to, scanned, or captured.
      await expect(
        fileExists(join(artifactsDir, 'dashboard', '02-dashboard.png')),
      ).resolves.toBe(false);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });
});
