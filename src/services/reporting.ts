import type { EvidenceStatus } from '../domain/evidence';
import type { AiAdvisoryFinding } from './ai-advisory';
import type { DeterministicFinding } from './deterministic-audit';

export type AuditFinding =
  | DeterministicFinding
  | (AiAdvisoryFinding & { severity: 'advisory' });

export type CiStatus = 'pass' | 'fail' | 'inconclusive';

export function summarizeRun(input: {
  findings: AuditFinding[];
  evidenceStatus: EvidenceStatus;
}) {
  if (input.evidenceStatus !== 'complete') {
    return {
      ciStatus: 'inconclusive' as const,
      executionStatus: 'degraded' as const,
      executiveSummary: {
        totalFindings: input.findings.length,
        blockingFindings: 0,
        advisoryFindings: input.findings.filter((finding) => finding.source === 'ai-advisory')
          .length,
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
      advisoryFindings: input.findings.filter((finding) => finding.source === 'ai-advisory').length,
    },
  };
}
