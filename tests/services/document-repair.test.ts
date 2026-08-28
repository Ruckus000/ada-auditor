import { describe, expect, it } from 'vitest';
import { planRepair } from '../../src/services/document-repair';
import type { DocumentStructure } from '../../src/domain/document-structure';

/**
 * The policy that decides what an honest PDF repair may write.
 *
 * Pure over a reading, so every rule here is assertable without a JVM — which
 * matters because the rules are the product: a repair that writes one fact the
 * document never stated is the failure mode the whole PDF spike was stopped
 * over.
 */

function structure(over: Partial<DocumentStructure> = {}): DocumentStructure {
  return {
    structureElements: 42,
    marked: true,
    textChars: 900,
    images: 0,
    pages: 3,
    lang: 'en-US',
    title: null,
    headings: [],
    headingTexts: [],
    tables: [],
    lists: [],
    figures: [],
    order: [],
    ...over,
  };
}

describe('planRepair', () => {
  it('refuses a PDF with no structure tree, and says what would help', () => {
    const decision = planRepair(structure({ structureElements: 0 }), 'Fee_Schedule.pdf');

    expect(decision.repairable).toBe(false);
    if (decision.repairable) return;
    expect(decision.refusal.kind).toBe('not-tagged');
    // The refusal has to name the two real routes. "Cannot repair" alone
    // leaves an operator with a dead end rather than a next action.
    expect(decision.refusal.reason).toContain('Word source');
    expect(decision.refusal.reason).toContain('tagged by a person');
  });

  it('refuses on an empty tree even when the document claims to be tagged', () => {
    // The shape Phase 0 found in the wild. `marked` is what was claimed and
    // must never be mistaken for what is true, or repair would proceed on a
    // document with nothing to transcribe.
    const decision = planRepair(
      structure({ structureElements: 0, marked: true }),
      'Legal_Notice.pdf',
    );
    expect(decision.repairable).toBe(false);
  });

  it('keeps the title the document already carries', () => {
    const decision = planRepair(
      structure({ title: 'Zoning Ordinance', headingTexts: [{ level: 'H1', text: 'Part One' }] }),
      'zoning.pdf',
    );

    expect(decision.repairable).toBe(true);
    if (!decision.repairable) return;
    expect(decision.plan.title).toEqual({ kind: 'already-titled', title: 'Zoning Ordinance' });
  });

  it('falls to the document’s own first heading, skipping empty ones', () => {
    const decision = planRepair(
      structure({
        title: null,
        headingTexts: [
          { level: 'H1', text: '   ' },
          { level: 'H2', text: null },
          { level: 'H2', text: 'Public Hearing Notice' },
        ],
      }),
      'notice.pdf',
    );

    expect(decision.repairable).toBe(true);
    if (!decision.repairable) return;
    expect(decision.plan.title).toEqual({
      kind: 'transcribed',
      title: 'Public Hearing Notice',
    });
  });

  it('falls to the filename, which is authored text wherever it appears', () => {
    const decision = planRepair(structure({ title: null }), '2026-Mid-Year-Fee-Schedule.pdf');

    expect(decision.repairable).toBe(true);
    if (!decision.repairable) return;
    // The provenance kind is the point: a reviewer sees where it came from.
    expect(decision.plan.title).toEqual({
      kind: 'filename-derived',
      title: '2026 Mid Year Fee Schedule',
    });
  });

  it('keeps the honest gap when the filename is junk', () => {
    const decision = planRepair(structure({ title: null }), 'Document1.pdf');

    expect(decision.repairable).toBe(true);
    if (!decision.repairable) return;
    expect(decision.plan.title).toEqual({ kind: 'no-heading-to-copy' });
  });

  it('keeps the honest gap when there is no filename to derive from', () => {
    const decision = planRepair(structure({ title: null }), undefined);

    expect(decision.repairable).toBe(true);
    if (!decision.repairable) return;
    expect(decision.plan.title).toEqual({ kind: 'no-heading-to-copy' });
  });

  it('treats a whitespace-only title as no title at all', () => {
    const decision = planRepair(structure({ title: '   ' }), 'Fee-Schedule.pdf');

    expect(decision.repairable).toBe(true);
    if (!decision.repairable) return;
    expect(decision.plan.title).toEqual({ kind: 'filename-derived', title: 'Fee Schedule' });
  });

  it('passes the declared language through unchanged', () => {
    const decision = planRepair(structure({ lang: 'cy-GB' }), 'notice.pdf');

    expect(decision.repairable).toBe(true);
    if (!decision.repairable) return;
    expect(decision.plan.language).toBe('cy-GB');
  });

  it('keeps “no language” as a decision, never a default', () => {
    // `Finish` removes the claim when given none, which is correct for a
    // document that declares none — and catastrophic if this ever invented
    // one instead. /Lang has no default, ever.
    const decision = planRepair(structure({ lang: null }), 'notice.pdf');

    expect(decision.repairable).toBe(true);
    if (!decision.repairable) return;
    expect(decision.plan.language).toBeNull();
  });
});
