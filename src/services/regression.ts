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

/**
 * Identity of a finding for diffing purposes.
 *
 * The selector is part of the key because the rule engine reports one finding
 * per offending element. Keying on the rule alone would collapse every
 * occurrence into a single entry, so fixing nine of ten broken images would
 * show up as no change at all, and breaking a tenth would show up as nothing
 * new.
 *
 * The page is part of the key for exactly the same reason one level up. A run
 * audits every page a journey walks through, and two pages routinely share a
 * template — so `#nav-logo` failing `image-alt` on both is two separate fixes.
 * Without the page they collapse into one entry, and fixing one of them reads
 * as fixing both.
 *
 * Exported because triage keys on it too: a dismissal is a decision about a
 * defect's identity, and that identity has exactly one definition. Two copies
 * would drift, and the day they did, a dismissal would silently stop matching
 * the finding it was recorded against.
 */
export function findingKey(finding: StoredFinding): string {
  return `${finding.source}:${finding.code}:${finding.pageUrl ?? ''}:${finding.selector ?? ''}`;
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
