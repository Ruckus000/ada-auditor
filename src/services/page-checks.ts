import type { ConformanceLevel, DeterministicFinding } from './deterministic-audit';

/**
 * Checks axe structurally cannot make, evaluated over plain page facts.
 *
 * Each of these exists because the blind test planted its exact defect and
 * measured the miss — and then measured that enabling axe's nearest rules
 * changes nothing, before any of this was written:
 *
 * `[V]` `focus-order-semantics` and `label-content-name-mismatch`, enabled via
 * `ENABLED_BY_US`, produced zero output on fixtures containing B3, C1 and B9.
 * The first examines only elements *in the focus order* — a `<div onclick>`
 * with no tabindex is not in it, which is the entire barrier. The second
 * examines only elements labelled *by their content* — an `<input>` labelled
 * by an external `<label>` never is. Not configuration; applicability. So the
 * fix is a check of our own on facts axe does not consider, not a stronger
 * setting on one that considers different facts.
 *
 * ## The seam, same as axe's
 *
 * `integrations/browser/page-facts.ts` reads the live DOM and hands over
 * PLAIN DATA; this module turns facts into findings and never imports
 * Playwright — which is what keeps it in the fast unit suite. Findings flow
 * through the same `DeterministicFinding` shape, so gating, regression keys,
 * report rendering and the shared report all work unchanged.
 *
 * ## What these deliberately do not do
 *
 * They do not contribute to the score's denominator — the score remains a
 * rate over axe-evaluated checks, documented where it is computed. They add
 * findings, which is the honest direction: a new check making a site's score
 * *rise* would mean the denominator moved, not the site.
 *
 * `RUN_RULESET` names these check ids beside the axe version, so a run before
 * and a run after this module differ visibly and the regression comparator
 * refuses to fabricate a diff across them.
 */

/** One element with a click handler that is not natively interactive. */
export type ClickTargetFact = {
  selector: string;
  tag: string;
  role: string | null;
  /** The attribute's raw value, or null when absent — absent is the finding. */
  tabindex: string | null;
  html: string;
};

/** One text-entry control and everything that could be labelling it. */
export type LabelledControlFact = {
  selector: string;
  /** Text of an associated <label> (for= or ancestor), trimmed, or null. */
  labelText: string | null;
  ariaLabel: string | null;
  hasAriaLabelledby: boolean;
  placeholder: string | null;
  title: string | null;
  html: string;
};

export type PageFacts = {
  clickTargets: ClickTargetFact[];
  labelledControls: LabelledControlFact[];
};

/**
 * Named in `RUN_RULESET` — a change here is an instrument change and must
 * read as one. Order is alphabetical to keep the string stable.
 */
export const PAGE_CHECK_IDS = [
  'click-handler-not-focusable',
  'placeholder-as-only-label',
  'visible-label-not-in-name',
] as const;

const WCAG_UNDERSTANDING = 'https://www.w3.org/WAI/WCAG22/Understanding/';

function finding(input: {
  code: (typeof PAGE_CHECK_IDS)[number];
  title: string;
  message: string;
  anyOf: string[];
  criterion: string;
  level: ConformanceLevel;
  understandingSlug: string;
  pageUrl: string;
  selector: string;
  html: string;
}): DeterministicFinding {
  return {
    code: input.code,
    // 'major', matching where SEVERITY_BY_IMPACT puts axe's 'serious': every
    // check here blocks a class of user outright, but none is the
    // content-invisible / control-unusable bar the mapper reserves 'critical'
    // for.
    severity: 'major',
    title: input.title,
    message: input.message,
    remediation: { anyOf: input.anyOf, allOf: [] },
    source: 'deterministic',
    wcagCriteria: [input.criterion],
    conformanceLevel: input.level,
    pageUrl: input.pageUrl,
    selector: input.selector,
    htmlSnippet: input.html.slice(0, 300),
    helpUrl: `${WCAG_UNDERSTANDING}${input.understandingSlug}.html`,
  };
}

/**
 * Runs every page check over one page's facts.
 *
 * Pure, and deliberately narrow: each predicate fires only on the
 * unambiguous shape of its defect, because the blind test's `clean` rows —
 * correctly built implementations that must stay unreported — are the
 * standing cost ceiling for every check added here.
 */
export function runPageChecks(facts: PageFacts, pageUrl: string): DeterministicFinding[] {
  const findings: DeterministicFinding[] = [];

  for (const target of facts.clickTargets) {
    // In the focus order it would be axe's case; out of it, it is invisible
    // to every keyboard and screen-reader user. The narrow predicate is
    // "no tabindex at all" — an explicit tabindex, even a wrong one, is a
    // different (and axe-visible) defect.
    if (target.tabindex === null) {
      findings.push(
        finding({
          code: 'click-handler-not-focusable',
          title: 'Clickable element cannot be reached by keyboard',
          message:
            `<${target.tag}> has a click handler but no tabindex` +
            `${target.role === null ? ' and no role' : ''}, so keyboard and ` +
            'assistive-technology users cannot reach or activate it.',
          anyOf: [
            'Use a <button> or <a href> element instead',
            'Add tabindex="0", an interactive role, and a keydown handler for Enter and Space',
          ],
          criterion: '2.1.1',
          level: 'A',
          understandingSlug: 'keyboard',
          pageUrl,
          selector: target.selector,
          html: target.html,
        }),
      );
    }
  }

  for (const control of facts.labelledControls) {
    const accessibleNames = [control.ariaLabel, control.labelText, control.title];
    const hasRealName =
      control.hasAriaLabelledby || accessibleNames.some((name) => Boolean(name?.trim()));

    // axe accepts a placeholder as an accessible name, so its label rules
    // pass this shape — the asymmetry the product inherited silently until
    // the blind test planted it (A10, C13). A placeholder vanishes on first
    // keystroke; it is a hint, not a label.
    if (control.placeholder?.trim() && !hasRealName) {
      findings.push(
        finding({
          code: 'placeholder-as-only-label',
          title: 'Form field is labelled only by its placeholder',
          message:
            'The only text naming this field is its placeholder, which disappears ' +
            'as soon as the user starts typing.',
          anyOf: [
            'Add a visible <label> associated with the field',
            'Add aria-label or aria-labelledby naming the field',
          ],
          criterion: '3.3.2',
          level: 'A',
          understandingSlug: 'labels-or-instructions',
          pageUrl,
          selector: control.selector,
          html: control.html,
        }),
      );
    }

    // 2.5.3 for inputs, whose visible label is external to them — the case
    // axe's content-labelled rule can never reach (B9). Speech-input users
    // address a control by the label they can see; an aria-label that does
    // not contain it makes the control unaddressable.
    const visible = control.labelText?.trim().toLowerCase();
    const accessible = control.ariaLabel?.trim().toLowerCase();
    if (visible && accessible && !accessible.includes(visible)) {
      findings.push(
        finding({
          code: 'visible-label-not-in-name',
          title: 'Accessible name does not contain the visible label',
          message:
            `The visible label reads "${control.labelText?.trim()}" but the accessible name ` +
            `is "${control.ariaLabel?.trim()}", so speech-input users saying the visible ` +
            'label cannot address this field.',
          anyOf: [
            'Remove the aria-label and let the visible label name the field',
            'Start the aria-label with the visible label text',
          ],
          criterion: '2.5.3',
          level: 'AA',
          understandingSlug: 'label-in-name',
          pageUrl,
          selector: control.selector,
          html: control.html,
        }),
      );
    }
  }

  return findings;
}
