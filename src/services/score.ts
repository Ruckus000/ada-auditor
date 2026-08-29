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
 * **Every number in that sentence is a count of axe *checks*, including the
 * last one.** `needsReview` here is `sum(pages, 'incomplete')`, and it is not
 * the size of the human-review queue: HTML_CodeSniffer contributes no check
 * counts at all and emits findings that are all `needs-review`, so the queue
 * an operator works is `executiveSummary.needsReviewFindings` in
 * `services/reporting.ts`. Reporting this one as the queue understated it
 * sixty-five-fold on a fixture run. Both are honest about what they count;
 * only the checks belong in the sentence above, because only they share its
 * denominator.
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

/**
 * Bumped when the formula changes, so old runs are not silently reinterpreted.
 *
 * 2 — 100 is reserved for a run with no failing check; a rounded 100 with
 * failures present is reported as 99.
 */
export const SCORE_VERSION = 2;

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
  // A perfect score has to mean no failing check.
  //
  // Rounding alone does not guarantee that: a real run of 15 violations
  // against thousands of node-level checks came out at 99.6%, and the report
  // printed `score 100` beside a `fail` verdict and fifteen listed
  // violations. Whichever of those a reader believes, the document
  // contradicts itself, and it is a document written for a client's counsel.
  // 100 is now reserved for a run that failed nothing.
  const score =
    input.evidenceStatus !== 'complete' || evaluated === 0
      ? null
      : capBelowPerfect(Math.round((100 * passed) / evaluated), failed);

  return { score, scoreVersion: SCORE_VERSION, passed, failed, needsReview };
}

function capBelowPerfect(rounded: number, failed: number): number {
  return failed > 0 ? Math.min(rounded, 99) : rounded;
}
