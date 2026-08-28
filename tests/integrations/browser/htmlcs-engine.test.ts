import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBrowserAudit } from '../../../src/integrations/browser/run-browser-audit';
import type { DeterministicFinding } from '../../../src/services/deterministic-audit';
import { buildDefaultDemoJourneySteps } from '../../../src/integrations/browser/demo-journey';

const FIXTURE_DIR = join(process.cwd(), 'fixtures/journey-app');

/**
 * End-to-end proof that the second engine is real: HTML_CodeSniffer injected
 * into the same live page axe scans, its results flowing through the same
 * findings path — as needs-review, never as a gate.
 */
describe('htmlcs engine against a real page', () => {
  let artifactsDir: string;

  beforeEach(async () => {
    artifactsDir = await mkdtemp(join(tmpdir(), 'ada-htmlcs-'));
  });

  afterEach(async () => {
    await rm(artifactsDir, { recursive: true, force: true });
  });

  async function auditViolationsPage() {
    return runBrowserAudit({
      journeyId: 'demo-login',
      environment: 'staging',
      stepId: 'violations',
      fixtureDir: FIXTURE_DIR,
      artifactsDir,
      steps: [
        ...buildDefaultDemoJourneySteps(),
        { action: 'navigate', type: 'goto', path: 'violations.html' },
      ],
    });
  }

  it('produces htmlcs findings, all needs-review, none gating', async () => {
    const report = await auditViolationsPage();
    const htmlcs = report.findings.filter(
      (f): f is DeterministicFinding => f.source === 'deterministic' && f.code.startsWith('htmlcs:'),
    );

    expect(htmlcs.length).toBeGreaterThan(0);
    for (const finding of htmlcs) {
      expect(finding.severity).toBe('needs-review');
      expect(finding.source).toBe('deterministic');
    }

    // The fixture breaks A/AA criteria, so the run still fails — but every
    // blocking finding is axe's or a page check's, never HTMLCS's. The gate
    // requires severity !== 'needs-review', and the line above proved no
    // htmlcs finding escapes that severity.
    expect(report.ciStatus).toBe('fail');
  }, 120_000);

  it('locates per-element results by selector and cites criteria', async () => {
    const report = await auditViolationsPage();
    const located = report.findings.filter(
      (f): f is DeterministicFinding =>
        f.source === 'deterministic' &&
        f.code.startsWith('htmlcs:') &&
        !f.code.startsWith('htmlcs:notice:') &&
        f.selector !== '',
    );

    expect(located.length).toBeGreaterThan(0);
    for (const finding of located) {
      expect(finding.wcagCriteria.every((c) => /^\d\.\d\.\d+$/.test(c))).toBe(true);
      expect(finding.helpUrl).toMatch(/^https:\/\/www\.w3\.org\//);
    }
  }, 120_000);

  it('collapses notices to one counted finding per technique per page', async () => {
    const report = await auditViolationsPage();
    const notices = report.findings.filter(
      (f): f is DeterministicFinding =>
        f.source === 'deterministic' && f.code.startsWith('htmlcs:notice:'),
    );

    expect(notices.length).toBeGreaterThan(0);
    for (const finding of notices) {
      expect(finding.selector).toBe('');
      expect(finding.message).toMatch(/^\d+ elements? to review\./);
    }

    // Collapse means per-technique-per-page identity is unique.
    const identities = notices.map((f) => `${f.code}@${f.pageUrl}`);
    expect(new Set(identities).size).toBe(identities.length);
  }, 120_000);

  it('does not echo what axe already reported on the same element and criterion', async () => {
    // Selector strings cannot prove overlap from out here — the engines write
    // different dialects for the same node — so this pins the concrete case
    // the fixture plants: its images without alt. axe reports `image-alt`
    // (1.1.1) on every one of them, so HTMLCS's H37 error — "Img element
    // missing an alt attribute", the same defect on the same elements — must
    // have been suppressed by the in-page element-identity match.
    const report = await auditViolationsPage();

    const axeSawMissingAlt = report.findings.some((f) => f.code === 'image-alt');
    expect(axeSawMissingAlt).toBe(true);

    const echoes = report.findings.filter(
      (f) => f.source === 'deterministic' && f.code === 'htmlcs:1_1_1.H37',
    );
    expect(echoes).toEqual([]);
  }, 120_000);
});
