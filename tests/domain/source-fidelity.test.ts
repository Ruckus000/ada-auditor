import { describe, expect, it } from 'vitest';

import type { DocumentStructure } from '../../src/domain/document-structure';
import { checkFidelity, fidelityDefects, type Defect } from '../../src/domain/source-fidelity';
import type { SourceTruth } from '../../src/domain/source-truth';

/**
 * The fidelity comparator, branch by branch.
 *
 * Fixtures here are the smallest object that reaches the branch under test.
 * They are not realistic documents and are not meant to be — the pattern is
 * carried over from `experiments/document-remediation/compare.test.mjs`, whose
 * builders exist for exactly this reason.
 *
 * **Every branch gets a firing case AND a not-firing case.** The second is not
 * padding: `instrument-correction.md` records a comparator that was blind to
 * figure under-tagging for the whole of two experiments, and a blind branch is
 * indistinguishable from a clean document unless something asserts the silence
 * is earned. Assertions are on defect KIND plus a message regex, never on exact
 * strings, so wording can improve without a test rewrite.
 */

const delivered = (over: Partial<DocumentStructure> = {}): DocumentStructure => ({
  structureElements: 10,
  marked: true,
  signed: false,
  // Required since this fixture was written; a reading cannot omit them.
  encrypted: false,
  formFields: 0,
  formFieldsWithoutName: 0,
  embeddedFiles: 0,
  annotationsNotInStructure: 0,
  textChars: 500,
  images: 0,
  pages: 1,
  lang: 'en-US',
  title: 'A Title',
  headings: [],
  headingTexts: [],
  figures: [],
  tables: [],
  lists: [],
  order: [],
  ...over,
});

const source = (over: Partial<Extract<SourceTruth, { readable: true }>> = {}): SourceTruth => ({
  readable: true,
  oracle: 'ooxml',
  title: 'A Title',
  language: 'en-US',
  headings: 0,
  headingLevels: [],
  tables: 0,
  lists: 0,
  listItems: 0,
  figures: 0,
  figuresWithAlt: 0,
  ...over,
});

const assertions = (d: Defect[]) => d.filter((x) => x.kind === 'assertion');
const omissions = (d: Defect[]) => d.filter((x) => x.kind === 'omission');
const unverified = (d: Defect[]) => d.filter((x) => x.kind === 'unverified');
const matching = (d: Defect[], re: RegExp) => d.filter((x) => re.test(x.detail));

