import { createRunContract } from '../../domain/contracts';
import { createEvidenceBundle, worstEvidenceStatus } from '../../domain/evidence';
import { createPlatformContext } from '../../domain/platforms';
import { resolvePlatformMetadata } from '../platforms';
import type Anthropic from '@anthropic-ai/sdk';
import { requestAiAdvisory } from '../../services/ai-advisory';
import { runDeterministicAudit } from '../../services/deterministic-audit';
import { summarizeRun } from '../../services/reporting';
import { scoreRun } from '../../services/score';
import { buildDefaultDemoJourneySteps, runJourney } from './journey-runner';
import type { JourneyRunnerInput, JourneyStep } from './types';

export type RunBrowserAuditInput = Omit<JourneyRunnerInput, 'steps'> & {
  /**
   * Optional *here* and required on `JourneyRunnerInput`, which is the whole
   * invariant: this is the only layer allowed to be handed no steps, and the
   * only one that decides what that means — the fixture journey when there is
   * no target to walk, a refusal when there is.
   */
  steps?: JourneyStep[];
  platformHint?: string;
  allowedJourneyIds?: string[];
  /** Injected in tests so the advisory pass never reaches the network. */
  anthropicClient?: Anthropic;
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

  // The built-in demo is a *fixture* journey: its paths only mean something
  // against `fixtureDir`. Substituting it for a run that names a real target
  // resolved those paths against the client's origin instead — an audit of
  // whatever `https://their-site/login.html` happens to return, filed under
  // their name. A caller that names a target and no steps has not described a
  // journey, so say so rather than inventing one.
  if (input.targetUrl && !input.steps?.length) {
    throw new Error('A run against a target URL must name its own steps.');
  }

  // Resolved once and returned below, not recomputed by the caller. On the
  // fixture path the default is substituted here, so this is the only place
  // that knows what the run was actually asked to walk.
  const steps = input.steps ?? buildDefaultDemoJourneySteps();

  const journeyStartedAt = Date.now();
  const journeyResult = await runJourney({
    ...input,
    allowedHosts,
    steps,
  });
  const journeyMs = Date.now() - journeyStartedAt;

  // Platform is a property of the site, not of a page, so it is detected once
  // from the journey's entry point rather than re-litigated on every page.
  const platform = resolvePlatformMetadata({
    html: journeyResult.pages[0]?.html ?? '',
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

  // Evidence is per page. A page whose artifacts are incomplete has its
  // deterministic findings rejected, and drags the whole run to `inconclusive`
  // — the steady-state rule, unchanged, now applied across the page dimension.
  const auditedPages = journeyResult.pages.map((pageAudit) => {
    const evidence = createEvidenceBundle({
      page: pageAudit.page,
      run: {
        journeyId: input.journeyId,
        stepId: input.stepId,
        environment: input.environment,
      },
      artifacts: pageAudit.artifacts,
    });

    return {
      ...pageAudit,
      evidenceStatus: evidence.status,
      findings:
        evidence.status === 'complete'
          ? runDeterministicAudit(pageAudit.axe, pageAudit.page.url)
          : [],
    };
  });

  const evidenceStatus = worstEvidenceStatus(auditedPages.map((p) => p.evidenceStatus));

  // A conformance rate over the checks axe actually evaluated. Withheld
  // entirely when evidence is incomplete — see `services/score.ts`.
  const checkCounts = auditedPages.map((pageAudit) => ({
    passed: pageAudit.axe.passCount,
    failed: pageAudit.axe.violations.reduce((total, rule) => total + rule.nodes.length, 0),
    incomplete: pageAudit.axe.incomplete.reduce((total, rule) => total + rule.nodes.length, 0),
  }));
  const score = scoreRun({ pages: checkCounts, evidenceStatus });
  const deterministicFindings = auditedPages.flatMap((p) => p.findings);

  // One call for the whole journey, not one per page: N× the cost otherwise,
  // and issues that only exist across pages — navigation named differently on
  // different screens, heading structure drifting — need the aggregate to be
  // visible at all.
  //
  // Independent of the deterministic result, per the steady-state rule: the
  // advisory is not a commentary on what the rules found, and never gates.
  const advisoryStartedAt = Date.now();
  const aiFindings = await requestAiAdvisory({
    pages: journeyResult.pages.map((pageAudit) => ({
      page: pageAudit.page,
      axTree: pageAudit.axTree,
      axe: pageAudit.axe,
    })),
    minConfidence: contract.confidencePolicy.minReport,
    client: input.anthropicClient,
  });
  const advisoryMs = Date.now() - advisoryStartedAt;

  const findings = [...deterministicFindings, ...aiFindings];
  const report = summarizeRun({
    findings,
    evidenceStatus,
    pagesScanned: auditedPages.length,
    pagesTruncated: journeyResult.truncatedPages,
  });

  return {
    journeyId: input.journeyId,
    environment: input.environment,
    /** What the run was asked to walk. Recorded onto the run by the handler. */
    steps,
    evidenceStatus,
    findings,
    platform,
    contract,
    pages: auditedPages.map((pageAudit, index) => ({
      page: pageAudit.page,
      pageKey: pageAudit.pageKey,
      evidenceStatus: pageAudit.evidenceStatus,
      artifacts: pageAudit.artifacts,
      checks: checkCounts[index],
      timing: pageAudit.timing,
    })),
    truncatedPages: journeyResult.truncatedPages,
    // Where the run went. The browser work and the advisory call are the two
    // things that can plausibly grow past the function limit, so they are
    // timed apart rather than rolled into one number.
    phaseMs: { journey: journeyMs, advisory: advisoryMs },
    score: score.score,
    scoreVersion: score.scoreVersion,
    checksPassed: score.passed,
    checksFailed: score.failed,
    checksNeedingReview: score.needsReview,
    ...report,
  };
}
