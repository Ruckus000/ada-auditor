import type { VerdictKind } from '../../../services/presentation/verdict';
import { T } from './tokens';

/**
 * The verdict badge, keyed on the real `VerdictKind`.
 *
 * `derive.ts` has a `CHIPS` map too, but it is keyed on the fixture's four-value
 * union and has no `inconclusive` — the very verdict this product treats as
 * load-bearing. Screens reading the database use this one; `derive.ts` goes
 * when the last fixture screen does.
 */
export interface VerdictChip {
  bg: string;
  color: string;
  border: string;
  label: string;
}

export const VERDICT_CHIP: Record<VerdictKind, VerdictChip> = {
  fail: { bg: T.fail, color: '#fff', border: T.fail, label: '✕ FAIL' },
  risk: { bg: '#fdf3e2', color: '#7a4e0a', border: '#dfba79', label: '! AT RISK' },
  pass: { bg: '#e3efec', color: '#0b5f58', border: '#bcd9d2', label: '✓ PASS' },
  scan: { bg: '#eef1f6', color: '#37507e', border: '#c9d3e5', label: '◌ SCANNING' },
  // Deliberately not a shade of pass or fail. An audit that could not gather
  // its evidence has not passed and has not failed, and the badge should not
  // let an operator read it as either.
  inconclusive: { bg: '#f1eef6', color: '#4b3f68', border: '#cfc5e0', label: '? INCONCLUSIVE' },
};

/** The badge label as prose, for an accessible name. */
export function verdictWords(kind: VerdictKind): string {
  return VERDICT_CHIP[kind].label.replace(/[^A-Za-z ]/g, '').trim().toLowerCase();
}
