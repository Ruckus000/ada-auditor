import type {
  RunStatus,
  StoredFinding,
  StoredRunPage,
  StoredRunRecord,
} from '../domain/persistence';
import type { AuditFinding } from './reporting';
import type { CiStatus } from './reporting';

type PersistRunInput = {
  requestId: string;
  journeyId: string;
  environment: StoredRunRecord['environment'];
  platform: string;
  evidenceStatus: string;
  ciStatus: CiStatus;
  findings: AuditFinding[];
  durationMs: number;
  browserMode?: boolean;
  pages?: StoredRunPage[];
  status?: RunStatus;
  failureReason?: string;
};

/**
 * Findings persist with everything needed to act on them later: what failed,
 * where, which success criterion, and how to fix it. A stored run is the
 * record a client report and a regression diff are both built from, so
 * dropping fields here silently degrades both.
 */
function toStoredFinding(finding: AuditFinding): StoredFinding {
  if (finding.source === 'ai-advisory') {
    return {
      code: finding.code,
      severity: finding.severity,
      source: finding.source,
      message: finding.message,
      gateable: finding.gateable,
      confidence: finding.confidence,
    };
  }

  return {
    code: finding.code,
    severity: finding.severity,
    source: finding.source,
    message: finding.message,
    wcagCriteria: finding.wcagCriteria,
    conformanceLevel: finding.conformanceLevel,
    // Without this a multi-page run stores findings that cannot say which page
    // they belong to, and the regression diff collapses the same rule and
    // selector on two pages into one entry.
    pageUrl: finding.pageUrl,
    selector: finding.selector,
    htmlSnippet: finding.htmlSnippet,
    helpUrl: finding.helpUrl,
  };
}

export function toStoredRunRecord(input: PersistRunInput): StoredRunRecord {
  return {
    requestId: input.requestId,
    journeyId: input.journeyId,
    environment: input.environment,
    platform: input.platform,
    evidenceStatus: input.evidenceStatus,
    ciStatus: input.ciStatus,
    findings: input.findings.map(toStoredFinding),
    durationMs: input.durationMs,
    createdAt: new Date().toISOString(),
    ...(input.browserMode ? { browserMode: true } : {}),
    ...(input.pages && input.pages.length > 0 ? { pages: input.pages } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.failureReason ? { failureReason: input.failureReason } : {}),
  };
}
