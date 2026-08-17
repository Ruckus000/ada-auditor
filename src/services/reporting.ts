import type { EvidenceStatus } from '../domain/evidence';
import type { AiAdvisoryFinding } from './ai-advisory';
import type { DeterministicFinding } from './deterministic-audit';

export type AuditFinding =
  | DeterministicFinding
  | (AiAdvisoryFinding & { severity: 'advisory' });

export type CiStatus = 'pass' | 'fail' | 'inconclusive';

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
      executiveSummary: {
        totalFindings: input.findings.length,
        blockingFindings: 0,
        advisoryFindings,
        ...pages,
      },
    };
  }

  const blockingFindings = input.findings.filter(
    (finding) => finding.source === 'deterministic' && finding.severity === 'critical',
  ).length;

  return {
    ciStatus: (blockingFindings > 0 ? 'fail' : 'pass') as CiStatus,
    executionStatus: 'complete' as const,
    executiveSummary: {
      totalFindings: input.findings.length,
      blockingFindings,
      advisoryFindings,
      ...pages,
    },
  };
}
