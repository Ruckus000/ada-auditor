/**
 * Maps raw axe-core results into deterministic findings.
 *
 * This module deliberately imports nothing from Playwright or axe-core. The
 * scan itself lives at `integrations/browser/axe-scan.ts`; only its plain-data
 * output crosses into services. That keeps the architecture boundary intact
 * (framework at the edges) and — practically — keeps this mapping in the fast
 * unit suite, since `vitest.config.ts` excludes `tests/integrations/browser/**`.
 */

export type FindingSeverity = 'critical' | 'major' | 'minor' | 'needs-review';

export type DeterministicFinding = {
  /** axe rule id, e.g. `image-alt`. The stable identity of a finding. */
  code: string;
  severity: FindingSeverity;
  /**
   * What the rule checks, in axe's own words: "Images must have alternate
   * text".
   *
   * Quoted, never authored. It used to be a fallback inside `message` and so
   * was only ever seen when a node had no failure summary — which meant the
   * readable half of a finding disappeared exactly when the technical half
   * was longest. `message` says what went wrong with *this* node; this says
   * what the rule is.
   */
  title: string;
  message: string;
  /**
   * How to fix it, in axe's words.
   *
   * Quoted from the per-check messages rather than authored, and split the way
   * axe evaluates them: any **one** entry in `anyOf` clears the node, every
   * entry in `allOf` has to be done.
   */
  remediation: Remediation;
  source: 'deterministic';
  /** WCAG success criteria, e.g. `['1.1.1']`. Empty for best-practice rules. */
  wcagCriteria: string[];
  /** Strictest level the rule maps to, or null for best-practice rules. */
  conformanceLevel: ConformanceLevel | null;
  /**
   * URL of the page this finding was found on.
   *
   * A run walks several pages, so a finding that cannot say where it lives is
   * not actionable: two pages can break the same rule on the same selector and
   * need two separate fixes. This is also part of the regression key — see
   * `findingKey` in `services/regression.ts`.
   */
  pageUrl: string;
  /** CSS selector locating the offending node. */
  selector: string;
  /** Truncated outerHTML of the offending node. UNTRUSTED — escape on render. */
  htmlSnippet: string;
  helpUrl: string;
};

export type Remediation = {
  /** Fix any one of these. */
  anyOf: string[];
  /** Fix all of these. */
  allOf: string[];
};

export type ConformanceLevel = 'A' | 'AA' | 'AAA';

export type AxeImpact = 'minor' | 'moderate' | 'serious' | 'critical';

/** One check axe ran against a node, and what it says about the result. */
export type AxeCheckResult = {
  id: string;
  message: string;
};

export type AxeNodeResult = {
  html: string;
  /** Nested arrays occur when the node lives inside an iframe. */
  target: Array<string | string[]>;
  failureSummary?: string;
  /**
   * axe's three check groups, which carry the remediation.
   *
   * The distinction between them is load-bearing and is exactly what gets lost
   * when `failureSummary` is treated as one blob of prose: `any` is satisfied
   * by fixing **one** of its entries (an image needs alt *or* aria-label *or*
   * role="presentation"), while `all` and `none` each have to be satisfied in
   * full. Telling a developer to do all three when one will do is how a fix
   * list stops being trusted.
   */
  any?: AxeCheckResult[];
  all?: AxeCheckResult[];
  none?: AxeCheckResult[];
};

export type AxeRuleResult = {
  id: string;
  impact?: AxeImpact | null;
  tags: string[];
  help: string;
  helpUrl: string;
  nodes: AxeNodeResult[];
};

export type AxeScanResult = {
  violations: AxeRuleResult[];
  /** Rules axe could not decide — the manual-review worklist. */
  incomplete: AxeRuleResult[];
  /**
   * How many rule checks the page satisfied.
   *
   * A count rather than the nodes: the score needs a denominator, and axe's
   * full `passes` array on a real page is megabytes that nothing would read.
   * Optional because runs recorded before this existed have no value for it,
   * and those must score as "not measured" rather than as zero.
   */
  passCount?: number;
};

/**
 * Bounds what a single finding can contribute to storage and to the report.
 * axe returns full outerHTML, which on a real page is routinely kilobytes.
 */
const MAX_SNIPPET_LENGTH = 512;

/**
 * axe impact is a 4-point scale; ours is 3 plus a manual-review bucket.
 * `serious` collapsing to `major` matters: it keeps high-volume rules like
 * color-contrast out of the CI-blocking set, preserving the existing
 * steady-state rule that only `critical` fails a run.
 */
const SEVERITY_BY_IMPACT: Record<AxeImpact, FindingSeverity> = {
  critical: 'critical',
  serious: 'major',
  moderate: 'minor',
  minor: 'minor',
};

