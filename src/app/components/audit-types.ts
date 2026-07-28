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
  evidenceStatus?: 'complete' | 'degraded';
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
  };
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
    regression: parseRegression(raw.regression),
    simulated,
  };
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
