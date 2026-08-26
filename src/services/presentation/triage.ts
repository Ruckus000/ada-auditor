/**
 * Human triage decisions, translated for the screens.
 *
 * Here rather than beside the components for the reason the rest of
 * `presentation/` is: what the product *calls* a decision is a business rule
 * with a record behind it, and a copy edit in a component must not be able to
 * change what an operator reads back about a barrier they accepted.
 *
 * Every mapping below is a `Record<TriageState, …>` and never a ternary. That
 * is the defect this module was written to remove: `accepted-risk` had been in
 * the type, the zod enum and the SQL CHECK since Phase 2C with no control able
 * to produce it, so three consumers branched two ways over a three-member
 * union and an accepted barrier rendered and logged as "dismissed". A `Record`
 * makes the compiler the thing that notices the next member.
 *
 * The activity feed's wording is deliberately *not* here — it stays in the
 * triage route, because an append-only audit record must not be re-worded by a
 * UI copy edit.
 */

import type { TriageState } from '../../domain/platform';

const LABEL: Record<TriageState, string> = {
  dismissed: 'Dismissed',
  'accepted-risk': 'Accepted risk',
  assigned: 'Assigned',
};

/** What the screens call a stored decision. */
export function triageStateLabel(state: TriageState): string {
  return LABEL[state];
}

/**
 * The states this control decides between.
 *
 * `assigned` is excluded because it is `AssignControl`'s decision: it needs a
 * person and no note, where these two need a note and no person. Written as an
 * `Exclude` so a state added to `TriageState` lands here by default — being
 * offered to an operator is the safe direction, and being silently undecidable
 * is not.
 */
export type TriageDecisionState = Exclude<TriageState, 'assigned'>;

const NOTE_PROMPT: Record<TriageDecisionState, string> = {
  dismissed: 'Why is this not a barrier?',
  'accepted-risk': 'Who accepted this barrier, and on what basis?',
};

/**
 * The question the required note answers, which is not the same question for
 * both states. Asking "why is this not a barrier?" about an accepted risk
 * produces a note that contradicts the state stored next to it.
 */
export function triageNotePrompt(state: TriageDecisionState): string {
  return NOTE_PROMPT[state];
}

export type TriageDecision = {
  state: TriageDecisionState;
  /** The radio's own label. */
  label: string;
};

/**
 * The decisions the triage control offers, in the order it offers them.
 *
 * "Not a barrier" first, because it is the ordinary case; neither is
 * pre-selected, since defaulting to either would put a decision in an
 * operator's mouth.
 */
export const TRIAGE_DECISIONS: readonly TriageDecision[] = [
  { state: 'dismissed', label: 'Not a barrier' },
  { state: 'accepted-risk', label: 'A barrier the client accepts' },
];
