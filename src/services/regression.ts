import type { StoredFinding, StoredRunRecord } from '../domain/persistence';
import { gateDecided } from './presentation/severity';
import { failsConformance } from './reporting';

export type RegressionStatus = 'none' | 'warn' | 'fail' | 'incomparable';

/**
 * Why no comparison was made.
 *
 * Present only on `incomparable`, and present because the screen has to say
 * something true: "the last run walked a different path" is a good sentence
 * and a false explanation for a run that walked the right path and could not
 * see it. Two causes, two sentences, chosen by the side that knows.
 */
export type IncomparableReason = 'different-path' | 'partial-run';

export type RegressionSummary = {
  status: RegressionStatus;
  reason?: IncomparableReason;
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
  // `Array.isArray`, not just a truthy `intent`. `{steps: undefined}` is a
  // truthy object that survives `JSON.stringify` as `{}` and therefore stores
  // and reads back as a real intent — and then `undefined === undefined`
  // compares two of them as *equal*, which is the false all-clear this guard
  // exists to refuse, arriving through the guard itself. `steps` is `unknown[]`
  // off a jsonb column with no validation between here and the database, so
  // its shape is checked rather than assumed.
  if (!Array.isArray(a.intent?.steps) || !Array.isArray(b.intent?.steps)) return false;
  if (JSON.stringify(a.intent.steps) !== JSON.stringify(b.intent.steps)) return false;

  // And the same rule set, because the same path scanned by a different engine
  // is not the same measurement. Enabling a rule axe ships switched off — as
  // `target-size` was, leaving WCAG 2.5.8 mapped, listed as AA and never
  // evaluated — makes the next run surface findings that are new to *us*
  // rather than new to the client's site. Presented as a diff they read as a
  // regression on a site nobody touched: the mirror image of the false
  // all-clear this function was written to refuse, and the reason an axe-core
  // upgrade has always been able to produce one unnoticed.
  //
  // `undefined === undefined` is deliberately allowed here and would be a bug
  // three lines above. For `steps`, absent means *not recorded*, so two
  // absents must never read as agreement. For `ruleset`, two absents are two
  // runs from before this was recorded — which really were scanned by the same
  // rule set, because there was only one. What must not compare equal is a run
  // that recorded one against a run that did not.
  return a.intent.ruleset === b.intent.ruleset;
}

/**
 * Whether a run saw everything it walked.
 *
 * Two doors, and both empty the finding set rather than qualify it:
 *
 * - A page whose artifacts are incomplete has its deterministic findings
 *   **rejected** — `runBrowserAudit` gives it `findings: []` — so the page's
 *   barriers are absent from the record, indistinguishable from fixed.
 * - The page cap or the time budget can stop the walk short, and a page never
 *   visited reports nothing for the same reason. `truncated_pages` is stored
 *   precisely so "a partial audit must never read as a complete one"; this is
 *   the reading that would otherwise break that promise. It has never fired
 *   in stored history — the chaos suite is where it fires — so this half is
 *   here for the invariant, not for an incident.
 *
 * `inconclusive` on its own is deliberately *not* the test. A run can be
 * inconclusive for reasons that leave the finding set whole, and refusing
 * those would withhold a diff that is perfectly sound.
 */
function sawTheWholePath(run: StoredRunRecord): boolean {
  return run.evidenceStatus === 'complete' && (run.truncatedPages ?? 0) === 0;
}

export function compareToBaseline(
  current: StoredRunRecord,
  baseline: StoredRunRecord,
): RegressionSummary {
  const withhold = (reason: IncomparableReason): RegressionSummary => ({
    status: 'incomparable',
    reason,
    baselineRequestId: baseline.requestId,
    newFindings: [],
    resolvedFindings: [],
    unchangedCount: 0,
  });
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
    return withhold('different-path');
  }

  /**
   * And each of them has to have seen the path it walked.
   *
   * The guard above asks what the two runs were *asked* to do. This one asks
   * what they managed — because a page whose findings were rejected is a page
   * whose barriers are missing from the record, and the diff cannot tell that
   * from fixed. A baseline that could not see is the mirror case: its missing
   * findings read as new, sending a client after a change nobody made.
   */
  if (!sawTheWholePath(current) || !sawTheWholePath(baseline)) {
    return withhold('partial-run');
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

  /**
   * "Worse" is the gate's word, so it is the gate's decision.
   *
   * This read `severity === 'critical'`, which is axe's impact rating and not
   * what fails a run. The two invert on findings this repo keeps fixtures for:
   * `meta-viewport` is impact moderate — so `minor` — and cites a Level AA
   * criterion, so it is what turns a verdict to FAIL while reading as the
   * milder finding; `region` is rated critical and cites nothing, so it can
   * never fail a run. Keyed on impact, the block announced "slightly worse"
   * above a card reading "Blocks release", and "worse — a new critical issue
   * appeared" above one reading "Does not block release".
   *
   * The expression is `FindingCard`'s `blocks` verbatim, which is the point:
   * the headline and the badges under it are one rule, not two that agree
   * today. Only the current run's gate is consulted, and only about findings
   * the current run reported — the baseline's gate version cannot reach this.
   * Where that gate reached no verdict nothing is a conformance failure, so an
   * older run's diff says `warn`, which claims only that findings appeared.
   */
  const decided = gateDecided(current);
  const brokeConformance = newFindings.some((finding) => decided && failsConformance(finding));

  let status: RegressionStatus = 'none';
  if (brokeConformance) {
    status = 'fail';
  } else if (newFindings.length > 0) {
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
