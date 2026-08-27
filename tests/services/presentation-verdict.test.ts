import { describe, expect, it } from 'vitest';
import {
  SCORE_EXPLAINER,
  SCORE_STAT_LABEL,
  scoreLine,
  scoreStatValue,
  runVerdict,
  type VerdictFinding,
} from '../../src/services/presentation/verdict';

function deterministic(severity: string): VerdictFinding {
  return { severity, source: 'deterministic' };
}

const ADVISORY: VerdictFinding = { severity: 'advisory', source: 'ai-advisory' };

describe('runVerdict', () => {
  it('reports a run still in flight as scanning, whatever its partial results say', () => {
    expect(
      runVerdict({
        status: 'running',
        ciStatus: 'fail',
        findings: [deterministic('critical')],
      }),
    ).toBe('scan');
  });

  it('reports a crashed run as inconclusive, not as a pass', () => {
    // A failed run produced no judgement. Reading its empty findings list as
    // "nothing wrong" inverts the truth.
    expect(runVerdict({ status: 'failed', ciStatus: 'inconclusive', findings: [] })).toBe(
      'inconclusive',
    );
  });

  it('never turns incomplete evidence into a verdict', () => {
    // The first steady-state rule in AGENTS.md. Incomplete evidence is never
    // pass and never fail — including when the findings would have failed it.
    expect(
      runVerdict({
        status: 'complete',
        ciStatus: 'inconclusive',
        findings: [deterministic('critical')],
      }),
    ).toBe('inconclusive');

    expect(runVerdict({ status: 'complete', ciStatus: 'inconclusive', findings: [] })).toBe(
      'inconclusive',
    );
  });

  it('fails a run with blocking findings', () => {
    expect(
      runVerdict({
        status: 'complete',
        ciStatus: 'fail',
        findings: [deterministic('critical')],
      }),
    ).toBe('fail');
  });

  it('passes a clean run', () => {
    expect(runVerdict({ status: 'complete', ciStatus: 'pass', findings: [] })).toBe('pass');
  });

  it.each(['major', 'needs-review'])(
    'reports nothing-blocking-but-not-clean as risk when a %s finding is open',
    (severity) => {
      expect(
        runVerdict({
          status: 'complete',
          ciStatus: 'pass',
          findings: [deterministic(severity)],
        }),
      ).toBe('risk');
    },
  );

  it('does not let a minor finding downgrade a pass', () => {
    expect(
      runVerdict({ status: 'complete', ciStatus: 'pass', findings: [deterministic('minor')] }),
    ).toBe('pass');
  });

  it('never lets an advisory finding change the verdict', () => {
    // Advisory findings are always gateable: false. Letting one tip a run from
    // pass to risk would gate a release on a model's opinion.
    expect(runVerdict({ status: 'complete', ciStatus: 'pass', findings: [ADVISORY] })).toBe(
      'pass',
    );
  });

  it('cannot produce risk from an inconclusive run', () => {
    // `risk` is computed downstream of ciStatus on purpose. If precedence ever
    // inverted, an unjudgeable run would start rendering as a judgement.
    expect(
      runVerdict({
        status: 'complete',
        ciStatus: 'inconclusive',
        findings: [deterministic('major')],
      }),
    ).toBe('inconclusive');
  });

  it('does not require a status', () => {
    // Records written before `status` existed still have to render.
    expect(runVerdict({ ciStatus: 'pass', findings: [] })).toBe('pass');
  });
});

describe('score copy', () => {
  it('always says what the number is a rate of', () => {
    expect(SCORE_STAT_LABEL).toBe('Checks passed');
    expect(scoreStatValue(98)).toBe('98%');
    expect(scoreLine(98)).toBe('98% checks passed');
  });

  it('an unscored run is an em dash, never a zero or a percentage', () => {
    expect(scoreStatValue(null)).toBe('—');
    expect(scoreStatValue(undefined)).toBe('—');
    expect(scoreLine(null)).toBe('not scored');
  });

  it('the explainer subordinates the rate to the verdict', () => {
    // The defect this copy exists to fix: 97-98 beside `fail` on every
    // planted blind-test site, correct by definition and quoted as a grade.
    expect(SCORE_EXPLAINER).toContain('automated checks');
    expect(SCORE_EXPLAINER).toContain('blocking findings');
  });
});
