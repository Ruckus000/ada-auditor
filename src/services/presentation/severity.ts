/**
 * Engine severity and triage state, translated for the screens.
 *
 * The prototype collapsed five engine severities into three display buckets
 * (`must | should | nice`). That collapse is not kept, because both of the
 * homeless severities mean something the product already promises elsewhere:
 *
 * - `needs-review` is the human-review worklist — the entire point of
 *   `runDeterministicAudit`'s `incomplete` branch. Folded into `nice` it
 *   becomes a low-priority bucket nobody works, and the queue silently
 *   disappears.
 * - `advisory` is always `gateable: false`. Folded into any severity, the
 *   screen would show it gating while the data says it does not.
 */

import type { TriageState } from '../../domain/platform';
import type { DeterministicFinding } from '../deterministic-audit';
import { GATE_VERSION, failsConformance } from '../reporting';
import type { VerdictFinding } from './verdict';

export type DisplaySeverity = 'must' | 'should' | 'nice' | 'review' | 'advisory';

/**
 * Display buckets by axe impact — how bad a finding is to hit, which is the
 * order a remediation list is worked in. This is not the gate: whether a
 * finding fails the audit is decided by the success criterion it cites
 * (`failsConformance` in `reporting.ts`), and a `minor` finding can fail it
 * while a `critical` best-practice rule cannot. `serious` already collapses
 * to `major` further upstream (see `SEVERITY_BY_IMPACT` in
 * `deterministic-audit.ts`).
 */
const DISPLAY_BY_SEVERITY: Record<string, DisplaySeverity> = {
  critical: 'must',
  major: 'should',
  minor: 'nice',
  'needs-review': 'review',
  advisory: 'advisory',
};

export function displaySeverity(severity: string): DisplaySeverity {
  // An unknown severity becomes `review` rather than `nice`: a finding we
  // cannot categorise needs a human to look at it, and quietly filing it as
  // low-priority is how it never gets looked at.
  return DISPLAY_BY_SEVERITY[severity] ?? 'review';
}

/**
 * How a finding is presented in the triage list.
 *
 * Derived, never stored. `fixed` in particular is *observable* — a finding is
 * fixed when the next run stops reporting it — so storing it as human state
 * invites the stored flag and the evidence to disagree, and when they disagree
 * the evidence is right.
 */
export type FindingDisplayStatus =
  | 'Open'
  | 'Assigned'
  | 'Dismissed'
  | 'Accepted risk'
  | 'Fixed'
  | 'Retest due';

/**
 * What each stored decision looks like on a row, and whether it survives the
 * evidence changing under it.
 *
 * A `Record` rather than the ternaries this used to be. `accepted-risk` sat in
 * the type, the zod enum and the SQL CHECK for three slices with no control
 * able to produce it, so a two-way branch over a three-member union read as
 * correct while quietly filing an accepted barrier as a dismissal. Written
 * this way the compiler is what notices the next member.
 *
 * The words are spelled again here rather than taken from
 * `presentation/triage.ts`: that module names a *decision* an operator makes,
 * this one names a *row's status*, and the two vocabularies only happen to
 * agree on three of their entries.
 *
 * `outranksARerun` is the older rule, unchanged: an operator has settled the
 * finding, and a later run re-reporting it must not undo that. Assignment is
 * not a settlement — it is a plan, and absence is evidence that beats it.
 */
const TRIAGE_DISPLAY: Record<
  TriageState,
  { status: FindingDisplayStatus; outranksARerun: boolean }
> = {
  dismissed: { status: 'Dismissed', outranksARerun: true },
  'accepted-risk': { status: 'Accepted risk', outranksARerun: true },
  assigned: { status: 'Assigned', outranksARerun: false },
};

