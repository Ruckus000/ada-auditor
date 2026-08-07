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
  message: string;
  source: 'deterministic';
  /** WCAG success criteria, e.g. `['1.1.1']`. Empty for best-practice rules. */
  wcagCriteria: string[];
  /** Strictest level the rule maps to, or null for best-practice rules. */
  conformanceLevel: ConformanceLevel | null;
  /** CSS selector locating the offending node. */
  selector: string;
  /** Truncated outerHTML of the offending node. UNTRUSTED — escape on render. */
  htmlSnippet: string;
  helpUrl: string;
};

export type ConformanceLevel = 'A' | 'AA' | 'AAA';

export type AxeImpact = 'minor' | 'moderate' | 'serious' | 'critical';

export type AxeNodeResult = {
  html: string;
  /** Nested arrays occur when the node lives inside an iframe. */
  target: Array<string | string[]>;
  failureSummary?: string;
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
        message: node.failureSummary?.trim() || rule.help,
        source: 'deterministic',
        wcagCriteria,
        conformanceLevel,
        selector: selectorFromTarget(node.target),
        htmlSnippet: truncate(node.html),
        helpUrl: rule.helpUrl,
      });
    }
  }

  return findings;
}

export function runDeterministicAudit(input: AxeScanResult): DeterministicFinding[] {
  return [
    ...toFindings(input.violations, (rule) =>
      rule.impact ? SEVERITY_BY_IMPACT[rule.impact] : 'minor',
    ),
    // axe could not reach a verdict on these, so they are never a failure —
    // they are the queue a human auditor works through.
    ...toFindings(input.incomplete, () => 'needs-review'),
  ];
}
