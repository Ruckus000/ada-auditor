import { createRunContract } from '../../domain/contracts';
import { createEvidenceBundle } from '../../domain/evidence';
import { createPlatformContext } from '../../domain/platforms';
import { resolvePlatformMetadata } from '../platforms';
import { createAiAdvisoryFinding } from '../../services/ai-advisory';
import { runDeterministicAudit } from '../../services/deterministic-audit';
import { summarizeRun } from '../../services/reporting';
import { buildDefaultDemoJourneySteps, runJourney } from './journey-runner';
import type { JourneyRunnerInput } from './types';

export type RunBrowserAuditInput = JourneyRunnerInput & {
  platformHint?: string;
  allowedJourneyIds?: string[];
};

/**
 * The single audit path.
 *
 * There used to be a second one that accepted an HTML string and evaluated it
 * with a regex. It was deleted rather than upgraded: rule evaluation over a
 * markup fragment has no stylesheet and no layout, so contrast and geometry
 * rules would score against user-agent defaults — and it asserted complete
 * evidence while pointing at artifact files it never created. Findings now
 * come only from a real page whose screenshot, DOM, and accessibility tree
 * were captured in the same session.
 */
export async function runBrowserAudit(input: RunBrowserAuditInput) {
  // The allowlist is the target's own host unless a run says otherwise: an
  // audit of one site has no business navigating to another.
  const allowedHosts =
    input.allowedHosts ?? (input.targetUrl ? [new URL(input.targetUrl).hostname] : []);

  const journeyResult = await runJourney({
    ...input,
    allowedHosts,
    steps: input.steps ?? buildDefaultDemoJourneySteps(),
  });

  const platform = resolvePlatformMetadata({
    html: journeyResult.html,
    platformHint: input.platformHint,
  });
  const platformContext = createPlatformContext({
    platformHint: platform.id,
  });

  const journeyIds = input.allowedJourneyIds ?? [input.journeyId];

  const contract = createRunContract({
    environment: input.environment,
    identity: { accountId: 'acct-demo', role: 'auditor' },
    scope: {
      // Reflects the hosts the run may actually reach. This used to be a
      // hardcoded literal that nothing enforced; it now mirrors what the
      // navigation guard checks against on every step.
      allowedDomains: allowedHosts,
      journeyIds,
    },
    actionPolicy: {
      mode: input.environment === 'production' ? 'read-only' : 'safe-write',
    },
    recoveryPolicy: {
      maxAttempts: 1,
      strategies: ['selector-fallback'],
    },
    confidencePolicy: {
      minContinue: 0.8,
      minReport: 0.7,
    },
    failureMode: 'degrade',
    platform: platform.id,
    platformCapabilities: platformContext.capabilities,
  });

  if (!contract.scope.journeyIds.includes(input.journeyId)) {
    throw new Error('Journey is not allowed by run contract scope.');
  }

  const evidence = createEvidenceBundle({
    page: journeyResult.page,
    run: {
      journeyId: input.journeyId,
      stepId: input.stepId,
      environment: input.environment,
    },
    artifacts: journeyResult.artifacts,
  });

  const deterministicFindings =
    evidence.status === 'complete' ? runDeterministicAudit(journeyResult.axe) : [];

  const advisoryCandidate = createAiAdvisoryFinding({
    message: 'Review instructions and labels for screen-reader clarity.',
    confidence: 0.84,
  });
  const aiFindings =
    advisoryCandidate.confidence >= contract.confidencePolicy.minReport ? [advisoryCandidate] : [];

  const findings = [...deterministicFindings, ...aiFindings];
  const report = summarizeRun({
    findings,
    evidenceStatus: evidence.status,
  });

  return {
    journeyId: input.journeyId,
    environment: input.environment,
    evidenceStatus: evidence.status,
    findings,
    platform,
    contract,
    page: journeyResult.page,
    artifacts: journeyResult.artifacts,
    ...report,
  };
}
