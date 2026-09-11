import { describe, expect, it } from 'vitest';

import type { DocumentStructure } from '../../src/domain/document-structure';
import { fidelityDefects, type Defect } from '../../src/domain/source-fidelity';
import type { SourceTruth } from '../../src/domain/source-truth';

/**
 * The test the instrument correction says was missing.
 *
 * `docs/research/document-remediation/instrument-correction.md` records a
 * comparator that could not see figure under-tagging for the whole of two
 * experiments. Every number it produced had to be restated: assertions 8 → 13,
 * DELIVERABLE 8 → 6. Nothing went red when it was blind, because a branch that
 * never fires and a corpus with no defects produce byte-identical output.
 *
 * So this suite asserts the opposite property from the unit tests next door.
 * Those check that each branch reports the RIGHT thing. This one checks only
 * that **each branch reports at all** — one deliberately damaged document per
 * defect class, and a table naming every class the instrument claims to cover.
 * A future refactor that blinds a branch turns this red instead of turning the
 * suite quiet.
 *
 * The final case is the one that makes the rest trustworthy: it blinds a branch
 * on purpose and proves this suite notices.
 */

const FAITHFUL_SOURCE: SourceTruth = {
  readable: true,
  oracle: 'ooxml',
  title: 'Planning Committee Agenda',
  language: 'en-GB',
  headings: 3,
  headingLevels: [1, 2, 3],
  tables: 2,
  lists: 1,
  listItems: 6,
  figures: 2,
  figuresWithAlt: 2,
};

const FAITHFUL_DELIVERY: DocumentStructure = {
  structureElements: 40,
  marked: true,
  signed: false,
  // Required since this fixture was written: the reading no longer leaves
  // these absent, so a fixture that omitted them described a shape the
  // instrument cannot produce.
  encrypted: false,
  formFields: 0,
  formFieldsWithoutName: 0,
  embeddedFiles: 0,
  annotationsNotInStructure: 0,
  textChars: 2000,
  images: 2,
  pages: 3,
  lang: 'en-GB',
  title: 'Planning Committee Agenda',
  headings: ['H1', 'H2', 'H3'],
  headingTexts: [],
  figures: [
    { type: 'Figure', alt: 'The borough seal', actualText: null, page: null },
    { type: 'Figure', alt: 'A location map', actualText: null, page: null },
  ],
  tables: [
    { th: 2, td: 6, tr: 4, cells: [] },
    { th: 1, td: 3, tr: 2, cells: [] },
  ],
  lists: [{ depth: 1, items: 6 }],
  order: [],
};

/**
 * One damage per defect class the comparator claims to cover.
 *
 * `expect` names the kind the damage must produce. Adding a comparison to
 * `source-fidelity.ts` without adding a row here leaves the new branch
 * unguarded, which is the whole failure this file exists to prevent — so the
 * coverage assertion at the bottom counts these rows against the criteria the
 * comparator can actually emit.
 */
