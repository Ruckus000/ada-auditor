import { access } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createEvidenceBundle } from '../../../src/domain/evidence';
import {
  DEFAULT_DEMO_JOURNEY_STEPS,
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
  it('produces complete evidence artifact files for the demo journey', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-journey-'));

    try {
      const result = await runJourney({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'dashboard',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        steps: DEFAULT_DEMO_JOURNEY_STEPS,
      });

      expect(result.page.title).toBe('Dashboard');
      expect(result.page.route).toBe('/dashboard.html');
      expect(result.html).toContain('<img src="hero.png"');

      expect(result.artifacts.screenshotPath).toBeTruthy();
      expect(result.artifacts.domSnapshotPath).toBeTruthy();
      expect(result.artifacts.axTreePath).toBeTruthy();

      await expect(fileExists(result.artifacts.screenshotPath!)).resolves.toBe(true);
      await expect(fileExists(result.artifacts.domSnapshotPath!)).resolves.toBe(true);
      await expect(fileExists(result.artifacts.axTreePath!)).resolves.toBe(true);

      const evidence = createEvidenceBundle({
        page: result.page,
        run: {
          journeyId: 'demo-login',
          stepId: 'dashboard',
          environment: 'test',
        },
        artifacts: result.artifacts,
      });

      expect(evidence.status).toBe('complete');
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
        steps: DEFAULT_DEMO_JOURNEY_STEPS,
        omitAxTree: true,
      });

      expect(result.artifacts.axTreePath).toBeUndefined();

      const evidence = createEvidenceBundle({
        page: result.page,
        run: {
          journeyId: 'demo-login',
          stepId: 'dashboard',
          environment: 'test',
        },
        artifacts: result.artifacts,
      });

      expect(evidence.status).toBe('degraded');
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

      await expect(fileExists(join(artifactsDir, 'dashboard.png'))).resolves.toBe(false);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });
});