/**
 * Matches a success-criterion tag: `wcag111` -> 1.1.1, `wcag1412` -> 1.4.12.
 * The trailing group is `\d+` because criteria numbers reach double digits.
 */
const CRITERION_TAG = /^wcag(\d)(\d)(\d+)$/;

/**
 * Matches a conformance-level tag: `wcag2a`, `wcag21aa`, `wcag22aa`.
 * Anchored so `wcag2a-obsolete` (a real axe tag) does not match, and so
 * criterion tags like `wcag111` cannot be mistaken for a level.
 */
const LEVEL_TAG = /^wcag(\d+)(a{1,3})$/;

const LEVEL_RANK: Record<ConformanceLevel, number> = { A: 0, AA: 1, AAA: 2 };

export function wcagCriteriaFromTags(tags: string[]): string[] {
  const criteria = new Set<string>();

  for (const tag of tags) {
    const match = CRITERION_TAG.exec(tag);
    if (match) {
      criteria.add(`${match[1]}.${match[2]}.${match[3]}`);
    }
  }

  return [...criteria].sort();
}

/**
 * A rule can map to several criteria at different levels. We report the
 * strictest (lowest) one, because that is the bar the page actually fails.
 */
export function conformanceLevelFromTags(tags: string[]): ConformanceLevel | null {
  let level: ConformanceLevel | null = null;

  for (const tag of tags) {
    const match = LEVEL_TAG.exec(tag);
    if (!match) {
      continue;
    }

    const candidate = match[2].toUpperCase() as ConformanceLevel;
    if (level === null || LEVEL_RANK[candidate] < LEVEL_RANK[level]) {
      level = candidate;
    }
  }

  return level;
}

/** Flattens axe's frame-aware target shape into one readable selector. */
export function selectorFromTarget(target: Array<string | string[]>): string {
  return target
    .map((entry) => (Array.isArray(entry) ? entry.join(' ') : entry))
    .join(' >>> ');
}

function truncate(html: string): string {
  const collapsed = html.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_SNIPPET_LENGTH
    ? `${collapsed.slice(0, MAX_SNIPPET_LENGTH)}…`
    : collapsed;
}

function toFindings(
  rules: AxeRuleResult[],
  pageUrl: string,
  severityFor: (rule: AxeRuleResult) => FindingSeverity,
): DeterministicFinding[] {
  const findings: DeterministicFinding[] = [];

  for (const rule of rules) {
    const wcagCriteria = wcagCriteriaFromTags(rule.tags);
    const conformanceLevel = conformanceLevelFromTags(rule.tags);
    const severity = severityFor(rule);

    // One finding per node, not per rule. Ten broken images are ten findings
    // a developer can act on, each with its own selector.
    for (const node of rule.nodes) {
      findings.push({
        code: rule.id,
        severity,
        title: rule.help,
        message: node.failureSummary?.trim() || rule.help,
        remediation: remediationFor(node),
        source: 'deterministic',
        wcagCriteria,
        conformanceLevel,
        pageUrl,
        selector: selectorFromTarget(node.target),
        htmlSnippet: truncate(node.html),
        helpUrl: rule.helpUrl,
      });
    }
  }

  return findings;
}

/**
 * The fix list for one node.
 *
 * `none` joins `allOf` rather than getting a group of its own: axe's own
 * summary presents them together, and "this must not be true" and "this must
 * be true" are both things a developer has to do something about, unlike the
 * pick-one semantics of `any`.
 *
 * Deduplicated, because a node can fail two checks that say the same sentence,
 * and a fix list that repeats itself reads as though there are more things to
 * do than there are.
 */
function remediationFor(node: AxeNodeResult): Remediation {
  const messages = (checks: AxeCheckResult[] | undefined): string[] => {
    const seen = new Set<string>();
    for (const check of checks ?? []) {
      const message = check.message?.trim();
      if (message) seen.add(message);
    }
    return [...seen];
  };

  const anyOf = messages(node.any);
  const allOf = [...new Set([...messages(node.all), ...messages(node.none)])];

  return { anyOf, allOf };
}

/**
 * Maps one page's scan. A run calls this once per page it walked through and
 * concatenates the results, so `pageUrl` is what keeps them apart afterwards.
 */
export function runDeterministicAudit(
  input: AxeScanResult,
  pageUrl: string,
): DeterministicFinding[] {
  return [
    ...toFindings(input.violations, pageUrl, (rule) =>
      rule.impact ? SEVERITY_BY_IMPACT[rule.impact] : 'minor',
    ),
    // axe could not reach a verdict on these, so they are never a failure —
    // they are the queue a human auditor works through.
    ...toFindings(input.incomplete, pageUrl, () => 'needs-review'),
  ];
}