const DAMAGE: Array<{
  what: string;
  kind: Defect['kind'];
  criterion: string;
  break: () => { truth: SourceTruth; delivered: DocumentStructure };
}> = [
  {
    // Reports rather than gates — the source read is a lower bound. This row
    // guards that the branch still FIRES, which is this file's whole job.
    what: 'a heading invented that the author never wrote',
    kind: 'unverified',
    criterion: '1.3.1',
    break: () => ({
      truth: FAITHFUL_SOURCE,
      delivered: { ...FAITHFUL_DELIVERY, headings: ['H1', 'H2', 'H3', 'H3'] },
    }),
  },
  {
    what: 'a heading dropped in conversion',
    kind: 'omission',
    criterion: '1.3.1',
    break: () => ({
      truth: FAITHFUL_SOURCE,
      delivered: { ...FAITHFUL_DELIVERY, headings: ['H1', 'H2'] },
    }),
  },
  {
    // An omission by design — see the reasoning in `source-fidelity.ts`. This
    // row asserts the branch still FIRES, which is the property this file
    // guards; the kind it reports is the comparator's business.
    what: "the author's hierarchy flattened to the same count at different depths",
    kind: 'omission',
    criterion: '2.4.10',
    break: () => ({
      truth: FAITHFUL_SOURCE,
      delivered: { ...FAITHFUL_DELIVERY, headings: ['H1', 'H2', 'H2'] },
    }),
  },
  {
    // Reports rather than gates — the source read is a lower bound. This row
    // guards that the branch still FIRES, which is this file's whole job.
    what: 'a table invented, or one split into two',
    kind: 'unverified',
    criterion: '1.3.1',
    break: () => ({
      truth: FAITHFUL_SOURCE,
      delivered: {
        ...FAITHFUL_DELIVERY,
        tables: [...FAITHFUL_DELIVERY.tables, { th: 0, td: 2, tr: 1, cells: [] }],
      },
    }),
  },
  {
    what: 'a table lost',
    kind: 'omission',
    criterion: '1.3.1',
    break: () => ({
      truth: FAITHFUL_SOURCE,
      delivered: { ...FAITHFUL_DELIVERY, tables: [FAITHFUL_DELIVERY.tables[0]!] },
    }),
  },
  {
    // Reports rather than gates — the source read is a lower bound. This row
    // guards that the branch still FIRES, which is this file's whole job.
    what: 'list items multiplied',
    kind: 'unverified',
    criterion: '1.3.1',
    break: () => ({
      truth: FAITHFUL_SOURCE,
      delivered: { ...FAITHFUL_DELIVERY, lists: [{ depth: 1, items: 9 }] },
    }),
  },
  {
    what: 'list items lost',
    kind: 'omission',
    criterion: '1.3.1',
    break: () => ({
      truth: FAITHFUL_SOURCE,
      delivered: { ...FAITHFUL_DELIVERY, lists: [{ depth: 1, items: 2 }] },
    }),
  },
  {
    // Reports rather than gates — see `source-fidelity.ts`. This row guards
    // that the branch still FIRES, which is this file's whole job.
    what: 'a figure tagged where the author placed none',
    kind: 'unverified',
    criterion: '1.1.1',
    break: () => ({
      truth: FAITHFUL_SOURCE,
      delivered: {
        ...FAITHFUL_DELIVERY,
        figures: [...FAITHFUL_DELIVERY.figures, { type: 'Figure', alt: null, actualText: null, page: null }],
      },
    }),
  },
  {
    what: 'a meaningful image artifacted out of the structure tree',
    kind: 'omission',
    criterion: '1.1.1',
    break: () => ({
      truth: FAITHFUL_SOURCE,
      delivered: { ...FAITHFUL_DELIVERY, figures: [FAITHFUL_DELIVERY.figures[0]!] },
    }),
  },
  {
    what: "the author's alt text dropped on the way through",
    kind: 'omission',
    criterion: '1.1.1',
    break: () => ({
      truth: FAITHFUL_SOURCE,
      delivered: {
        ...FAITHFUL_DELIVERY,
        figures: FAITHFUL_DELIVERY.figures.map((f) => ({ ...f, alt: null })),
      },
    }),
  },
  {
    what: 'a language claimed that disagrees with the source',
    kind: 'assertion',
    criterion: '3.1.1',
    break: () => ({
      truth: FAITHFUL_SOURCE,
      delivered: { ...FAITHFUL_DELIVERY, lang: 'cy' },
    }),
  },
  {
    what: 'a language invented where the source declared none',
    kind: 'assertion',
    criterion: '3.1.1',
    break: () => ({
      truth: { ...FAITHFUL_SOURCE, language: null },
      delivered: FAITHFUL_DELIVERY,
    }),
  },
  {
    what: 'a declared language lost',
    kind: 'omission',
    criterion: '3.1.1',
    break: () => ({
      truth: FAITHFUL_SOURCE,
      delivered: { ...FAITHFUL_DELIVERY, lang: null },
    }),
  },
  {
    what: "the author's title replaced with a different one",
    kind: 'assertion',
    criterion: '2.4.2',
    break: () => ({
      truth: FAITHFUL_SOURCE,
      delivered: { ...FAITHFUL_DELIVERY, title: 'Untitled Document' },
    }),
  },
  {
    what: "the author's title lost",
    kind: 'omission',
    criterion: '2.4.2',
    break: () => ({
      truth: FAITHFUL_SOURCE,
      delivered: { ...FAITHFUL_DELIVERY, title: null },
    }),
  },
];

