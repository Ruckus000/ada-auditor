import { createRunContract, type Environment } from '../domain/contracts';
import { createEvidenceBundle } from '../domain/evidence';
import { createPlatformContext } from '../domain/platforms';
import { isActionAllowed } from '../domain/policy';
import { resolvePlatformMetadata } from '../integrations/platforms';
import { createAiAdvisoryFinding } from './ai-advisory';
import { runDeterministicAudit } from './deterministic-audit';
import { summarizeRun } from './reporting';

type RunAuditInput = {
  journeyId: string;
  environment: Environment;
  html: string;
  requestedAction?: string;
  platformHint?: string;
  omitAxTree?: boolean;
  allowedJourneyIds?: string[];
};

export async function runAudit(input: RunAuditInput) {
  const requestedAction = input.requestedAction ?? 'navigate';
  const platform = resolvePlatformMetadata({
    html: input.html,
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
      allowedDomains: ['app.example.com'],
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

  if (!isActionAllowed(input.environment, requestedAction)) {
    throw new Error('Action is not allowed by environment policy.');
  }

  const artifacts: {
    screenshotPath: string;
    domSnapshotPath: string;
    axTreePath?: string;
  } = {
    screenshotPath: 'artifacts/dashboard.png',
    domSnapshotPath: 'artifacts/dashboard.html',
  };

  if (!input.omitAxTree) {
    artifacts.axTreePath = 'artifacts/dashboard.ax.json';
  }

  const evidence = createEvidenceBundle({
    page: {
      url: 'https://app.example.com/dashboard',
      route: '/dashboard',
      title: 'Dashboard',
    },
    run: {
      journeyId: input.journeyId,
      stepId: 'dashboard',
      environment: input.environment,
    },
    artifacts,
  });

  const deterministicFindings =
    evidence.status === 'complete' ? runDeterministicAudit({ html: input.html }) : [];

  const advisoryCandidate = createAiAdvisoryFinding({
    message: 'Review instructions and labels for screen-reader clarity.',
    confidence: 0.84,
  });
  const aiFindings =
    advisoryCandidate.confidence >= contract.confidencePolicy.minReport
      ? [advisoryCandidate]
      : [];

  const findings = [...deterministicFindings, ...aiFindings];

  if (evidence.status !== 'complete' && contract.failureMode === 'stop') {
    throw new Error('Run stopped due to incomplete evidence under failureMode=stop.');
  }

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
    ...report,
  };
}
