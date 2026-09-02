import type { DocumentState } from '../../../services/document-state';
import { documentStateLabel } from '../../../services/presentation/document-verdict';
import type { VerdictKind } from '../../../services/presentation/verdict';
import { T } from './tokens';

/**
 * The verdict badge, keyed on the real `VerdictKind`.
 *
 * The map this replaced was keyed on the fixture's four-value union and had no
 * `inconclusive` — the very verdict this product treats as load-bearing. An
 * audit that could not gather its evidence has not passed and has not failed,
 * and the badge must not let an operator read it as either.
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

/**
 * A document's state, on the five palettes the run chips already use.
 *
 * No sixth colour: an operator has learned what each shade means on the
 * portfolio, and a document row should read the same way. Conformant is a
 * pass; needs-answers is at-risk work; stale is inconclusive, because the
 * reading no longer describes the file; everything blocked or unread sits on
 * the calm scanning palette; closed is inconclusive too — nothing is open and
 * the file still fails, which is neither a pass nor work.
 */
const DOCUMENT_STATE_PALETTE: Record<DocumentState, VerdictKind> = {
  'not-reviewed': 'scan',
  stale: 'inconclusive',
  'needs-answers': 'risk',
  conformant: 'pass',
  ready: 'scan',
  'waiting-on-client': 'scan',
  closed: 'inconclusive',
};

export function documentStateChip(state: DocumentState): VerdictChip {
  return { ...VERDICT_CHIP[DOCUMENT_STATE_PALETTE[state]], label: documentStateLabel(state) };
}