describe('headings, by count', () => {
  it('more headings delivered than the source declared is UNVERIFIED, and never gates', () => {
    // `[V]` Blind corpus r28: source 13 headings, this reader read 9, delivered
    // 12. The under-count inverted a heading LOST into three INVENTED and
    // refused a sound document. The source read is a lower bound; a lower bound
    // cannot carry a refusal.
    const found = fidelityDefects(
      source({ headings: 1, headingLevels: [1] }),
      delivered({ headings: ['H1', 'H2'] }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('unverified');
    expect(assertions(found)).toEqual([]);
  });

  it('fewer headings delivered than the source declared is an omission', () => {
    const found = omissions(
      fidelityDefects(source({ headings: 3, headingLevels: [1, 2, 2] }), delivered({ headings: ['H1'] })),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.detail).toMatch(/1 heading.*3 declared/i);
  });

  it('does not fire when the counts agree', () => {
    expect(
      matching(
        fidelityDefects(source({ headings: 2, headingLevels: [1, 2] }), delivered({ headings: ['H1', 'H2'] })),
        /heading/i,
      ),
    ).toEqual([]);
  });
});

describe('headings, by level sequence', () => {
  it('the right number of headings at the wrong depths is an OMISSION, not an assertion', () => {
    // Classified as an omission deliberately, and it was an assertion until the
    // first run over real documents. A level difference fabricates nothing —
    // the same headings arrive carrying the same text at a different depth.
    // `[V]` Every level difference in the 31-document corpus is either the PDF
    // format ceiling (no level below H6, three documents declare Word outline
    // level 7) or the exporter re-levelling a contents heading. Neither is ours
    // to fix, and refusing delivery on an unfixable defect only withholds a
    // sound document. `needsIn` already treats heading depth as a person's
    // decision rather than a blocking defect; this agrees with it.
    const found = fidelityDefects(
      source({ headings: 3, headingLevels: [1, 2, 3] }),
      delivered({ headings: ['H1', 'H2', 'H2'] }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('omission');
    expect(found[0]!.criterion).toBe('2.4.10');
    expect(found[0]!.detail).toMatch(/level/i);
  });

  it('the H7 the PDF format cannot express is reported, and does not block', () => {
    const found = fidelityDefects(
      source({ headings: 4, headingLevels: [1, 1, 1, 7] }),
      delivered({ headings: ['H1', 'H1', 'H1', 'H6'] }),
    );
    expect(assertions(found)).toEqual([]);
    expect(omissions(found)).toHaveLength(1);
  });

  it('does not fire when the sequence matches', () => {
    expect(
      fidelityDefects(
        source({ headings: 3, headingLevels: [1, 2, 3] }),
        delivered({ headings: ['H1', 'H2', 'H3'] }),
      ),
    ).toEqual([]);
  });

  it('stays quiet when the counts already disagree, so one defect is not reported twice', () => {
    const found = fidelityDefects(
      source({ headings: 3, headingLevels: [1, 2, 3] }),
      delivered({ headings: ['H1'] }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('omission');
  });
});

describe('tables', () => {
  it('more tables delivered than declared is UNVERIFIED, and never gates', () => {
    // An exporter that splits one table across pages delivers more than the
    // source declares without inventing anything.
    const found = fidelityDefects(source({ tables: 1 }), delivered({ tables: [table(), table()] }));
    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('unverified');
  });

  it('fewer tables delivered than declared is an omission', () => {
    const found = omissions(fidelityDefects(source({ tables: 2 }), delivered({ tables: [table()] })));
    expect(found).toHaveLength(1);
  });

  it('does not fire when the counts agree', () => {
    expect(fidelityDefects(source({ tables: 1 }), delivered({ tables: [table()] }))).toEqual([]);
  });
});

describe('list items', () => {
  it('more items delivered than declared is UNVERIFIED, and never gates', () => {
    // `[V]` Blind corpus r34 numbers at the style level: 13 read against 93
    // delivered. The pipeline cannot manufacture 80 list items — the reader
    // was low, and gating on it refused the document.
    const found = fidelityDefects(source({ listItems: 2 }), delivered({ lists: [{ depth: 1, items: 5 }] }));
    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('unverified');
  });

  it('fewer items delivered than declared is an omission', () => {
    expect(
      omissions(fidelityDefects(source({ listItems: 5 }), delivered({ lists: [{ depth: 1, items: 2 }] }))),
    ).toHaveLength(1);
  });

  it('one source group split across several delivered lists is not a defect', () => {
    // `[V]` The export splits an interrupted numbering group into several `L`
    // structures — 1 group became 12 on a real document. Items are the unit
    // precisely so that split reads as the same content, not as invention.
    expect(
      fidelityDefects(
        source({ lists: 1, listItems: 6 }),
        delivered({ lists: [{ depth: 1, items: 2 }, { depth: 1, items: 4 }] }),
      ),
    ).toEqual([]);
  });
});

describe('figures', () => {
  it('more figures delivered than declared is UNVERIFIED, and never gates', () => {
    // The source read is the body; the delivered read is the whole tree,
    // headers included. `[V]` This reader has under-counted source figures
    // three times in a week — VML imagedata-only, `draw:custom-shape`, and
    // `v:rect`/`v:oval` — every one pointing the same way and every one able
    // to refuse a sound document. The row reports; it does not withhold.
    const found = fidelityDefects(source({ figures: 1 }), delivered({ figures: [fig(), fig()] }));
    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe('unverified');
    expect(assertions(found)).toEqual([]);
  });

  it('fewer figures delivered than declared is an omission', () => {
    expect(omissions(fidelityDefects(source({ figures: 2 }), delivered({ figures: [fig()] })))).toHaveLength(1);
  });

  it('does not fire when the counts agree', () => {
    expect(fidelityDefects(source({ figures: 1 }), delivered({ figures: [fig()] }))).toEqual([]);
  });
});

describe('figures the author described', () => {
  it('losing the author’s alt text is an omission', () => {
    const found = omissions(
      fidelityDefects(
        source({ figures: 1, figuresWithAlt: 1 }),
        delivered({ figures: [fig({ alt: null })] }),
      ),
    );
    expect(matching(found, /descri|alt/i)).toHaveLength(1);
  });

  it('delivering MORE described figures than the source is not a defect', () => {
    // `deriveAltFromCaptions` transcribes a caption the author wrote into
    // `svg:desc`. That is the same author's words moved, not a new claim — so
    // over-delivery here must stay silent or the pipeline's own legitimate
    // transcription would refuse every captioned document.
    expect(
      fidelityDefects(
        source({ figures: 1, figuresWithAlt: 0 }),
        delivered({ figures: [fig({ alt: 'The city seal' })] }),
      ),
    ).toEqual([]);
  });

  it('an empty alt string counts as described, and is not an omission', () => {
    // Empty alt is a positive claim that the graphic carries no meaning.
    // Absent alt is an unanswered question. Collapsing them is the mistake
    // `figureSchema` exists to prevent.
    expect(
      fidelityDefects(
        source({ figures: 1, figuresWithAlt: 1 }),
        delivered({ figures: [fig({ alt: '' })] }),
      ),
    ).toEqual([]);
  });
});

describe('language', () => {
  it('a delivered language that disagrees with the source is an assertion', () => {
    const found = assertions(
      fidelityDefects(source({ language: 'en-US' }), delivered({ lang: 'cy' })),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.detail).toMatch(/language/i);
  });

  it('a regional variant of the same primary subtag is not a defect', () => {
    expect(fidelityDefects(source({ language: 'en' }), delivered({ lang: 'en-GB' }))).toEqual([]);
  });

  it('losing a declared language is an omission', () => {
    expect(omissions(fidelityDefects(source({ language: 'en' }), delivered({ lang: null })))).toHaveLength(1);
  });

  it('claiming a language the source never declared is an assertion', () => {
    // The pipeline deliberately removes the exporter's guess when the source
    // declares none. A language present here means something re-invented it.
    expect(
      assertions(fidelityDefects(source({ language: null }), delivered({ lang: 'en-US' }))),
    ).toHaveLength(1);
  });

  it('no language on either side is not a defect', () => {
    expect(fidelityDefects(source({ language: null }), delivered({ lang: null }))).toEqual([]);
  });
});

describe('title', () => {
  it('losing the source’s title is an omission', () => {
    expect(
      omissions(fidelityDefects(source({ title: 'Budget Hearing' }), delivered({ title: null }))),
    ).toHaveLength(1);
  });

  it('changing the source’s title is an assertion', () => {
    const found = assertions(
      fidelityDefects(source({ title: 'Budget Hearing' }), delivered({ title: 'Something Else' })),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.detail).toMatch(/title/i);
  });

  it('supplying a title the source never had is not judged here', () => {
    // `TitleOutcome` already records exactly where a title came from, and
    // `titleFromFilename` refuses junk names. Re-deciding it from counts would
    // be a second, weaker opinion about a question already answered honestly.
    expect(fidelityDefects(source({ title: null }), delivered({ title: 'Budget Hearing' }))).toEqual([]);
  });

  it('whitespace-only differences are not a defect', () => {
    expect(
      fidelityDefects(source({ title: 'Budget  Hearing' }), delivered({ title: 'Budget Hearing ' })),
    ).toEqual([]);
  });
});

describe('readings that cannot decide anything', () => {
  it('an unreadable source produces no defects at all', () => {
    // Not verified is not clean, and it is also not a defect. The caller
    // renders the absence; the comparator refuses to invent a verdict.
    expect(fidelityDefects({ readable: false }, delivered({ headings: ['H1', 'H2', 'H3'] }))).toEqual([]);
  });

  it('an engine-derived reading never raises an assertion, however bad the mismatch', () => {
    // A weaker oracle may inform, never gate. LibreOffice's reading of a legacy
    // `.doc` grades the export half only, and letting it refuse a delivery
    // means a second-hand reading blocking a sound document.
    //
    // `[V]` r09 is exactly this: a `.doc` whose only graphic is a drawn
    // `draw:custom-shape`, so the flat ODF names no image while the export
    // tags one honest `/Figure`. Gating would have refused the document for
    // the pipeline being right.
    const found = fidelityDefects(
      source({ oracle: 'engine-derived', language: null, title: 'A Title' }),
      delivered({ lang: 'en-US', title: 'Something Else' }),
    );
    expect(found.length).toBeGreaterThan(0);
    expect(assertions(found)).toEqual([]);
    expect(found.every((d) => d.oracle === 'engine-derived')).toBe(true);
    // A weaker oracle's would-be assertion lands as `unverified`, not as an
    // omission: nothing was lost, we simply cannot vouch for the difference.
    expect(unverified(found).length).toBeGreaterThan(0);
  });

  it('the same mismatch on an OOXML reading does assert', () => {
    // The control for the case above: the rule is about the oracle, not about
    // the comparator having gone quiet. Uses a row that still gates — figures
    // deliberately no longer do.
    const found = fidelityDefects(
      source({ oracle: 'ooxml', language: null }),
      delivered({ lang: 'en-US' }),
    );
    expect(assertions(found)).toHaveLength(1);
  });

  it('an engine-derived reading still compares, and every defect says so', () => {
    // `.doc` has no XML to read, so LibreOffice supplies the reference. The
    // comparison is worth less and must not silently look like source truth.
    const found = fidelityDefects(
      source({ oracle: 'engine-derived', headings: 2, headingLevels: [1, 2] }),
      delivered({ headings: ['H1'] }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.oracle).toBe('engine-derived');
  });

  it('a provenance with no source reading at all reports not-verified, never clean', () => {
    // A row stored before this instrument existed carries no `sourceTruth`.
    // Absent and unreadable mean the same thing here — nothing was compared —
    // and neither may render as a match.
    expect(checkFidelity(undefined, delivered({ headings: ['H1'] }))).toEqual({
      checked: false,
      reason: 'source-unreadable',
    });
  });

  it('reports the oracle on a checked verdict, so a weaker reading is never mistaken for a stronger one', () => {
    const verdict = checkFidelity(source({ oracle: 'engine-derived' }), delivered());
    expect(verdict).toEqual({ checked: true, oracle: 'engine-derived', defects: [] });
  });

  it('a structure predating a field degrades rather than throwing', () => {
    const stale = delivered();
    // @ts-expect-error deliberately removing a field a stored reading may lack
    delete stale.lists;
    expect(() => fidelityDefects(source({ listItems: 3 }), stale)).not.toThrow();
  });
});

describe('the whole-document verdict', () => {
  it('a faithful conversion produces nothing', () => {
    expect(
      fidelityDefects(
        source({
          headings: 2,
          headingLevels: [1, 2],
          tables: 1,
          listItems: 4,
          figures: 1,
          figuresWithAlt: 1,
        }),
        delivered({
          headings: ['H1', 'H2'],
          tables: [table()],
          lists: [{ depth: 1, items: 4 }],
          figures: [fig({ alt: 'described' })],
        }),
      ),
    ).toEqual([]);
  });

  it('reports every independent defect, not just the first', () => {
    // A language invented still gates; headings lost and figures over-read do
    // not. One call, both kinds, which is the property under test.
    const found = fidelityDefects(
      source({ headings: 2, headingLevels: [1, 2], language: null, figures: 1 }),
      delivered({ headings: ['H1'], lang: 'en-US', figures: [fig(), fig()] }),
    );
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(assertions(found).length).toBeGreaterThanOrEqual(1);
    expect(omissions(found).length + unverified(found).length).toBeGreaterThanOrEqual(2);
  });

  it('names a WCAG criterion on every defect, so each lines up with the gap vocabulary', () => {
    const found = fidelityDefects(
      source({ headings: 2, headingLevels: [1, 2], figures: 1, figuresWithAlt: 1, language: 'en' }),
      delivered({ headings: [], figures: [], lang: null }),
    );
    expect(found.length).toBeGreaterThan(0);
    for (const defect of found) {
      expect(defect.criterion).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

/* ---------------------------------------------------------------- helpers */

function table(): DocumentStructure['tables'][number] {
  return { th: 0, td: 2, tr: 1, cells: [] };
}

function fig(over: Partial<DocumentStructure['figures'][number]> = {}): DocumentStructure['figures'][number] {
  // `page` became required on a figure after this helper was written. Null is
  // "the reading did not place it", which is what these cases mean — none of
  // them is about where a figure sits.
  return { type: 'Figure', alt: null, actualText: null, page: null, ...over };
}