export function findingDisplayStatus(input: {
  inLatestRun: boolean;
  /** Present in the run being compared against. */
  inBaseline: boolean;
  /**
   * Observed, then gone, and now back.
   *
   * This cannot be inferred from the two flags above: "absent from the
   * baseline" describes a brand-new finding and a returning one identically.
   * Guessing from two booleans labelled every finding on a client's first-ever
   * audit "Retest due" — telling an operator a fix had regressed when nothing
   * had ever been fixed. A caller that only holds two runs passes `false` and
   * gets `Open`, which is true rather than merely unalarming.
   */
  previouslyFixed?: boolean;
  triage: TriageState | null;
}): FindingDisplayStatus {
  const decided = input.triage === null ? null : TRIAGE_DISPLAY[input.triage];

  // A settled finding outranks everything: an operator has said this is not a
  // barrier, or that it is one the client accepts, and a later run
  // re-reporting it must not quietly undo either decision.
  if (decided?.outranksARerun) {
    return decided.status;
  }

  if (!input.inLatestRun) {
    // Gone from the latest run. That is what "fixed" means here — observed,
    // not asserted.
    return 'Fixed';
  }

  if (decided) {
    return decided.status;
  }

  // Only a finding known to have been fixed once is a retest — that is a
  // regression, and it deserves a different word from a backlog item. Anything
  // else present in the latest run is simply open, including a finding seen
  // for the first time.
  return input.previouslyFixed ? 'Retest due' : 'Open';
}

/** Whether a stored finding is one the engine proved rather than judged. */
export function isDeterministic(finding: Pick<DeterministicFinding, 'source'>): boolean {
  return finding.source === 'deterministic';
}

/**
 * What a run's findings amount to, in the words the screens use.
 *
 * One helper rather than the filter each screen used to write for itself.
 * `portfolio.ts` and `client-detail.ts` both counted with identical inline
 * predicates, and `client-detail`'s copy is what the client's shared report
 * renders — so the two could drift and the divergence would show up on the
 * document sent outside, which is the one place this repo has already been
 * bitten (see `report-html.ts` keying its copy on `ciStatus`).
 *
 * **`confirmed` is a claim the gate made, counted through the gate.** It was
 * once counted by impact (critical + major) here while the printable report
 * and the verdict counted by criterion, and the two disagree on real
 * documents: `meta-viewport` is impact moderate and cites wcag2aa, so a client
 * page read "0" directly above a list of failed criteria. Where the gate made
 * no claim there is nothing to count, and `confirmed` is **null**, rendered as
 * a dash the way `scoreStatValue` renders an unscored run:
 *
 * - an **inconclusive** run — `summarizeRun` reports `blockingFindings: 0`
 *   there by design, and a number here would be the second definition again;
 * - a run **an earlier gate decided**, or one from before `gate_version` was
 *   stored — recounting it with today's rule puts a number beside a verdict
 *   that number did not produce.
 *
 * `recommendations` is the complement — deterministic, decided, and not a
 * conformance failure — so a critical best-practice rule and an AAA finding
 * land there, honestly. It is null whenever `confirmed` is, for the same
 * reason.
 *
 * **`needsReview` is the number that was missing.** Both callers reported the
 * decided buckets and stopped, which was tolerable while the only source of
 * `needs-review` was axe's handful of undecided checks. HTML_CodeSniffer made
 * it the largest bucket by an order of magnitude — 130 of 139 findings on a
 * fixture site — and a summary that omits it describes a different audit from
 * the one that ran. It is counted on every run, because a review queue is
 * work whether or not the gate reached a verdict.
 *
 * Advisory findings are excluded here, as they are from every count that could
 * be read as work owed: they are `gateable: false`, and `advisoryFindings` in
 * `summarizeRun` already reports them under their own name.
 */
export function severityCounts(run: {
  /** `pass | fail | inconclusive` from `summarizeRun`. */
  ciStatus: string;
  /** Absent on rows written before the column existed. */
  gateVersion?: number | null;
  findings: readonly VerdictFinding[];
}): {
  confirmed: number | null;
  recommendations: number | null;
  needsReview: number;
} {
  const decided = run.ciStatus !== 'inconclusive' && run.gateVersion === GATE_VERSION;
  let confirmed = 0;
  let recommendations = 0;
  let needsReview = 0;

  for (const finding of run.findings) {
    if (finding.source !== 'deterministic') continue;

    if (displaySeverity(finding.severity) === 'review') {
      needsReview += 1;
    } else if (failsConformance(finding)) {
      confirmed += 1;
    } else {
      recommendations += 1;
    }
  }

  return decided
    ? { confirmed, recommendations, needsReview }
    : { confirmed: null, recommendations: null, needsReview };
}
