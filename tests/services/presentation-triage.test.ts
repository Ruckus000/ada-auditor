import { describe, expect, it } from 'vitest';
import type { TriageState } from '../../src/domain/platform';
import {
  TRIAGE_DECISIONS,
  triageNotePrompt,
  triageStateLabel,
} from '../../src/services/presentation/triage';

/**
 * Every member of `TriageState`, written out once.
 *
 * The declaration inside the first case is what keeps this honest: `Exclude`
 * leaves a state that is missing from the list behind, and nothing but `never`
 * is assignable to `never[]`, so a fourth member stops the suite typechecking
 * instead of quietly narrowing what the enumeration covers.
 */
const ALL_STATES = ['dismissed', 'accepted-risk', 'assigned'] as const;

describe('triageStateLabel', () => {
  it('names every state the store can hold', () => {
    const unlisted: Exclude<TriageState, (typeof ALL_STATES)[number]>[] = [];
    expect(unlisted).toEqual([]);

    for (const state of ALL_STATES) {
      expect(triageStateLabel(state)).not.toBe('');
    }
  });

  it('does not call an accepted risk a dismissal', () => {
    // The whole defect this module exists to remove: `accepted-risk` has been
    // in the type, the enum and the CHECK since Phase 2C, and every consumer
    // was a two-way ternary that filed it under the other word. An operator
    // who accepted a barrier read that they had said it was not one.
    expect(triageStateLabel('accepted-risk')).not.toBe(triageStateLabel('dismissed'));
    expect(triageStateLabel('accepted-risk')).toBe('Accepted risk');
    expect(triageStateLabel('dismissed')).toBe('Dismissed');
  });

  it('keeps the assignment word the screens already use', () => {
    expect(triageStateLabel('assigned')).toBe('Assigned');
  });
});

describe('TRIAGE_DECISIONS', () => {
  it('offers the two decisions this control is for, and not assignment', () => {
    // `assigned` is `AssignControl`'s decision — it needs a person, not a
    // note — so offering it here would be a second way to do one thing.
    expect(TRIAGE_DECISIONS.map((decision) => decision.state)).toEqual([
      'dismissed',
      'accepted-risk',
    ]);
  });

  it('gives each decision its own words', () => {
    const labels = TRIAGE_DECISIONS.map((decision) => decision.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('triageNotePrompt', () => {
  it('asks a different question of each decision', () => {
    // Not cosmetic. "Why is this not a barrier?" answered about an accepted
    // risk produces a note that contradicts the state stored beside it, and
    // the note is the record an auditor defends later.
    expect(triageNotePrompt('dismissed')).not.toBe(triageNotePrompt('accepted-risk'));
  });

  it('asks who accepted a barrier, and on what basis', () => {
    expect(triageNotePrompt('accepted-risk')).toBe(
      'Who accepted this barrier, and on what basis?',
    );
  });

  it('asks why a dismissal is not a barrier', () => {
    expect(triageNotePrompt('dismissed')).toBe('Why is this not a barrier?');
  });
});
