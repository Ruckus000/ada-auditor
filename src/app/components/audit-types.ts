/** Shapes the console reads back from POST /api/audit/console. */

export type Verdict = 'pass' | 'fail' | 'inconclusive';
export type Severity = 'critical' | 'major' | 'minor' | 'advisory';

export interface Finding {
  code: string;
  severity: Severity;
  /**
   * Absent on findings that come back inside `regression`: those are
   * `StoredFinding` records, which persist only code/severity/source.
   */
  message?: string;
  source: 'deterministic' | 'ai-advisory';
  gateable?: boolean;
  confidence?: number;
  /**
   * Page the finding was found on. Absent on advisory findings, which are
   * produced once over the whole journey rather than per page.
   */
  pageUrl?: string;
}

export type EvidenceStatus = 'complete' | 'degraded';

/** One page a run audited, as the console reads it back. */
export interface AuditPage {
  url: string;
  route: string;
  title: string;
  evidenceStatus?: EvidenceStatus;
}

export interface RegressionSummary {
  status: 'none' | 'warn' | 'fail';
  baselineRequestId?: string;
  newFindings: Finding[];
  resolvedFindings: Finding[];
  unchangedCount: number;
}

export interface AuditResult {
  httpStatus: number;
  ok: boolean;
  verdict?: Verdict;
  /** Worst of the pages': one degraded page makes the whole run degraded. */
  evidenceStatus?: EvidenceStatus;
  /** Every page the run audited, in visit order. */
  pages?: AuditPage[];
  /** Pages the run's page cap refused to audit. Non-zero means partial cover. */
  truncatedPages?: number;
  requestId?: string;
  journeyId?: string;
  environment?: string;
  platform?: string;
  durationMs?: number;
  error?: string;
  findings: Finding[];
  regression?: RegressionSummary;
  /** True when this came from a rigged practice run rather than a real audit. */
  simulated?: boolean;
}

const SEVERITIES: Severity[] = ['critical', 'major', 'minor', 'advisory'];

function toFinding(value: unknown): Finding | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  // `message` is deliberately not required — regression entries omit it.
  if (typeof raw.code !== 'string') return null;

  const severity = SEVERITIES.includes(raw.severity as Severity)
    ? (raw.severity as Severity)
    : 'minor';
  const source = raw.source === 'ai-advisory' ? 'ai-advisory' : 'deterministic';

  return {
    code: raw.code,
    message: typeof raw.message === 'string' ? raw.message : undefined,
    severity,
    source,
    gateable: typeof raw.gateable === 'boolean' ? raw.gateable : source === 'deterministic',
    confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
    pageUrl: typeof raw.pageUrl === 'string' ? raw.pageUrl : undefined,
  };
}

function toPage(value: unknown): AuditPage | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.url !== 'string') return null;

  return {
    url: raw.url,
    route: typeof raw.route === 'string' ? raw.route : raw.url,
    title: typeof raw.title === 'string' ? raw.title : raw.url,
    evidenceStatus:
      raw.evidenceStatus === 'complete' || raw.evidenceStatus === 'degraded'
        ? raw.evidenceStatus
        : undefined,
  };
}

export function parsePages(value: unknown): AuditPage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(toPage).filter((page): page is AuditPage => page !== null);
}

export function parseFindings(value: unknown): Finding[] {
  if (!Array.isArray(value)) return [];
  return value.map(toFinding).filter((f): f is Finding => f !== null);
}

function parseRegression(value: unknown): RegressionSummary | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const status =
    raw.status === 'warn' || raw.status === 'fail' || raw.status === 'none' ? raw.status : 'none';

  return {
    status,
    baselineRequestId:
      typeof raw.baselineRequestId === 'string' ? raw.baselineRequestId : undefined,
    newFindings: parseFindings(raw.newFindings),
    resolvedFindings: parseFindings(raw.resolvedFindings),
    unchangedCount: typeof raw.unchangedCount === 'number' ? raw.unchangedCount : 0,
  };
}

/** Normalises an API response into the shape the UI renders. */
export function parseAuditResponse(
  payload: unknown,
  httpStatus: number,
  ok: boolean,
  simulated: boolean,
): AuditResult {
  const raw = (payload ?? {}) as Record<string, unknown>;
  const verdict =
    raw.ciStatus === 'pass' || raw.ciStatus === 'fail' || raw.ciStatus === 'inconclusive'
      ? raw.ciStatus
      : undefined;

  return {
    httpStatus,
    ok,
    verdict,
    evidenceStatus:
      raw.evidenceStatus === 'complete' || raw.evidenceStatus === 'degraded'
        ? raw.evidenceStatus
        : undefined,
    requestId: typeof raw.requestId === 'string' ? raw.requestId : undefined,
    journeyId: typeof raw.journeyId === 'string' ? raw.journeyId : undefined,
    environment: typeof raw.environment === 'string' ? raw.environment : undefined,
    platform: typeof raw.platform === 'string' ? raw.platform : undefined,
    durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : undefined,
    error: typeof raw.error === 'string' ? raw.error : undefined,
    findings: parseFindings(raw.findings),
    pages: parsePages(raw.pages),
    truncatedPages: typeof raw.truncatedPages === 'number' ? raw.truncatedPages : undefined,
    regression: parseRegression(raw.regression),
    simulated,
  };
}

/**
 * Groups findings by the page they were found on, in visit order.
 *
 * A run audits every page its journey walks through, so a flat list makes the
 * reader work out which of five screens each finding belongs to. Advisory
 * findings carry no page — the advisory pass reviews the whole journey at once
 * — so they collect in a trailing group rather than being attributed to a page
 * they were not derived from.
 *
 * Findings whose page the run did not report still get a group of their own:
 * dropping them would be worse than showing them under an unfamiliar URL.
 */
export type FindingGroup = {
  /** null for findings that belong to the journey rather than to one page. */
  page: AuditPage | null;
  findings: Finding[];
};

export function groupFindingsByPage(result: AuditResult): FindingGroup[] {
  const byUrl = new Map<string, Finding[]>();
  const unattributed: Finding[] = [];

  for (const finding of result.findings) {
    if (!finding.pageUrl) {
      unattributed.push(finding);
      continue;
    }
    const bucket = byUrl.get(finding.pageUrl);
    if (bucket) bucket.push(finding);
    else byUrl.set(finding.pageUrl, [finding]);
  }

  const groups: FindingGroup[] = [];

  for (const page of result.pages ?? []) {
    const findings = byUrl.get(page.url);
    if (findings) {
      groups.push({ page, findings });
      byUrl.delete(page.url);
    }
  }

  // Anything left is a page the run did not list — an older record, or a
  // response shape we do not recognise. Show it rather than silently dropping
  // findings on the floor.
  for (const [url, findings] of byUrl) {
    groups.push({ page: { url, route: url, title: url }, findings });
  }

  if (unattributed.length > 0) {
    groups.push({ page: null, findings: unattributed });
  }

  return groups;
}

export function countBySource(findings: Finding[]) {
  const deterministic = findings.filter((f) => f.source === 'deterministic');
  const advisory = findings.filter((f) => f.source === 'ai-advisory');
  return {
    deterministic,
    advisory,
    blocking: deterministic.filter((f) => f.severity === 'critical'),
    total: findings.length,
  };
}
