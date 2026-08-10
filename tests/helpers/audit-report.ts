import type { DeterministicFinding } from '../../src/services/deterministic-audit';

/**
 * Builds a `runBrowserAudit` return value for handler tests.
 *
 * Handler tests assert on request validation, chaos gating, error mapping and
 * persistence wiring — none of which need a real browser. Driving Chromium for
 * those would put a multi-second launch into the fast unit suite for no added
 * coverage; the real browser path is exercised by `tests/integrations/browser/**`
 * and by `npm run chaos`.
 */

export function criticalFinding(
  overrides: Partial<DeterministicFinding> = {},
): DeterministicFinding {
  return {
    code: 'image-alt',
    severity: 'critical',
    title: 'Images must have alternate text',
    message: 'Element does not have an alt attribute',
    remediation: {
      anyOf: ['Element does not have an alt attribute', 'Element has no title attribute'],
      allOf: [],
    },
    source: 'deterministic',
    wcagCriteria: ['1.1.1'],
    conformanceLevel: 'A',
    pageUrl: 'https://app.example.com/dashboard',
    selector: '#hero',
    htmlSnippet: '<img src="hero.png">',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/image-alt',
    ...overrides,
  };
}

type ReportOverrides = {
  journeyId?: string;
  environment?: string;
  findings?: DeterministicFinding[];
  evidenceStatus?: 'complete' | 'degraded';
  ciStatus?: 'pass' | 'fail' | 'inconclusive';
  /** Pages the run audited. Defaults to a single-page journey. */
  pages?: Array<{
    page: { url: string; route: string; title: string };
    pageKey: string;
    evidenceStatus: 'complete' | 'degraded';
    artifacts: Record<string, string>;
  }>;
};

function defaultPages(evidenceStatus: 'complete' | 'degraded') {
  return [
    {
      page: {
        url: 'https://app.example.com/dashboard',
        route: '/dashboard',
        title: 'Dashboard',
      },
      pageKey: '01-dashboard',
      evidenceStatus,
      artifacts: {
        screenshotPath: 'artifacts/01-dashboard.png',
        domSnapshotPath: 'artifacts/01-dashboard.html',
        ...(evidenceStatus === 'complete'
          ? { axTreePath: 'artifacts/01-dashboard.ax.json' }
          : {}),
      },
    },
  ];
}

export function auditReport(overrides: ReportOverrides = {}) {
  const findings = overrides.findings ?? [];
  const evidenceStatus = overrides.evidenceStatus ?? 'complete';
  const blockingFindings =
    evidenceStatus === 'complete'
      ? findings.filter((f) => f.source === 'deterministic' && f.severity === 'critical').length
      : 0;

  return {
    journeyId: overrides.journeyId ?? 'demo-login',
    environment: overrides.environment ?? 'staging',
    evidenceStatus,
    ciStatus:
      overrides.ciStatus ??
      (evidenceStatus !== 'complete' ? 'inconclusive' : blockingFindings > 0 ? 'fail' : 'pass'),
    executionStatus: evidenceStatus === 'complete' ? 'complete' : 'degraded',
    findings,
    platform: { id: 'generic', hints: ['rendered-dom-baseline'] },
    contract: {},
    pages: overrides.pages ?? defaultPages(evidenceStatus),
    truncatedPages: 0,
    executiveSummary: {
      totalFindings: findings.length,
      blockingFindings,
      // The helper only builds deterministic findings; advisory ones are
      // covered where the advisory itself is under test.
      advisoryFindings: 0,
      pagesScanned: (overrides.pages ?? defaultPages(evidenceStatus)).length,
      pagesTruncated: 0,
    },
  };
}
