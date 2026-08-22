import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runBrowserAudit } from '../../../src/integrations/browser/run-browser-audit';
import { buildDefaultDemoJourneySteps } from '../../../src/integrations/browser/demo-journey';

const FIXTURE_DIR = join(process.cwd(), 'fixtures/journey-app');

/**
 * End-to-end proof that the rule engine is real.
 *
 * Before axe-core, the whole engine was one regex testing whether the document
 * contained an `<img>` without `alt=`. It produced at most one finding per run,
 * with no selector, no success criterion, and no way to tell a developer which
 * element was at fault. These assertions would all have been impossible.
 */
describe('axe engine against a real page', () => {
  let artifactsDir: string;

  beforeEach(async () => {
    artifactsDir = await mkdtemp(join(tmpdir(), 'ada-axe-'));
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

  it('reports many distinct findings, each located by selector', async () => {
    const report = await auditViolationsPage();
    const deterministic = report.findings.filter((f) => f.source === 'deterministic');

    expect(deterministic.length).toBeGreaterThanOrEqual(5);

    const selectors = deterministic.map((f) => f.selector);
    expect(new Set(selectors).size).toBeGreaterThanOrEqual(5);
    expect(selectors.every((selector) => selector.length > 0)).toBe(true);
  }, 120_000);

  it('cites WCAG success criteria and conformance levels', async () => {
    const report = await auditViolationsPage();
    const deterministic = report.findings.filter((f) => f.source === 'deterministic');
    const cited = deterministic.filter((f) => f.wcagCriteria.length > 0);

    expect(cited.length).toBeGreaterThan(0);
    for (const finding of cited) {
      // e.g. "1.1.1" / "4.1.2"
      expect(finding.wcagCriteria.every((c) => /^\d\.\d\.\d+$/.test(c))).toBe(true);
      expect(['A', 'AA', 'AAA']).toContain(finding.conformanceLevel);
    }
  }, 120_000);

  it('finds the specific rules this fixture was built to break', async () => {
    const report = await auditViolationsPage();
    const codes = new Set(report.findings.map((f) => f.code));

    expect(codes).toContain('image-alt');
    expect(codes).toContain('button-name');
    expect(codes).toContain('link-name');
  }, 120_000);

  it('carries a snippet and a help URL a developer can act on', async () => {
    const report = await auditViolationsPage();
    // The journey passes through `dashboard.html`, which breaks `image-alt`
    // too — so the finding has to be picked by page, which is the point of
    // `pageUrl` existing.
    const imageAlt = report.findings
      .filter((f) => f.source === 'deterministic')
      .find((f) => f.code === 'image-alt' && f.pageUrl.endsWith('violations.html'));

    expect(imageAlt).toBeDefined();
    expect(imageAlt?.selector).toContain('no-alt');
    expect(imageAlt?.htmlSnippet).toContain('<img');
    expect(imageAlt?.helpUrl).toMatch(/^https?:\/\//);
    expect(imageAlt?.severity).toBe('critical');
  }, 120_000);

  it('fails the run, counting every unmet success criterion as blocking', async () => {
    // This asserted the opposite bound until the gate moved: that blocking was
    // strictly fewer than total, because contrast is `serious` -> `major` and
    // `major` did not gate. That was axe's impact scale deciding a WCAG
    // question. Conformance is binary per criterion — contrast is 1.4.3 at
    // Level AA — so a page failing it does not conform, whatever Deque rates
    // the impact.
    //
    // Every finding this fixture produces cites a real criterion, so blocking
    // legitimately equals total here. What still must not gate is asserted
    // where it can be stated exactly rather than inferred from a fixture's
    // contents: `tests/services/reporting.test.ts` covers best-practice rules,
    // `needs-review`, AAA and advisory findings one at a time.
    const report = await auditViolationsPage();

    expect(report.evidenceStatus).toBe('complete');
    expect(report.ciStatus).toBe('fail');
    expect(report.executiveSummary.blockingFindings).toBeGreaterThan(0);

    // Every blocking finding is one axe decided against, never one it could
    // not decide — the review queue is not a conformance failure.
    const gating = report.findings.filter(
      (f) => f.source === 'deterministic' && f.severity !== 'needs-review',
    );
    expect(report.executiveSummary.blockingFindings).toBeLessThanOrEqual(gating.length);
  }, 120_000);

  it('reports violations on a page the journey only passes through', async () => {
    // The regression this phase exists to prevent. Before multi-page scanning
    // this exact journey returned `pass` with zero findings: only the final
    // page was ever audited, so five real WCAG violations one step earlier
    // were discarded. A clean last screen must not launder the journey.
    const report = await runBrowserAudit({
      journeyId: 'demo-login',
      environment: 'staging',
      stepId: 'passthrough',
      fixtureDir: FIXTURE_DIR,
      artifactsDir,
      steps: [
        { action: 'navigate', type: 'goto', path: 'login.html' },
        { action: 'navigate', type: 'goto', path: 'violations.html' },
        { action: 'navigate', type: 'goto', path: 'dashboard-clean.html' },
      ],
    });

    const onViolations = report.findings
      .filter((f) => f.source === 'deterministic')
      .filter((f) => f.pageUrl.endsWith('violations.html'));

    expect(onViolations.length).toBeGreaterThanOrEqual(5);
    expect(new Set(onViolations.map((f) => f.selector)).size).toBeGreaterThanOrEqual(5);
    expect(report.ciStatus).toBe('fail');

    // And the run knows which pages it covered, in order.
    expect(report.pages.map((p) => p.page.route)).toEqual([
      '/login.html',
      '/violations.html',
      '/dashboard-clean.html',
    ]);
  }, 120_000);

  it('rejects every deterministic finding when evidence is incomplete', async () => {
    // Steady-state rule: incomplete evidence is never pass and never fail.
    const report = await runBrowserAudit({
      journeyId: 'demo-login',
      environment: 'staging',
      stepId: 'violations',
      fixtureDir: FIXTURE_DIR,
      artifactsDir,
      omitAxTree: true,
      steps: [
        ...buildDefaultDemoJourneySteps(),
        { action: 'navigate', type: 'goto', path: 'violations.html' },
      ],
    });

    expect(report.evidenceStatus).toBe('degraded');
    expect(report.ciStatus).toBe('inconclusive');
    expect(report.findings.some((f) => f.source === 'deterministic')).toBe(false);
  }, 120_000);
});
