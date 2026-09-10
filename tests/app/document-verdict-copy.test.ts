import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { conformanceLine } from '../../src/services/presentation/document-verdict';
import type { Conformance } from '../../src/domain/document-remediation';

/**
 * No surface hand-builds a document's verdict, and none states one unscoped.
 *
 * Both halves of this were already true when it was written. The PDF/UA line
 * existed twice — once named in the operator console, once inlined in the public
 * report — and the two copies had drifted to different wordings for the "not
 * checked" state, one of them on the page a client's counsel reads. And "No
 * machine-detectable gaps" was rendered on both without either saying which gaps
 * were sought, over an instrument that reaches five WCAG criteria of the roughly
 * fifty in 2.1 AA.
 *
 * Same grep-the-tree pattern as `score-copy.test.ts` and `log-shape.test.ts`,
 * for the same reason: a rule that lives only in review comments gets pasted
 * around, and a component is individually valid code either way.
 *
 * Note the two checks are deliberately different shapes. The first is a
 * NEGATIVE assertion, because the copy it guards now lives entirely in the seam
 * — written as an implication it would have no antecedent left in `src/app` and
 * would pass without guarding anything. The second is an implication, and the
 * non-vacuity test below is what keeps it honest.
 */

const APP_ROOT = join('src', 'app');
const SEAM = 'presentation/document-verdict';

function componentFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...componentFiles(path));
    else if (entry.endsWith('.tsx')) out.push(path);
  }
  return out;
}

describe('document verdict rendering', () => {
  const files = componentFiles(APP_ROOT).map((file) => ({
    file,
    source: readFileSync(file, 'utf8'),
  }));

  it('is looked at by this test at all', () => {
    // A walk that finds no components asserts nothing. And an implication with
    // no antecedent is silently true, so the scope check below needs at least
    // one surface still making the claim it qualifies.
    expect(files.length).toBeGreaterThan(10);
    expect(files.filter((f) => /machine-detectable/i.test(f.source)).length).toBeGreaterThan(0);
  });

  it('is anchored to a prefix the seam still emits', () => {
    // The negative below is only as strong as this. It forbids components
    // containing `PDF/UA:` and draws all its power from `conformanceLine`
    // being the one thing that says it — so if that prefix is ever reworded,
    // the guard keeps passing while guarding nothing, because no component
    // could contain it any more.
    //
    // A live hazard, not a hypothetical: `'PDF/UA: compliant (veraPDF)'` is
    // the closest thing to a conformance verdict a client reads, and a copy
    // pass aimed at the word "Conformant" lands one function away from it.
    // This is the same failure as the vocabulary guard that shipped
    // case-sensitive and let a lowercase page description through.
    const summaries: Array<{ conformance: Conformance | undefined }> = [
      { conformance: undefined },
      { conformance: { checker: 'none', reason: 'unavailable' } },
      { conformance: { checker: 'verapdf-ua1', compliant: true } },
      { conformance: { checker: 'verapdf-ua1', compliant: false, failingClauses: ['7.1-1'] } },
    ];

    for (const summary of summaries) {
      expect(conformanceLine(summary), JSON.stringify(summary)).toContain('PDF/UA:');
    }
  });

  it('never hand-builds a PDF/UA verdict in a component', () => {
    // The whole string, wherever it is said, comes from `conformanceLine`.
    for (const { file, source } of files) {
      expect(
        source.includes('PDF/UA:'),
        `${file} builds its own PDF/UA verdict — use conformanceLine from services/${SEAM}`,
      ).toBe(false);
    }
  });

  it('never states a gap verdict without the scope beside it', () => {
    // The claim and its qualification travel together, or the claim overstates.
    for (const { file, source } of files) {
      if (!/machine-detectable/i.test(source)) continue;
      expect(
        source.includes('scopeLine'),
        `${file} says "machine-detectable gaps" without scopeLine from services/${SEAM}`,
      ).toBe(true);
    }
  });
});
