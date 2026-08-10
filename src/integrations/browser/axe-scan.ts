import { AxeBuilder } from '@axe-core/playwright';
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

export async function scanPageWithAxe(page: Page): Promise<AxeScanResult> {
  const results = await new AxeBuilder({ page }).analyze();

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
