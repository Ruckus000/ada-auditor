import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { runBrowserAudit } from '../../../src/integrations/browser/run-browser-audit';

const FIXTURE_DIR = join(process.cwd(), 'fixtures/journey-app');

describe('runBrowserAudit', () => {
  /**
   * The backstop under the route guard.
   *
   * The built-in demo is a *fixture* journey — its paths only mean anything
   * against `fixtureDir`. Substituting it for a run that names a real target
   * resolved those paths against the client's origin instead, so the audit was
   * of whatever `https://their-site/login.html` returned, filed under their
   * name. The platform route refuses this now; this refuses it for every other
   * caller, and launches no browser to do so.
   */
  it('refuses a target URL with no steps rather than walking the fixture journey', async () => {
    await expect(
      runBrowserAudit({
        environment: 'staging',
        journeyId: 'demo-login',
        stepId: 'dashboard',
        fixtureDir: FIXTURE_DIR,
        // A literal, not `mkdtemp`: the guard throws before anything creates
        // this, so making a real directory here would only leak one.
        artifactsDir: join(tmpdir(), 'ada-no-steps-never-created'),
        targetUrl: 'https://example.test/',
      }),
    ).rejects.toThrow(/must name its own steps/);
  });

  it('returns inconclusive when ax tree evidence is omitted (chaos path)', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-browser-audit-'));

    try {
      const report = await runBrowserAudit({
        environment: 'staging',
        journeyId: 'demo-login',
        stepId: 'dashboard',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        omitAxTree: true,
      });

      expect(report.evidenceStatus).toBe('degraded');
      expect(report.ciStatus).toBe('inconclusive');
      expect(report.findings.every((finding) => finding.source !== 'deterministic')).toBe(true);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('fails CI on deterministic criticals with complete browser evidence', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-browser-audit-'));

    try {
      const report = await runBrowserAudit({
        environment: 'staging',
        journeyId: 'demo-login',
        stepId: 'dashboard',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
      });

      expect(report.evidenceStatus).toBe('complete');
      expect(report.ciStatus).toBe('fail');
      // `image-alt` is axe's rule id; the old hand-rolled code was
      // `missing-image-alt` and carried no selector to go with it.
      const imageAlt = report.findings.find((finding) => finding.code === 'image-alt');
      expect(imageAlt).toBeDefined();
      expect(imageAlt?.selector).toBeTruthy();
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);
});
