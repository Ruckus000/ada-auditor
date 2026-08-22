import type { EvidenceStatus } from '../domain/evidence';
import type { AiAdvisoryFinding } from './ai-advisory';
import type { DeterministicFinding } from './deterministic-audit';

export type AuditFinding =
  | DeterministicFinding
  | (AiAdvisoryFinding & { severity: 'advisory' });

export type CiStatus = 'pass' | 'fail' | 'inconclusive';

/**
 * Bumped when the gate changes, so old runs are not silently reinterpreted.
 *
 * The same reason `SCORE_VERSION` exists, for the same kind of claim. A stored
 * `pass` means nothing on its own once the question behind it has changed, and
 * a client's trend line would show a cliff where no site changed at all.
 *
 * 2 — the verdict follows the success criterion rather than axe's impact.
 */
export const GATE_VERSION = 2;

/**
 * Levels whose failure means the page does not conform.
 *
 * AAA is out because AA is the bar ADA claims are argued against, and a
 * product that reported non-conformance on AAA would be failing every site on
 * a standard almost nothing targets.
 */
const GATING_LEVELS: ReadonlySet<string> = new Set(['A', 'AA']);

/**
 * Whether a finding means the page does not conform.
 *
 * **The success criterion decides, not axe's impact.** Impact is Deque's
 * operational triage — how bad it is to hit in practice — and conformance is
 * binary per criterion: colour contrast is 1.4.3 at Level AA, so a page
 * failing it does not conform to AA whatever anyone rates its severity.
 * Crossing the two axes was wrong in both directions, and measurably so: of
 * axe-core 4.12.1's 105 rules, 30 are best-practice and map to no criterion at
 * all, so a `critical` recommendation asserted non-conformance, while a real
 * Level AA failure rated `moderate` never did. The first real client audit
 * came back with 86 findings, none `critical`, and read `pass`.
 *
 * Three exclusions, each load-bearing:
 *
 * - **Advisory findings never gate.** `gateable: false` is a steady-state
 *   contract: a model's judgement is not a proof, and a gate is a proof.
 * - **`needs-review` never gates**, and this is the sharp one.
 *   `runDeterministicAudit` maps axe's `incomplete` results to that severity
 *   through the *same* mapper as violations, so they carry a conformance level
 *   like anything else. Counting them would turn the human review queue into
 *   conformance failures, inverting the sentence that produces them: "axe
 *   could not reach a verdict on these, so they are never a failure."
 * - **No criterion, no gate.** A best-practice rule is a recommendation, and
 *   `conformanceLevelFromTags` answers `null` for one.
 */
function failsConformance(finding: AuditFinding): boolean {
  return (
    finding.source === 'deterministic' &&
    finding.severity !== 'needs-review' &&
    finding.conformanceLevel != null &&
    GATING_LEVELS.has(finding.conformanceLevel)
  );
}

/**
 * Rolls a whole run up into one verdict.
 *
 * The findings handed in are the run's aggregate — every page of the audited
 * site the journey walked through, concatenated. `evidenceStatus` is the worst of the pages'
 * (see `worstEvidenceStatus` in `domain/evidence.ts`), so one page missing an
 * artifact makes the whole run inconclusive.
 *
 * `pagesScanned` and `pagesTruncated` are reported rather than inferred from
 * the findings, because a page with nothing wrong on it still counts as
 * audited — and a page the cap prevented visiting must never be mistaken for
 * one that came back clean.
 */
export function summarizeRun(input: {
  findings: AuditFinding[];
  evidenceStatus: EvidenceStatus;
  pagesScanned?: number;
  pagesTruncated?: number;
}) {
  const advisoryFindings = input.findings.filter(
    (finding) => finding.source === 'ai-advisory',
  ).length;

  const pages = {
    pagesScanned: input.pagesScanned ?? 0,
    pagesTruncated: input.pagesTruncated ?? 0,
  };

  if (input.evidenceStatus !== 'complete') {
    return {
      ciStatus: 'inconclusive' as const,
      executionStatus: 'degraded' as const,
      gateVersion: GATE_VERSION,
      executiveSummary: {
        totalFindings: input.findings.length,
        blockingFindings: 0,
        advisoryFindings,
        ...pages,
      },
    };
  }

  const blockingFindings = input.findings.filter(failsConformance).length;

  return {
    ciStatus: (blockingFindings > 0 ? 'fail' : 'pass') as CiStatus,
    executionStatus: 'complete' as const,
    gateVersion: GATE_VERSION,
    executiveSummary: {
      totalFindings: input.findings.length,
      blockingFindings,
      advisoryFindings,
      ...pages,
    },
  };
}
