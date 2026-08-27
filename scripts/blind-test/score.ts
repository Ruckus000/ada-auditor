/**
 * Scoring for the blind test: what the fixture sites hide, against what a run
 * actually reported.
 *
 * Pure, and in its own module rather than inside `run.ts`, because
 * `scripts/*` entry points call `main()` at import — the trap `AGENTS.md`
 * records after `migrate.ts` was imported for one helper and migrated the real
 * database on every local `npm test`. The entry point is `run.ts`; everything
 * here is data in, verdicts out, and `tests/scripts/blind-test-score.test.ts`
 * holds it to that.
 *
 * The vocabulary is deliberately not `pass`/`fail`. A blind test asks a
 * different question from an audit: not "does this site conform" but "did the
 * auditor see what is there". So an expectation the run reported through a
 * *different* mechanism than predicted (a violation where we expected the
 * human-review queue, or the reverse) is neither a hit nor a miss — it is
 * recorded as what it is, because that difference is the finding.
 */

/** What we planted, and which half of the product should notice it. */
export type Expectation = {
  id: string;
  /** File name of the page, e.g. `index.html`. Matched against a finding's `pageUrl`. */
  page: string;
  /**
   * CSS selector for the offending element.
   *
   * An `#id` selector matches when axe names that id anywhere in its selector
   * path, because axe reports a path whenever the bare id is not the whole
   * story: `#contrast-on-photo > p` is a finding inside that element and
   * counts for it.
   *
   * As a whole id, though, never as a substring of a longer one. `#stat-uptime`
   * and `#stat-uptime-note` are different elements sitting in the same card,
   * and Kestrel's answer key predicts a different rule for each; a substring
   * test credited the heading expectation with the caption's contrast failure.
   * An expectation that can be satisfied by the element next to it is not
   * measuring anything.
   *
   * Anything else is matched exactly — `html` must not match `html > body > p`.
   */
  selector: string;
  what: string;
  criterion: string;
  level: 'A' | 'AA';
  /**
   * Which mechanism should surface this.
   *
   * - `deterministic` — an axe violation
   * - `needs-review`  — axe reaches no verdict; the human-review queue
   * - `judgement`     — no rule can decide it; the AI advisory pass or nobody
   * - `clean`         — correctly built, and must not be reported at all
   */
  expect: 'deterministic' | 'needs-review' | 'judgement' | 'clean';
  /** axe rule id, when we predict a specific one. */
  axeRule?: string;
  /** Text an advisory finding would have to contain to count as having seen it. */
  cue?: string;
  /**
   * `core` — behaviour the product claims; a miss is a gap.
   * `probe` — an open question we are asking on purpose; a miss is data.
   */
  weight: 'core' | 'probe';
  note?: string;
};

/** The subset of `DeterministicFinding` scoring needs. */
export type ScoredFinding = {
  code: string;
  severity: 'critical' | 'major' | 'minor' | 'needs-review';
  selector: string;
  pageUrl: string;
  wcagCriteria: string[];
  conformanceLevel: 'A' | 'AA' | 'AAA' | null;
};

export type Outcome =
  /** Reported, by the mechanism predicted. */
  | 'hit'
  /** Not reported by anything. */
  | 'miss'
  /** Predicted a violation; got the human-review queue instead. */
  | 'downgraded'
  /** Predicted the human-review queue; got a decided violation. Better than asked. */
  | 'upgraded'
  /** Predicted no rule could decide it, and one did. Better than asked. */
  | 'caught-by-rules'
  /** Correctly built and correctly left alone. */
  | 'clean-pass'
  /** Correctly built and reported anyway. */
  | 'false-positive';

export type ExpectationResult = {
  expectation: Expectation;
  outcome: Outcome;
  /** Rule ids that matched this element, in report order. */
  matchedRules: string[];
  /** Advisory sentences that mentioned it. */
  matchedAdvisory: string[];
  /**
   * Whether the rule we predicted is among the ones that fired.
   *
   * Reported separately because "something was said about this element" and
   * "the barrier was identified" are different claims, and conflating them
   * flatters the tool. A broken skip link that surfaces only because the link
   * sits outside a landmark has been noticed for the wrong reason: the
   * operator reading `region` is not told the bypass is broken. `false` here
   * with a non-empty `matchedRules` is exactly that case.
   */
  predictedRuleFired: boolean | null;
};

export type SiteScore = {
  site: string;
  results: ExpectationResult[];
  /**
   * Deterministic findings that matched no expectation, grouped by rule.
   *
   * Not called false positives: a fixture author is not the authority on what
   * is wrong with their own page, and axe finding something we did not plant
   * is as likely to be a real defect as noise. They are listed so a human can
   * decide which.
   */
  unexpected: Array<{ code: string; severity: string; count: number; pages: string[] }>;
  counts: Record<Outcome, number>;
};

const pageOf = (pageUrl: string): string => pageUrl.split('/').pop() ?? pageUrl;

/**
 * Every id axe named in a selector path, as whole ids.
 *
 * `#contrast-on-photo > p` → `['#contrast-on-photo']`, and
 * `#stat-uptime-note` → `['#stat-uptime-note']` rather than also answering to
 * `#stat-uptime`. An id runs to the first character CSS will not accept in
 * one, which is what makes the boundary a boundary.
 */
