import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { runBrowserAudit } from '../../../src/integrations/browser/run-browser-audit';
import { PartialAuditError } from '../../../src/integrations/browser/partial-run';
import type { DeterministicFinding } from '../../../src/services/deterministic-audit';

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
      // Narrowed by predicate: `findings` is a union, and `selector` belongs
      // to the deterministic half. `AiAdvisoryFinding['code']` is the literal
      // `'ai-advisory'`, so matching any other code excludes it — the runtime
      // check and the type check are the same check.
      const imageAlt = report.findings.find(
        (finding): finding is DeterministicFinding => finding.code === 'image-alt',
      );
      expect(imageAlt).toBeDefined();
      expect(imageAlt?.selector).toBeTruthy();
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('runBrowserAudit, when the journey dies partway', () => {
  /**
   * The layer between the two tested ones.
   *
   * `journey-runner.test.ts` proves the runner carries its captures out.
   * `audit-run-persistence.test.ts` proves the handler stores them — but it
   * mocks `runBrowserAudit` wholesale and hands itself a `PartialAuditError`
   * it built by hand. So the code that actually judges a failed run's
   * evidence, derives its findings and counts its checks was driven by
   * nothing. That is where a subtle wrong would hide: the wrong `journeyId`
   * into `createEvidenceBundle`, or `checks` computed only when evidence is
   * complete.
   */
  it('judges the pages it did capture, exactly as a finished run would', async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), 'ada-partial-audit-'));

    try {
      const error = await runBrowserAudit({
        environment: 'test',
        journeyId: 'demo-login',
        stepId: 'partial',
        fixtureDir: FIXTURE_DIR,
        artifactsDir,
        stepTimeoutMs: 1000,
        steps: [
          { action: 'navigate', type: 'goto', path: 'violations.html' },
          { action: 'login', type: 'fill', selector: '#not-here', value: 'x' },
        ],
      }).then(
        () => {
          throw new Error('expected the audit to fail');
        },
        (thrown: unknown) => thrown as PartialAuditError,
      );

      expect(error).toBeInstanceOf(PartialAuditError);
      expect(error.auditedPages).toHaveLength(1);

      const [page] = error.auditedPages;

      // Judged, not merely carried: a page whose three artifacts were written
      // is complete, and a complete page's findings are derived.
      expect(page.evidenceStatus).toBe('complete');
      expect(page.findings.length).toBeGreaterThan(0);

      // And counted. These persisted as null on every partial run until
      // `checks` moved into the shared `auditPages`.
      expect(page.checks.failed).toBeGreaterThan(0);
      expect(page.checks.passed).toBeGreaterThan(0);

      // The failure is still the failure, so the classifier is unaffected.
      expect(error.message).toMatch(/Step 2 \("login"\) could not fill "#not-here"/);
    } finally {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  }, 60_000);
});
