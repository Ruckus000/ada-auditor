import { createRunContract } from '../../domain/contracts';
import { createEvidenceBundle, worstEvidenceStatus } from '../../domain/evidence';
import { createPlatformContext } from '../../domain/platforms';
import { resolvePlatformMetadata } from '../platforms';
import { requestAiAdvisory, type AdvisoryCall } from '../../services/ai-advisory';
import { runDeterministicAudit } from '../../services/deterministic-audit';
import { runHtmlcsAudit } from '../../services/htmlcs-audit';
import { runPageChecks } from '../../services/page-checks';
import { summarizeRun } from '../../services/reporting';
import { scoreRun } from '../../services/score';
import { buildDefaultDemoJourneySteps, runJourney } from './journey-runner';
import { RUN_RULESET } from './axe-scan';
import { PartialAuditError, PartialJourneyError, type AuditedPage } from './partial-run';
import type { JourneyRunnerInput, JourneyStep, PageAudit } from './types';

export type RunBrowserAuditInput = Omit<JourneyRunnerInput, 'steps' | 'skipScan'> & {
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
  advisoryCall?: AdvisoryCall;
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
  /**
   * Evidence is per page. A page whose artifacts are incomplete has its
   * deterministic findings rejected, and drags the whole run to
   * `inconclusive` — the steady-state rule, applied across the page dimension.
   *
   * A local function rather than a top-level one because it needs the run's
   * identity, and rather than two copies because the failure path has to judge
   * a partial run's pages by exactly the same rule as the success path. Two
   * copies is how a partial run comes to report evidence a complete one would
   * have refused.
   */
  const auditPages = (captured: PageAudit[]): AuditedPage[] =>
    captured.map((pageAudit) => {
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
            ? [
                ...runDeterministicAudit(pageAudit.axe, pageAudit.page.url),
                // The checks axe structurally cannot make, over the same
                // completeness gate: findings only from proven evidence.
                ...runPageChecks(pageAudit.facts, pageAudit.page.url),
                // The second opinion. Needs-review only — it can never gate —
                // and already stripped of what axe reported on the same
                // element and criterion (see `axeCriteria` on the scan seam).
                ...runHtmlcsAudit(pageAudit.htmlcs, pageAudit.page.url),
              ]
            : [],
        // Counted here so a partial run carries them too. Computed on the
        // success path alone, every page of a failed run persisted null
        // counts — the upload reads `checks`, and nothing ever set it.
        checks: {
          passed: pageAudit.axe.passCount,
          failed: pageAudit.axe.violations.reduce((total, rule) => total + rule.nodes.length, 0),
          incomplete: pageAudit.axe.incomplete.reduce(
            (total, rule) => total + rule.nodes.length,
            0,
          ),
        },
      };
    });

  // The target's own host, plus anything the journey named. A union rather
  // than a replacement: `allowedHosts` means "and also these", so an operator
  // who lists their identity provider cannot lock the run out of the site it
  // is auditing by forgetting to list that too.
  const allowedHosts = [
    ...(input.targetUrl ? [new URL(input.targetUrl).hostname] : []),
    ...(input.allowedHosts ?? []),
  ];

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

  // Before the browser, not after it. This sat below `runJourney`, so a
  // journey outside the run's scope was fully walked and only then refused —
  // and once a failure could carry pages out, an out-of-scope partial run
  // could have stored them. It needs nothing the walk produces.
  const journeyIds = input.allowedJourneyIds ?? [input.journeyId];
  if (!journeyIds.includes(input.journeyId)) {
    throw new Error('Journey is not allowed by run contract scope.');
  }

  const journeyStartedAt = Date.now();
  let journeyResult;
  try {
    // An audit never skips its scan; the preview calls `runJourney` directly.
    journeyResult = await runJourney({ ...input, skipScan: undefined, allowedHosts, steps });
  } catch (error) {
    // The second place a partial run lost its work. `runJourney` carries what
    // it captured out on the error; this turns those raw captures into the
    // same audited shape the success path produces, so `executeRun` can store
    // and upload them with the code it already has. The error is rethrown
    // unchanged in every respect the classifier reads.
    if (error instanceof PartialJourneyError) {
      throw new PartialAuditError(
        error,
        auditPages(error.captured.pages),
        error.captured.truncatedPages,
        {
          truncationReason: error.captured.truncationReason,
          // The one phase that was running when this threw, and the only one
          // this layer can honestly name. The handler adds the upload it goes
          // on to do.
          phaseMs: { journey: Date.now() - journeyStartedAt },
        },
      );
    }
    throw error;
  }
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

  const auditedPages = auditPages(journeyResult.pages);

  const evidenceStatus = worstEvidenceStatus(auditedPages.map((p) => p.evidenceStatus));

  // A conformance rate over the checks axe actually evaluated. Withheld
  // entirely when evidence is incomplete — see `services/score.ts`.
  const checkCounts = auditedPages.map((pageAudit) => pageAudit.checks);
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
    call: input.advisoryCall,
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
    /**
     * Which engine and rule set produced the findings, for the same reason
     * `steps` is here: the handler records it onto the run and must not
     * recompute it. Reaching for it directly would drag `@axe-core/playwright`
     * into the request layer, which is the boundary this file exists to hold.
     */
    ruleset: RUN_RULESET,
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
    // Which bound did it. Absent means the walk covered its journey.
    ...(journeyResult.truncationReason
      ? { truncationReason: journeyResult.truncationReason }
      : {}),
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
