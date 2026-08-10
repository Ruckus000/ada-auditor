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

export type { TriageState };

export type DisplaySeverity = 'must' | 'should' | 'nice' | 'review' | 'advisory';

/**
 * `critical` is the only severity that blocks a run, which is why it is the
 * only one that maps to `must`. `serious` already collapses to `major` further
 * upstream (see `SEVERITY_BY_IMPACT` in `deterministic-audit.ts`) so that
 * high-volume rules like colour-contrast cannot gate CI.
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

/** Severities that count toward the blocking total and the score. */
export function countsTowardScore(severity: DisplaySeverity): boolean {
  return severity === 'must' || severity === 'should' || severity === 'nice';
}

/**
 * How a finding is presented in the triage list.
 *
 * Derived, never stored. `fixed` in particular is *observable* — a finding is
 * fixed when the next run stops reporting it — so storing it as human state
 * invites the stored flag and the evidence to disagree, and when they disagree
 * the evidence is right.
 */
export type FindingDisplayStatus = 'Open' | 'Assigned' | 'Dismissed' | 'Fixed' | 'Retest due';

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
  // A dismissal outranks everything: an operator has said this is not a
  // barrier, and a later run re-reporting it must not quietly undo that.
  if (input.triage === 'dismissed' || input.triage === 'accepted-risk') {
    return 'Dismissed';
  }

  if (!input.inLatestRun) {
    // Gone from the latest run. That is what "fixed" means here — observed,
    // not asserted.
    return 'Fixed';
  }

  if (input.triage === 'assigned') {
    return 'Assigned';
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
