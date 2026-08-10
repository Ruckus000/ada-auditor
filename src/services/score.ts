import type { EvidenceStatus } from '../domain/evidence';

/**
 * A run's conformance score.
 *
 * A rate over the checks that were actually evaluated:
 *
 *     score = round(100 × passed / (passed + failed))
 *
 * Every term is a count of something a machine did, which is the point. The
 * tempting alternative — `100 − (10×critical + 3×major + …)` — has weights
 * nobody can justify to a client's counsel and scales with site size rather
 * than site quality. This produces a sentence that survives being read back
 * to you: "we evaluated 412 automated checks across 8 pages; 389 passed, 23
 * failed, and 17 could not be decided automatically."
 *
 * Three rules make it defensible, and each is a steady-state claim the product
 * already makes elsewhere:
 *
 * 1. **Undecided checks are in neither term.** axe's `incomplete` results are
 *    the human-review queue, and the UI already promises they are "excluded
 *    from the score rather than counted as passing".
 * 2. **AI advisory findings never touch it.** They are `gateable: false`, and
 *    a score is a gate.
 * 3. **Incomplete evidence scores `null`, not zero.** The denominator is
 *    unknown when a page failed to yield artifacts, and printing a number
 *    would assert a measurement nobody made. This is the same rule that makes
 *    such a run `inconclusive` rather than `pass` or `fail`.
 */

/** Bumped when the formula changes, so old runs are not silently reinterpreted. */
export const SCORE_VERSION = 1;

export type PageCheckCounts = {
  /** Rules axe evaluated and the page satisfied. */
  passed?: number;
  /** Rules axe evaluated and the page violated. */
  failed?: number;
  /** Rules axe could not decide. Counted in neither term. */
  incomplete?: number;
};

export type ScoreInput = {
  pages: readonly PageCheckCounts[];
  evidenceStatus: EvidenceStatus;
};

export type RunScore = {
  /** 0–100, or null when the run cannot be scored. */
  score: number | null;
  scoreVersion: number;
  passed: number;
  failed: number;
  /** Reported alongside the score, never inside it. */
  needsReview: number;
};

function sum(pages: readonly PageCheckCounts[], key: keyof PageCheckCounts): number {
  return pages.reduce((total, page) => total + (page[key] ?? 0), 0);
}

export function scoreRun(input: ScoreInput): RunScore {
  const passed = sum(input.pages, 'passed');
  const failed = sum(input.pages, 'failed');
  const needsReview = sum(input.pages, 'incomplete');

  const evaluated = passed + failed;

  // No score without complete evidence, and no score without a denominator.
  // The second case covers a run whose pages predate check counting, which
  // must read as "not measured" rather than as zero.
  const score =
    input.evidenceStatus !== 'complete' || evaluated === 0
      ? null
      : Math.round((100 * passed) / evaluated);

  return { score, scoreVersion: SCORE_VERSION, passed, failed, needsReview };
}

/**
 * The change since the previous run, or null when either end is unscored.
 *
 * A delta against a run that could not be scored is not zero — it is unknown,
 * and the screens render it as an em dash rather than as "no change".
 */
export function scoreDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) {
    return null;
  }
  return current - previous;
}
