import type { RunStatus } from '../../domain/persistence';

/**
 * Translates what the engine measured into what a screen says.
 *
 * This is a business rule, not presentation garnish, which is why it lives in
 * `services` rather than beside the components. It decides whether the product
 * tells a client "pass" or "we could not tell" — and the first steady-state
 * rule in `AGENTS.md` is that incomplete evidence is never `pass` and never
 * `fail`. A mapping that loses that distinction is a correctness regression
 * wearing a cosmetic disguise.
 */

/**
 * The verdicts a screen can show.
 *
 * `inconclusive` is new. The prototype had four — `fail | risk | pass | scan`
 * — and every one of them is a false statement about a run whose evidence was
 * incomplete: `pass` is forbidden outright, `fail` asserts violations nobody
 * observed, `risk` asserts a judgement about the site when the judgement was
 * about our own evidence, and `scan` says the run is still going when it
 * finished. "We could not tell" is a first-class outcome for an auditor, not a
 * degraded rendering of a real one.
 */
export type VerdictKind = 'fail' | 'risk' | 'pass' | 'scan' | 'inconclusive';

/** Just enough of a finding to reach a verdict. */
export type VerdictFinding = {
  severity: string;
  source: string;
};

export type VerdictInput = {
  /** Run lifecycle, which is orthogonal to the verdict. */
  status?: RunStatus | string;
  /** `pass | fail | inconclusive` from `summarizeRun`. */
  ciStatus: string;
  findings: readonly VerdictFinding[];
};

/**
 * Only deterministic findings can influence a verdict.
 *
 * Advisory findings are always `gateable: false` — a judgement, not a proof.
 * Letting one tip a run from `pass` to `risk` would gate a release on a model's
 * opinion, which is exactly the rule the advisory pass was built to respect.
 */
function isDeterministic(finding: VerdictFinding): boolean {
  return finding.source === 'deterministic';
}

/**
 * The verdict for a run.
 *
 * Precedence is the whole correctness content of this function, so it is
 * written as an ordered sequence rather than a lookup:
 *
 * 1. A run still going is `scan`, whatever its partial results say.
 * 2. A run that crashed is `inconclusive` — it produced no judgement, and
 *    reporting the absence of findings as `pass` would invert the truth.
 * 3. Incomplete evidence is `inconclusive`. The steady-state rule.
 * 4. Blocking findings are `fail`.
 * 5. Otherwise `risk` if anything still needs attention, else `pass`.
 */
export function runVerdict(input: VerdictInput): VerdictKind {
  if (input.status === 'running') {
    return 'scan';
  }

  if (input.status === 'failed') {
    return 'inconclusive';
  }

  if (input.ciStatus === 'inconclusive') {
    return 'inconclusive';
  }

  if (input.ciStatus === 'fail') {
    return 'fail';
  }

  // `risk` has no engine equivalent because it is not an engine concept: it is
  // "nothing blocking, but not clean". Defined here rather than left to float,
  // and deliberately computed downstream of `ciStatus` so it can never be
  // produced from an inconclusive run.
  const deterministic = input.findings.filter(isDeterministic);
  const unresolved = deterministic.some(
    (finding) => finding.severity === 'major' || finding.severity === 'needs-review',
  );

  return unresolved ? 'risk' : 'pass';
}

/**
 * How a score is said, everywhere one is said.
 *
 * `[V]` The blind test measured the defect this exists to fix: every planted
 * site scored 97–98 while failing, and a bare "98" beside `fail` is the
 * number a client quotes back. The score is a rate over the automated checks
 * axe evaluated — undecided checks excluded, advisory findings excluded — and
 * `services/score.ts` documents why that is the defensible construction. What
 * was missing was the label saying so at the point of reading.
 *
 * One label, one formatter, one explainer, exported from the same seam as the
 * verdict so no surface hand-builds its own phrasing — the steady-state rule
 * that exists because keying report copy off a locally-invented rendering
 * once made the client's document disagree with every operator screen.
 */
export const SCORE_STAT_LABEL = 'Checks passed';

/** `98` → `98%`; null → an em dash, because an unscored run did not score badly. */
export function scoreStatValue(score: number | null | undefined): string {
  return score === null || score === undefined ? '—' : `${score}%`;
}

/** The inline form, for status lines: `98% checks passed` / `not scored`. */
export function scoreLine(score: number | null | undefined): string {
  return score === null || score === undefined ? 'not scored' : `${score}% checks passed`;
}

/**
 * The denominator in words. Rendered wherever there is room for a sentence,
 * and always subordinate to the verdict.
 */
export const SCORE_EXPLAINER =
  'The percentage is the share of evaluated automated checks that passed — checks needing human review are excluded. The verdict above is decided by blocking findings, not by this rate.';
