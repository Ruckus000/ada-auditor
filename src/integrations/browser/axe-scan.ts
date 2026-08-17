import { AxeBuilder } from '@axe-core/playwright';
import axe from 'axe-core';
import type { Page } from 'playwright-core';
import type {
  AxeCheckResult,
  AxeNodeResult,
  AxeRuleResult,
  AxeScanResult,
} from '../../services/deterministic-audit';

/**
 * Runs axe-core against a live page and narrows the result to plain data.
 *
 * The narrowing is the point: `services/deterministic-audit.ts` maps this
 * shape into findings and must not import Playwright or axe-core. Everything
 * framework-shaped stops here.
 *
 * axe is injected into every frame at scan time, so a target site with a
 * strict `script-src` CSP will block it. The browser context is created with
 * `bypassCSP: true` (see `journey-runner.ts`) for exactly that reason.
 */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Narrows axe's `CheckResult[]` to the two fields that cross the boundary. */
function normalizeChecks(value: unknown): AxeCheckResult[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => asRecord(entry))
    .map((check) => ({ id: asString(check.id), message: asString(check.message) }))
    .filter((check) => check.message !== '');
}

function normalizeNode(value: unknown): AxeNodeResult {
  const node = asRecord(value);
  const target = Array.isArray(node.target)
    ? node.target.filter(
        (entry): entry is string | string[] =>
          typeof entry === 'string' ||
          (Array.isArray(entry) && entry.every((part) => typeof part === 'string')),
      )
    : [];

  return {
    html: asString(node.html),
    target,
    failureSummary:
      typeof node.failureSummary === 'string' ? node.failureSummary : undefined,
    any: normalizeChecks(node.any),
    all: normalizeChecks(node.all),
    none: normalizeChecks(node.none),
  };
}

function normalizeRule(value: unknown): AxeRuleResult {
  const rule = asRecord(value);
  const id = asString(rule.id);

  return {
    id,
    impact:
      rule.impact === 'critical' ||
      rule.impact === 'serious' ||
      rule.impact === 'moderate' ||
      rule.impact === 'minor'
        ? rule.impact
        : null,
    tags: Array.isArray(rule.tags)
      ? rule.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    help: asString(rule.help, id),
    helpUrl: asString(rule.helpUrl),
    nodes: Array.isArray(rule.nodes) ? rule.nodes.map(normalizeNode) : [],
  };
}

/**
 * Rules axe ships switched off that this product needs switched on.
 *
 * Nine of axe's 105 rules carry `enabled: false`. Eight are deprecated,
 * obsolete or AAA and are rightly off. One is neither.
 *
 * **`target-size` is WCAG 2.2 AA — success criterion 2.5.8, Target Size
 * (Minimum) — and it was never running.** Not failing: absent. A scan reported
 * it in none of the four buckets, because a disabled rule is not evaluated at
 * all. Meanwhile `conformanceLevelFromTags` maps `wcag22aa`, `wcag-reference`
 * lists 2.5.8 as AA, and a client's report could therefore never contain a
 * 2.5.8 finding while saying nothing about not having looked.
 *
 * That is this product's signature failure living inside the scanner: a clean
 * result that means "we did not check", presented as "we checked and it is
 * fine". Found by measuring a fixture whose buttons are 44×18 — comfortably
 * under the 24×24 minimum — and getting back zero violations.
 *
 * Exported so `RUN_RULESET` can name it and the regression guard can tell runs
 * apart across a change to this list.
 */
export const ENABLED_BY_US = ['target-size'] as const;

/**
 * What the engine was, for a run that wants to say so.
 *
 * Changing the rule set changes what a run can find, which means the next run
 * after a change reports findings that are new to *us* rather than new to the
 * client's site. Diffed against the previous baseline they read as a
 * regression on a site nobody touched.
 *
 * Derived rather than hand-maintained. A constant somebody has to remember to
 * bump is a constant somebody forgets, and the two things that actually decide
 * the rule set — the engine's version and the rules we override — are both
 * facts available here.
 */
export const RUN_RULESET = `axe-core@${axe.version}+${[...ENABLED_BY_US].sort().join(',')}`;

export async function scanPageWithAxe(page: Page): Promise<AxeScanResult> {
  const results = await new AxeBuilder({ page })
    .options({
      rules: Object.fromEntries(ENABLED_BY_US.map((rule) => [rule, { enabled: true }])),
    })
    .analyze();

  return {
    violations: results.violations.map(normalizeRule),
    incomplete: results.incomplete.map(normalizeRule),
    // Only the count crosses the boundary. axe reports every passing node, and
    // on a real page that is megabytes of DOM nobody reads — but without the
    // number there is no denominator, and the conformance score had nothing to
    // divide by.
    passCount: results.passes.reduce((total, rule) => total + rule.nodes.length, 0),
  };
}
