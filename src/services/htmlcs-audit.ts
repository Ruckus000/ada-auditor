/**
 * Maps HTML_CodeSniffer results into needs-review findings.
 *
 * HTMLCS is the second opinion, not a second gate. It evaluates against WCAG
 * *techniques* (H37, G73, F65 …) rather than axe's rule set, so it surfaces
 * material axe structurally does not — and its warnings are explicitly "a
 * human must look at this". Everything it emits therefore lands at severity
 * `needs-review`, which `failsConformance` (services/reporting.ts) can never
 * gate on. Promoting HTMLCS errors to gating, should the blind test ever earn
 * them that trust, is a one-line severity change here — not a redesign.
 *
 * Like `deterministic-audit.ts`, this module imports nothing from Playwright
 * or HTMLCS itself. The scan lives at `integrations/browser/htmlcs-scan.ts`;
 * only its plain-data output crosses into services, which keeps this mapping
 * in the fast unit suite.
 *
 * Like `page-checks.ts`, these findings never touch the score: the score
 * remains a rate over axe-evaluated checks, and HTMLCS has no pass-count
 * semantics to contribute a denominator with.
 */

import type { ConformanceLevel, DeterministicFinding } from './deterministic-audit';
import { lookupCriterion, normaliseCriterion } from './wcag-reference';

export type HtmlcsLevel = 'error' | 'warning' | 'notice';

/** One HTMLCS message, narrowed to plain data at the scan seam. */
export type HtmlcsMessage = {
  level: HtmlcsLevel;
  /** Full dotted code, e.g. `WCAG2AA.Principle1.Guideline1_1.1_1_1.H37`. */
  code: string;
  /** HTMLCS's own text. Quoted, never authored. */
  message: string;
  /** CSS path to the node; empty when the message is about the document. */
  selector: string;
  /** Truncated outerHTML. UNTRUSTED — escape on render. */
  htmlSnippet: string;
  /**
   * WCAG criteria axe already reported on this same element, e.g. `['1.1.1']`.
   *
   * Established in the page, by element identity, because it cannot be
   * established here: axe and the HTMLCS runner write selectors in different
   * shapes for the same node (`img[src="logo.png"]` vs
   * `body > img:nth-of-type(2)`), so comparing selector strings would be
   * suppression that never fires. The scan resolves axe's selectors back to
   * elements and records which of its criteria landed on the element each
   * HTMLCS message is about; this module only has to believe the overlap,
   * not compute it.
   */
  axeCriteria: string[];
};

/**
 * `unavailable` means the second opinion is missing, not that the run is
 * degraded: HTMLCS never gates, so its absence cannot invalidate a verdict.
 * The scan logs the reason; this module just produces zero findings.
 */
export type HtmlcsScanResult =
  | { status: 'ok'; messages: HtmlcsMessage[] }
  | { status: 'unavailable' };

/** Matches `deterministic-audit.ts` — one bound for what a finding may carry. */
const MAX_SNIPPET_LENGTH = 512;

/**
 * Where a WCAG technique's write-up lives, by code prefix. HTMLCS names
 * techniques (`H37`, `ARIA6`, `F68` …); W3C shelves them by family.
 */
const TECHNIQUE_DIRECTORIES: ReadonlyArray<[RegExp, string]> = [
  [/^ARIA\d+$/, 'aria'],
  [/^SCR\d+$/, 'client-side-script'],
  [/^SVR\d+$/, 'server-side-script'],
  [/^H\d+$/, 'html'],
  [/^G\d+$/, 'general'],
  [/^F\d+$/, 'failures'],
  [/^C\d+$/, 'css'],
  [/^T\d+$/, 'text'],
  [/^SM\d+$/, 'smil'],
  [/^PDF\d+$/, 'pdf'],
];

const TECHNIQUES_INDEX = 'https://www.w3.org/WAI/WCAG21/Techniques/';

type ParsedCode = {
  /** Stable finding identity, minus the standard: `1_1_1.H37`. */
  id: string;
  /** `1.1.1`, when the code named a criterion the reference knows. */
  criterion: string | null;
  /** First technique named, e.g. `H37` from `G73,G74` compounds. */
  technique: string | null;
};

/**
 * `WCAG2AA.Principle1.Guideline1_1.1_1_1.H37` → criterion `1.1.1`, technique
 * `H37`, identity `1_1_1.H37`. The Principle/Guideline segments are dropped
 * from the identity — they repeat what the criterion already says, and a
 * shorter code is what an operator reads in a findings table.
 *
 * Some sniffs suffix the criterion segment with its level — `1_3_1_A.G141`,
 * `1_4_3_F24.F24` — so anything after the three numbers is tolerated in the
 * match and ignored for the criterion, while staying in the identity.
 */
