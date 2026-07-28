import type { StoredFinding, StoredRunRecord } from '../domain/persistence';

export type RegressionStatus = 'none' | 'warn' | 'fail';

export type RegressionSummary = {
  status: RegressionStatus;
  baselineRequestId: string;
  newFindings: StoredFinding[];
  resolvedFindings: StoredFinding[];
  unchangedCount: number;
};

function deterministicFindings(findings: StoredFinding[]): StoredFinding[] {
  return findings.filter((finding) => finding.source === 'deterministic');
}

function findingKey(finding: StoredFinding): string {
  return `${finding.source}:${finding.code}`;
}

export function compareToBaseline(
  current: StoredRunRecord,
  baseline: StoredRunRecord,
): RegressionSummary {
  const currentDeterministic = deterministicFindings(current.findings);
  const baselineDeterministic = deterministicFindings(baseline.findings);

  const currentCodes = new Map(currentDeterministic.map((finding) => [findingKey(finding), finding]));
  const baselineCodes = new Map(baselineDeterministic.map((finding) => [findingKey(finding), finding]));

  const newFindings = currentDeterministic.filter(
    (finding) => !baselineCodes.has(findingKey(finding)),
  );
  const resolvedFindings = baselineDeterministic.filter(
    (finding) => !currentCodes.has(findingKey(finding)),
  );
  const unchangedCount = currentDeterministic.filter((finding) =>
    baselineCodes.has(findingKey(finding)),
  ).length;

  const hasNewCritical = newFindings.some((finding) => finding.severity === 'critical');
  const hasNewMajor = newFindings.some((finding) => finding.severity === 'major');

  let status: RegressionStatus = 'none';
  if (hasNewCritical) {
    status = 'fail';
  } else if (hasNewMajor || newFindings.length > 0) {
    status = 'warn';
  }

  return {
    status,
    baselineRequestId: baseline.requestId,
    newFindings,
    resolvedFindings,
    unchangedCount,
  };
}
