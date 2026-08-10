/**
 * The official names and levels of the WCAG 2.2 success criteria.
 *
 * A finding stores criterion numbers — `["1.1.1"]` — because that is what the
 * rule engine reports and what a conformance claim is made against. A number
 * on its own is unreadable to everyone except an auditor, which matters most
 * on the one page this product shows to people who are not auditors: the
 * shared report a client's legal team opens.
 *
 * These are quoted facts, not authored content. That is the whole reason this
 * table is allowed to exist while the prototype's per-finding prose was
 * deleted: "1.1.1 is called Non-text Content and is Level A" is checkable
 * against the specification, whereas "this will take about two hours to fix"
 * was invented.
 *
 * A and AA only. This product audits to AA, so a AAA criterion appearing here
 * would imply a claim it does not make. An unknown number renders as the bare
 * number rather than a guess.
 */

export type WcagLevel = 'A' | 'AA';

export type WcagCriterion = {
  number: string;
  name: string;
  level: WcagLevel;
};

const CRITERIA: Record<string, Omit<WcagCriterion, 'number'>> = {
  // 1 — Perceivable
  '1.1.1': { name: 'Non-text Content', level: 'A' },
  '1.2.1': { name: 'Audio-only and Video-only (Prerecorded)', level: 'A' },
  '1.2.2': { name: 'Captions (Prerecorded)', level: 'A' },
  '1.2.3': { name: 'Audio Description or Media Alternative (Prerecorded)', level: 'A' },
  '1.2.4': { name: 'Captions (Live)', level: 'AA' },
  '1.2.5': { name: 'Audio Description (Prerecorded)', level: 'AA' },
  '1.3.1': { name: 'Info and Relationships', level: 'A' },
  '1.3.2': { name: 'Meaningful Sequence', level: 'A' },
  '1.3.3': { name: 'Sensory Characteristics', level: 'A' },
  '1.3.4': { name: 'Orientation', level: 'AA' },
  '1.3.5': { name: 'Identify Input Purpose', level: 'AA' },
  '1.4.1': { name: 'Use of Color', level: 'A' },
  '1.4.2': { name: 'Audio Control', level: 'A' },
  '1.4.3': { name: 'Contrast (Minimum)', level: 'AA' },
  '1.4.4': { name: 'Resize Text', level: 'AA' },
  '1.4.5': { name: 'Images of Text', level: 'AA' },
  '1.4.10': { name: 'Reflow', level: 'AA' },
  '1.4.11': { name: 'Non-text Contrast', level: 'AA' },
  '1.4.12': { name: 'Text Spacing', level: 'AA' },
  '1.4.13': { name: 'Content on Hover or Focus', level: 'AA' },

  // 2 — Operable
  '2.1.1': { name: 'Keyboard', level: 'A' },
  '2.1.2': { name: 'No Keyboard Trap', level: 'A' },
  '2.1.4': { name: 'Character Key Shortcuts', level: 'A' },
  '2.2.1': { name: 'Timing Adjustable', level: 'A' },
  '2.2.2': { name: 'Pause, Stop, Hide', level: 'A' },
  '2.3.1': { name: 'Three Flashes or Below Threshold', level: 'A' },
  '2.4.1': { name: 'Bypass Blocks', level: 'A' },
  '2.4.2': { name: 'Page Titled', level: 'A' },
  '2.4.3': { name: 'Focus Order', level: 'A' },
  '2.4.4': { name: 'Link Purpose (In Context)', level: 'A' },
  '2.4.5': { name: 'Multiple Ways', level: 'AA' },
  '2.4.6': { name: 'Headings and Labels', level: 'AA' },
  '2.4.7': { name: 'Focus Visible', level: 'AA' },
  '2.4.11': { name: 'Focus Not Obscured (Minimum)', level: 'AA' },
  '2.5.1': { name: 'Pointer Gestures', level: 'A' },
  '2.5.2': { name: 'Pointer Cancellation', level: 'A' },
  '2.5.3': { name: 'Label in Name', level: 'A' },
  '2.5.4': { name: 'Motion Actuation', level: 'A' },
  '2.5.7': { name: 'Dragging Movements', level: 'AA' },
  '2.5.8': { name: 'Target Size (Minimum)', level: 'AA' },

  // 3 — Understandable
  '3.1.1': { name: 'Language of Page', level: 'A' },
  '3.1.2': { name: 'Language of Parts', level: 'AA' },
  '3.2.1': { name: 'On Focus', level: 'A' },
  '3.2.2': { name: 'On Input', level: 'A' },
  '3.2.3': { name: 'Consistent Navigation', level: 'AA' },
  '3.2.4': { name: 'Consistent Identification', level: 'AA' },
  '3.2.6': { name: 'Consistent Help', level: 'A' },
  '3.3.1': { name: 'Error Identification', level: 'A' },
  '3.3.2': { name: 'Labels or Instructions', level: 'A' },
  '3.3.3': { name: 'Error Suggestion', level: 'AA' },
  '3.3.4': { name: 'Error Prevention (Legal, Financial, Data)', level: 'AA' },
  '3.3.7': { name: 'Redundant Entry', level: 'A' },
  '3.3.8': { name: 'Accessible Authentication (Minimum)', level: 'AA' },

  // 4 — Robust
  '4.1.2': { name: 'Name, Role, Value', level: 'A' },
  '4.1.3': { name: 'Status Messages', level: 'AA' },
};

/**
 * Accepts `1.1.1`, `wcag111` and `WCAG 1.1.1`.
 *
 * axe tags criteria as `wcag111`; a stored finding may carry either form
 * depending on how it was produced, and a lookup that only understood one of
 * them would silently render every criterion as a bare number.
 */
export function normaliseCriterion(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase().replace(/^wcag\s*/, '');

  if (/^\d+\.\d+\.\d+$/.test(trimmed)) {
    return trimmed;
  }

  // `wcag111` → 1.1.1, `wcag2410` → 2.4.10. The last segment can be two
  // digits, the first two never are.
  const digits = /^(\d)(\d)(\d+)$/.exec(trimmed);
  return digits ? `${digits[1]}.${digits[2]}.${digits[3]}` : null;
}

/** Null for anything not in WCAG 2.2 A/AA, so the caller can show the raw value. */
export function lookupCriterion(raw: string): WcagCriterion | null {
  const number = normaliseCriterion(raw);
  if (!number) return null;

  const found = CRITERIA[number];
  return found ? { number, ...found } : null;
}

/** `1.1.1 Non-text Content (A)`, or the raw value when it is not one we know. */
export function describeCriterion(raw: string): string {
  const criterion = lookupCriterion(raw);
  return criterion ? `${criterion.number} ${criterion.name} (${criterion.level})` : raw;
}

/** Every criterion a set of findings failed, deduplicated and in spec order. */
export function summariseCriteria(raws: readonly string[]): WcagCriterion[] {
  const found = new Map<string, WcagCriterion>();

  for (const raw of raws) {
    const criterion = lookupCriterion(raw);
    if (criterion) found.set(criterion.number, criterion);
  }

  return [...found.values()].sort((a, b) => compareNumbers(a.number, b.number));
}

/** Numeric, not lexical: 1.4.10 comes after 1.4.5, not before it. */
function compareNumbers(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);

  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}
