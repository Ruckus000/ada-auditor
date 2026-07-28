import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { runBrowserAudit } from '../../../src/integrations/browser/run-browser-audit';

const FIXTURE_DIR = join(process.cwd(), 'fixtures/journey-app');

describe('runBrowserAudit', () => {
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
      expect(report.findings.some((finding) => finding.code === 'missing-image-alt')).toBe(true);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);
});