const idsIn = (selector: string): string[] => selector.match(/#[\w-]+/g) ?? [];

function matches(expectation: Expectation, finding: ScoredFinding): boolean {
  if (pageOf(finding.pageUrl) !== expectation.page) return false;

  if (expectation.selector.startsWith('#')) {
    return idsIn(finding.selector).includes(expectation.selector);
  }

  // A non-id selector is matched exactly, or by rule when we named one —
  // `meta-refresh` reports `meta[http-equiv="refresh"]`, which no fixture can
  // predict as a string.
  return (
    finding.selector === expectation.selector ||
    (expectation.axeRule !== undefined && finding.code === expectation.axeRule)
  );
}

function advisoryMentions(expectation: Expectation, advisory: string[]): string[] {
  const cues = [expectation.cue, expectation.selector.replace(/^#/, '')].filter(
    (cue): cue is string => Boolean(cue),
  );

  return advisory.filter((sentence) => {
    const haystack = sentence.toLowerCase();
    return cues.some((cue) => haystack.includes(cue.toLowerCase()));
  });
}

function outcomeFor(
  expectation: Expectation,
  matched: ScoredFinding[],
  matchedAdvisory: string[],
): Outcome {
  const decided = matched.filter((finding) => finding.severity !== 'needs-review');
  const undecided = matched.filter((finding) => finding.severity === 'needs-review');

  switch (expectation.expect) {
    case 'deterministic':
      if (decided.length > 0) return 'hit';
      if (undecided.length > 0) return 'downgraded';
      return 'miss';
    case 'needs-review':
      if (undecided.length > 0) return 'hit';
      if (decided.length > 0) return 'upgraded';
      return 'miss';
    case 'judgement':
      if (matchedAdvisory.length > 0) return 'hit';
      if (matched.length > 0) return 'caught-by-rules';
      return 'miss';
    case 'clean':
      return matched.length > 0 ? 'false-positive' : 'clean-pass';
  }
}

const EMPTY_COUNTS: Record<Outcome, number> = {
  hit: 0,
  miss: 0,
  downgraded: 0,
  upgraded: 0,
  'caught-by-rules': 0,
  'clean-pass': 0,
  'false-positive': 0,
};

export function scoreSite(input: {
  site: string;
  expectations: Expectation[];
  findings: ScoredFinding[];
  advisory: string[];
}): SiteScore {
  const claimed = new Set<ScoredFinding>();

  const results = input.expectations.map((expectation) => {
    const matched = input.findings.filter((finding) => matches(expectation, finding));
    matched.forEach((finding) => claimed.add(finding));

    const matchedAdvisory = advisoryMentions(expectation, input.advisory);

    return {
      expectation,
      outcome: outcomeFor(expectation, matched, matchedAdvisory),
      matchedRules: matched.map((finding) => finding.code),
      matchedAdvisory,
      predictedRuleFired:
        expectation.axeRule === undefined
          ? null
          : matched.some((finding) => finding.code === expectation.axeRule),
    };
  });

  const unclaimed = input.findings.filter((finding) => !claimed.has(finding));
  const byRule = new Map<string, { code: string; severity: string; count: number; pages: Set<string> }>();

  for (const finding of unclaimed) {
    const key = `${finding.code}:${finding.severity}`;
    const row = byRule.get(key) ?? {
      code: finding.code,
      severity: finding.severity,
      count: 0,
      pages: new Set<string>(),
    };
    row.count += 1;
    row.pages.add(pageOf(finding.pageUrl));
    byRule.set(key, row);
  }

  const counts = { ...EMPTY_COUNTS };
  for (const result of results) counts[result.outcome] += 1;

  return {
    site: input.site,
    results,
    unexpected: [...byRule.values()]
      .map((row) => ({ code: row.code, severity: row.severity, count: row.count, pages: [...row.pages] }))
      .sort((a, b) => b.count - a.count),
    counts,
  };
}

/**
 * What became of the core barriers — the rows the product claims behaviour for.
 *
 * `clean` rows are excluded, because a correctly built element correctly left
 * alone is not a barrier anything noticed. Counting them flattered every site
 * and flattered a bad tool most: with three of Ridgeline's fifteen core rows
 * `clean`, an auditor that detected nothing whatsoever still scored 3/15
 * rather than zero, and adding more `clean` rows — which the false-positive
 * guard wants — would have raised the number without improving detection.
 * `probe` rows stay out for the reason they always did: they are open
 * questions, not behaviour the product claims.
 *
 * All four counts come from here rather than two functions over one
 * population, so `seen + missed + downgraded === total` holds by construction
 * and a reader can add the parts and get the whole. The summary line used to
 * pair this fraction with a miss count taken over *every* row, so Fairview
 * printed `4/8 seen · 5 missed` — a subtraction that does not work, because
 * that 5 counted two `probe` rows and skipped a core barrier that was
 * downgraded rather than missed.
 *
 * A barrier can only be seen, missed or downgraded: `clean-pass` and
 * `false-positive` are outcomes of `clean` rows, which are not here.
 */
export function coreBarrierOutcomes(score: SiteScore): {
  seen: number;
  total: number;
  missed: number;
  downgraded: number;
} {
  const barriers = score.results.filter(
    (result) => result.expectation.weight === 'core' && result.expectation.expect !== 'clean',
  );
  const count = (outcomes: Outcome[]) =>
    barriers.filter((result) => outcomes.includes(result.outcome)).length;

  return {
    seen: count(['hit', 'upgraded', 'caught-by-rules']),
    total: barriers.length,
    missed: count(['miss']),
    downgraded: count(['downgraded']),
  };
}

/**
 * Clean rows left alone, over clean rows planted — the other measurement, kept
 * apart from the first rather than folded into it.
 *
 * Every `clean` row counts regardless of weight: whether the tool invents
 * findings is not a question about which behaviours the product claims, so the
 * `core`/`probe` split does not apply to it.
 */
export function cleanRate(score: SiteScore): { quiet: number; total: number } {
  const clean = score.results.filter((result) => result.expectation.expect === 'clean');

  return {
    quiet: clean.filter((result) => result.outcome === 'clean-pass').length,
    total: clean.length,
  };
}
