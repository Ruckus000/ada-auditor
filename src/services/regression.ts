import type { StoredFinding, StoredRunRecord } from '../domain/persistence';

export type RegressionStatus = 'none' | 'warn' | 'fail' | 'incomparable';

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

/**
 * Whether two runs walked the same path, as far as either can prove.
 *
 * `null` from either side means the run predates `intent` and simply did not
 * record what it was asked to do. That is not evidence of agreement, so it
 * answers `false` — the diff is withheld rather than presented on a guess. It
 * costs one run per journey after this ships and nothing after that.
 *
 * Compared by serialising rather than field by field: the domain deliberately
 * holds steps as `unknown[]`, so it has no business knowing what a step is.
 * Order matters, and should — the same pages in a different order is a
 * different journey.
 */
function walkedTheSamePath(a: StoredRunRecord, b: StoredRunRecord): boolean {
  if (!a.intent || !b.intent) return false;
  return JSON.stringify(a.intent.steps) === JSON.stringify(b.intent.steps);
}

export function compareToBaseline(
  current: StoredRunRecord,
  baseline: StoredRunRecord,
): RegressionSummary {
  /**
   * Two runs of different paths have nothing to say to each other.
   *
   * `getLatestRun` picks a baseline on `journeyId` and `environment` alone,
   * and `/api/audit/run` takes `journeyId` and `steps` independently — so a
   * call naming an existing journey and walking somewhere else becomes the
   * next run's baseline. Diffed, every finding the real journey has that the
   * other did not comes back as **resolved**: the product's worst output, a
   * clean bill of health nobody earned.
   *
   * Withheld rather than guessed at. The findings themselves are unaffected —
   * they are reported in full elsewhere. What is refused is the claim that
   * anything got better.
   */
  if (!walkedTheSamePath(current, baseline)) {
    return {
      status: 'incomparable',
      baselineRequestId: baseline.requestId,
      newFindings: [],
      resolvedFindings: [],
      unchangedCount: 0,
    };
  }

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
