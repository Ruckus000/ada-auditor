import {
  NOT_CHECKED_CRITERIA,
  type RemediationSummary,
} from '../../domain/document-remediation';
import type { DocumentState } from '../document-state';

/**
 * How a document's verdict is said, everywhere one is said.
 *
 * The sibling of `verdict.ts` for the document half, and it exists for the same
 * recorded reason: this copy was hand-built on two surfaces and had already
 * drifted. `client-documents.tsx` said a document's checker was "not checked on
 * this host"; `shared-report.tsx` said "not checked when this reading was made"
 * — two sentences for one state, one of them on the page a client's counsel
 * reads. That is the shape of the incident `AGENTS.md` records against
 * `report-html.ts`, caught before it cost anything this time.
 *
 * It belongs in `services/presentation/` rather than `app/platform/lib/*-copy.ts`
 * by the boundary `discovery-copy.ts` draws: this directory holds product
 * SEMANTICS with steady-state contracts behind them, and "a reading without a
 * verdict never looks clean" is asserted in three separate places
 * (`document-remediation.ts` twice, `integrations/documents/verapdf.ts` once).
 * The copy modules hold one screen's wording for one screen's codes.
 */

/** The narrow shape these renderers need, so callers with their own type fit. */
type VerdictSummary = Pick<RemediationSummary, 'conformance' | 'scope'>;

/**
 * The reference checker's verdict, in one line.
 *
 * Absence and `checker: 'none'` read the same — "not checked" — because a
 * reading without a verdict must never look clean. Moved here verbatim from
 * `client-documents.tsx`, which held the only named copy.
 */
export function conformanceLine(summary: VerdictSummary): string {
  const c = summary.conformance;
  if (c === undefined || c.checker === 'none') return 'PDF/UA: not checked for this reading';
  if (c.compliant) return 'PDF/UA: compliant (veraPDF)';
  return `PDF/UA: ${c.failingClauses.length} check${c.failingClauses.length === 1 ? '' : 's'} failing (veraPDF)`;
}

/**
 * What this reading looked for, and what nothing here looks for at all.
 *
 * The sentence exists because "no machine-detectable gaps" was rendered on three
 * surfaces with no statement of which gaps were sought. The pipeline reaches
 * five WCAG success criteria out of the roughly fifty in 2.1 AA; a client
 * reading a clean verdict without that context is being told more than anyone
 * checked, which is the failure this product's whole position is against.
 *
 * The page half of the shared report already qualifies its own criteria list
 * this way — "Criteria not listed were not necessarily met" — and the documents
 * half did not.
 */
export function scopeLine(summary: VerdictSummary): string {
  const notChecked = NOT_CHECKED_CRITERIA.map((c) => `${c.number} ${c.name}`).join(', ');

  // Absence is "not recorded", never "everything". Readings stored before the
  // field existed cannot say what they looked for, and rendering that silence
  // as full coverage would reintroduce exactly the overstatement this closes.
  if (summary.scope === undefined) {
    return (
      'The criteria checked were not recorded for this reading, so it cannot be read as a '
      + `statement about anything beyond what is listed. Not checked in any reading: ${notChecked}.`
    );
  }

  const checked = summary.scope.criteria.join(', ');
  return (
    `Checked here: WCAG ${checked}, and PDF/UA-1 where a checker was available. `
    + `Not checked: ${notChecked}. `
    + SCOPE_EXPLAINER
  );
}

/**
 * The one word a row leads with, per state.
 *
 * Here rather than beside the chip colours, for the reason this whole file
 * exists: the label is product semantics — `closed` must never say "done",
 * because nothing is open AND the file still fails the checker — and a second
 * surface reaching for its own word is how two screens disagree about one
 * document.
 */
export function documentStateLabel(state: DocumentState): string {
  switch (state) {
    case 'not-reviewed':
      return 'Not reviewed';
    case 'stale':
      return 'Changed since read';
    case 'needs-answers':
      return 'Needs answers';
    case 'conformant':
      return 'Conformant';
    case 'ready':
      return 'Ready to run';
    case 'waiting-on-client':
      return 'Waiting on client';
    case 'closed':
      return 'Nothing left to decide';
  }
}

/**
 * What the state means for THIS row, counts included, in words — the
 * sentence beside the label. Counts here rather than in the label so the
 * label stays one stable phrase an operator learns to scan for.
 */
export function documentStateNote(
  state: DocumentState,
  standing: { open: number; waiting: number; expired: number },
): string {
  const items = (n: number) => `${n} item${n === 1 ? '' : 's'}`;
  const answers = (n: number) => `${n} answer${n === 1 ? '' : 's'}`;
  switch (state) {
    case 'not-reviewed':
      return 'no reading yet';
    case 'stale':
      return `the document changed since it was read; ${answers(standing.expired)} no longer apply`;
    case 'needs-answers':
      return (
        `${items(standing.open)} need${standing.open === 1 ? 's' : ''} an answer`
        + (standing.waiting > 0 ? `, ${standing.waiting} waiting on the client` : '')
      );
    case 'conformant':
      return 'the checker passed and nothing is open';
    case 'ready':
      return 'a run would advance it';
    case 'waiting-on-client':
      return `${items(standing.waiting)} requested from the client`;
    case 'closed':
      return 'every item is decided; the file still does not conform';
  }
}

/**
 * The ceiling, stated once.
 *
 * Kept separate so a surface can show it beside a compliant verdict as well as
 * a failing one — a document that passes every machine check has still only
 * passed the machine-checkable share, and "compliant" without this reads as
 * more than veraPDF can support. Matterhorn 1.1 against PDF/UA-1 specifically;
 * the figure does not carry to PDF/UA-2.
 */
export const SCOPE_EXPLAINER =
  'Automated checking reaches a subset of accessibility barriers: 47 of PDF/UA-1’s 136 failure conditions need human judgement, and a passing check is not by itself a conformance claim.';