function parseCode(code: string): ParsedCode {
  const segments = code.split('.');
  const criterionIndex = segments.findIndex((segment) => /^\d+_\d+_\d+(_.+)?$/.test(segment));

  if (criterionIndex === -1) {
    // Not the shape we expect. Keep the raw code as identity so the finding
    // is still stable across runs, and claim no criterion.
    return { id: code, criterion: null, technique: null };
  }

  const criterionDigits = /^(\d+)_(\d+)_(\d+)/.exec(segments[criterionIndex]);
  const criterion = criterionDigits
    ? normaliseCriterion(`${criterionDigits[1]}.${criterionDigits[2]}.${criterionDigits[3]}`)
    : null;
  const suffix = segments.slice(criterionIndex + 1).join('.');
  const technique = suffix === '' ? null : (suffix.split(',')[0]?.split('.')[0] ?? null);

  return {
    id: suffix === '' ? segments[criterionIndex] : `${segments[criterionIndex]}.${suffix}`,
    criterion,
    technique,
  };
}

function techniqueUrl(technique: string | null): string {
  if (technique) {
    for (const [pattern, directory] of TECHNIQUE_DIRECTORIES) {
      if (pattern.test(technique)) return `${TECHNIQUES_INDEX}${directory}/${technique}`;
    }
  }
  return TECHNIQUES_INDEX;
}

/**
 * The first sentence, for the title slot. Still HTMLCS's words — splitting
 * is not authoring. Its messages lead with the defect and follow with the
 * fix ("Img element missing an alt attribute. Use the alt attribute to …"),
 * so the first sentence is the finding and the rest is remediation.
 */
function firstSentence(message: string): string {
  const end = message.indexOf('. ');
  return end === -1 ? message : message.slice(0, end + 1);
}

function conformanceLevelFor(criterion: string | null): ConformanceLevel | null {
  if (!criterion) return null;
  return lookupCriterion(criterion)?.level ?? null;
}

function finding(input: {
  code: string;
  title: string;
  message: string;
  allOf: string[];
  criterion: string | null;
  pageUrl: string;
  selector: string;
  htmlSnippet: string;
  helpUrl: string;
}): DeterministicFinding {
  return {
    code: input.code,
    // Every HTMLCS finding, errors included. This is the no-gating decision
    // made structural: `failsConformance` requires severity !== 'needs-review',
    // so nothing this module emits can fail a run.
    severity: 'needs-review',
    title: input.title,
    message: input.message,
    remediation: { anyOf: [], allOf: input.allOf },
    source: 'deterministic',
    wcagCriteria: input.criterion ? [input.criterion] : [],
    conformanceLevel: conformanceLevelFor(input.criterion),
    pageUrl: input.pageUrl,
    selector: input.selector,
    htmlSnippet: input.htmlSnippet.slice(0, MAX_SNIPPET_LENGTH),
    helpUrl: input.helpUrl,
  };
}

/**
 * Maps one page's HTMLCS scan into findings.
 *
 * Where axe has spoken about the same element and criterion — a fact the
 * scan established by element identity and recorded on each message as
 * `axeCriteria` — the HTMLCS echo is dropped, so the review queue holds
 * only what axe could not decide or did not check. Per page by
 * construction: the coverage was resolved against the page the scan ran on.
 *
 * Errors and warnings become one finding per element. Notices become one
 * finding per technique per page — HTMLCS notices restate the specification
 * for nearly every element ("check this alt text is appropriate"), and
 * hundreds of per-element rows would bury the queue they are meant to feed.
 * The collapsed finding is selector-less by design, so its regression key is
 * stable while the page's element count is not.
 */
export function runHtmlcsAudit(
  input: HtmlcsScanResult,
  pageUrl: string,
): DeterministicFinding[] {
  if (input.status !== 'ok') return [];

  const findings: DeterministicFinding[] = [];
  const notices = new Map<string, { parsed: ParsedCode; count: number; message: string }>();

  for (const message of input.messages) {
    const parsed = parseCode(message.code);

    if (message.level === 'notice') {
      const existing = notices.get(parsed.id);
      if (existing) {
        existing.count += 1;
      } else {
        notices.set(parsed.id, { parsed, count: 1, message: message.message });
      }
      continue;
    }

    const duplicatesAxe =
      parsed.criterion !== null && message.axeCriteria.includes(parsed.criterion);
    if (duplicatesAxe) continue;

    findings.push(
      finding({
        code: `htmlcs:${parsed.id}`,
        title: firstSentence(message.message),
        message: message.message,
        allOf: [message.message],
        criterion: parsed.criterion,
        pageUrl,
        selector: message.selector,
        htmlSnippet: message.htmlSnippet,
        helpUrl: techniqueUrl(parsed.technique),
      }),
    );
  }

  for (const { parsed, count, message } of notices.values()) {
    findings.push(
      finding({
        code: `htmlcs:notice:${parsed.id}`,
        title: firstSentence(message),
        message: `${count} element${count === 1 ? '' : 's'} to review. ${message}`,
        allOf: [message],
        criterion: parsed.criterion,
        pageUrl,
        selector: '',
        htmlSnippet: '',
        helpUrl: techniqueUrl(parsed.technique),
      }),
    );
  }

  return findings;
}
