import { describe, expect, it } from 'vitest';
import { SCORE_VERSION, scoreRun } from '../../src/services/score';

describe('scoreRun', () => {
  it('is a rate over the checks actually evaluated', () => {
    const result = scoreRun({
      pages: [{ passed: 90, failed: 10 }],
      evidenceStatus: 'complete',
    });

    expect(result.score).toBe(90);
    expect(result.passed).toBe(90);
    expect(result.failed).toBe(10);
  });

  it('sums across every page of a journey', () => {
    const result = scoreRun({
      pages: [
        { passed: 40, failed: 10 },
        { passed: 60, failed: 40 },
      ],
      evidenceStatus: 'complete',
    });

    // 100 of 150 passed.
    expect(result.score).toBe(67);
  });

  it('keeps undecided checks out of both terms', () => {
    // axe's `incomplete` results are the human-review queue. Counting them as
    // passes would inflate the score; counting them as failures would punish a
    // site for something nobody has judged yet. The product already tells
    // clients they are excluded rather than counted as passing.
    const withReview = scoreRun({
      pages: [{ passed: 90, failed: 10, incomplete: 50 }],
      evidenceStatus: 'complete',
    });

    expect(withReview.score).toBe(90);
    expect(withReview.needsReview).toBe(50);
  });

  it('withholds a score when evidence is incomplete', () => {
    // The denominator is unknown when a page failed to yield artifacts, and a
    // number would assert a measurement nobody made. Same rule that makes such
    // a run inconclusive rather than pass or fail.
    const result = scoreRun({
      pages: [{ passed: 90, failed: 10 }],
      evidenceStatus: 'degraded',
    });

    expect(result.score).toBeNull();
    // The counts are still reported — only the verdict-shaped number is held back.
    expect(result.passed).toBe(90);
  });

  it('withholds a score when nothing was evaluated', () => {
    // Covers runs recorded before check counting existed. "Not measured" must
    // not read as zero, which is the worst possible score.
    expect(scoreRun({ pages: [], evidenceStatus: 'complete' }).score).toBeNull();
    expect(
      scoreRun({ pages: [{ incomplete: 12 }], evidenceStatus: 'complete' }).score,
    ).toBeNull();
  });

  it('scores a flawless run 100 and a hopeless one 0', () => {
    expect(scoreRun({ pages: [{ passed: 50, failed: 0 }], evidenceStatus: 'complete' }).score).toBe(
      100,
    );
    expect(scoreRun({ pages: [{ passed: 0, failed: 50 }], evidenceStatus: 'complete' }).score).toBe(
      0,
    );
  });

  it('stamps the formula version', () => {
    // A score is a claim in a client report. Changing how it is computed must
    // not silently reinterpret every historical run.
    expect(scoreRun({ pages: [], evidenceStatus: 'complete' }).scoreVersion).toBe(SCORE_VERSION);
  });

  it('tolerates pages missing counts entirely', () => {
    const result = scoreRun({
      pages: [{ passed: 10, failed: 10 }, {}],
      evidenceStatus: 'complete',
    });

    expect(result.score).toBe(50);
  });
});