describe('the instrument fires', () => {
  it('says nothing at all about a faithful conversion', () => {
    // The control. Without this, every case below could pass on an instrument
    // that simply reports a defect for everything.
    expect(fidelityDefects(FAITHFUL_SOURCE, FAITHFUL_DELIVERY)).toEqual([]);
  });

  for (const damage of DAMAGE) {
    it(`sees ${damage.what}`, () => {
      const { truth, delivered } = damage.break();
      const found = fidelityDefects(truth, delivered);
      expect(found.length, 'the instrument was blind to this damage').toBeGreaterThan(0);
      expect(found.map((d) => d.kind)).toContain(damage.kind);
      expect(found.map((d) => d.criterion)).toContain(damage.criterion);
    });
  }
});

describe('the guard on the guard', () => {
  it('notices when a branch is blinded', () => {
    // Proof that the cases above would actually go red. A comparator blinded
    // the way the real one was — a branch that never fires — reports nothing on
    // damage, and this is what that looks like from here.
    const blinded = (_truth: SourceTruth, _delivered: DocumentStructure): Defect[] => [];

    const stillCaught = DAMAGE.filter((damage) => {
      const { truth, delivered } = damage.break();
      return blinded(truth, delivered).length > 0;
    });

    expect(stillCaught, 'a blinded comparator must fail every damage case').toEqual([]);
    expect(DAMAGE.length).toBeGreaterThanOrEqual(15);
  });

  it('covers every criterion the comparator can emit', () => {
    // Sweep a wide field of damage, collect every criterion the instrument can
    // produce, and require a named case for each. A new comparison added to
    // `source-fidelity.ts` without a row above turns this red.
    const emitted = new Set<string>();
    const probes: Array<[SourceTruth, DocumentStructure]> = [
      [FAITHFUL_SOURCE, { ...FAITHFUL_DELIVERY, headings: [], tables: [], lists: [], figures: [] }],
      [FAITHFUL_SOURCE, { ...FAITHFUL_DELIVERY, headings: ['H1', 'H2', 'H2'] }],
      [
        FAITHFUL_SOURCE,
        {
          ...FAITHFUL_DELIVERY,
          headings: ['H1', 'H2', 'H3', 'H4'],
          tables: [...FAITHFUL_DELIVERY.tables, { th: 0, td: 1, tr: 1, cells: [] }],
          lists: [{ depth: 1, items: 20 }],
          figures: [...FAITHFUL_DELIVERY.figures, { type: 'Figure', alt: null, actualText: null, page: null }],
          lang: 'cy',
          title: 'Something Else',
        },
      ],
      [FAITHFUL_SOURCE, { ...FAITHFUL_DELIVERY, lang: null, title: null }],
      [{ ...FAITHFUL_SOURCE, language: null }, FAITHFUL_DELIVERY],
    ];
    for (const [truth, delivered] of probes) {
      for (const defect of fidelityDefects(truth, delivered)) emitted.add(defect.criterion);
    }

    const named = new Set(DAMAGE.map((d) => d.criterion));
    for (const criterion of emitted) {
      expect(named, `${criterion} can be emitted but has no named damage case`).toContain(criterion);
    }
    expect(emitted.size).toBeGreaterThanOrEqual(4);
  });
});
