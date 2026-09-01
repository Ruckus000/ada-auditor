import { describe, expect, it } from 'vitest';

import {
  isWordDocument,
  logSafe,
  summarise,
  withConformance,
  withContrast,
  CHECKED_CRITERIA,
  NOT_CHECKED_CRITERIA,
  SUMMARY_HEADER_BUDGET,
  boundSummary,
  isPlaceholderAlt,
  undescribedFigures,
  isPlaceholderTitle,
  titleFromFilename,
  type ConversionProvenance,
  type RemediationSummary,
} from '../../src/domain/document-remediation';
import { documentStructureSchema } from '../../src/domain/document-structure';

const structure = (over = {}) =>
  documentStructureSchema.parse({
    marked: true,
    signed: false,
    encrypted: false,
    annotationsNotInStructure: 0,
    formFields: 0,
    formFieldsWithoutName: 0,
    embeddedFiles: 0,
    structureElements: 40,
    textChars: 1200,
    images: 0,
    pages: 2,
    lang: 'en-GB',
    title: 'Planning Committee Agenda',
    headings: ['H1', 'H2'],
    headingTexts: [{ level: 'H1', text: 'Planning Committee Agenda' }],
    figures: [],
    tables: [],
    lists: [{ depth: 1, items: 2 }],
    order: [{ type: 'H1', text: 'Planning Committee Agenda' }],
    ...over,
  });

/**
 * What `summarise` alone claims: everything its two emitters can decide.
 *
 * 1.4.3 is not among them. The contrast pass is a separate stage that may not
 * run, so the criterion joins the scope in `withContrast` and nowhere else.
 */
const SUMMARISE_CRITERIA = CHECKED_CRITERIA.filter((c) => c !== '1.4.3');

/** A reading that measured contrast and found nothing wrong. */
const CLEAN_CONTRAST = {
  pairs: 4, passing: 4, failing: 0, failingGlyphs: 0,
  undetermined: 0, undeterminedGlyphs: 0, decorative: 0, decorativeGlyphs: 0,
  findings: [],
};

const provenance = (over: Partial<ConversionProvenance> = {}): ConversionProvenance => ({
  title: { kind: 'already-titled', title: 'Planning Committee Agenda' },
  sourceLanguage: 'en-GB',
  structure: structure(),
  ...over,
});

describe('summarise', () => {
  it('reports counts and outcomes, never the document text', () => {
    const summary = summarise(provenance());

    expect(summary).toEqual({
      title: 'already-titled',
      titleText: 'Planning Committee Agenda',
      sourceLanguage: 'en-GB',
      tagged: true,
      pages: 2,
      headings: 2,
      tables: 0,
      lists: 1,
      figures: 0,
      gaps: [],
      // What the reading looked for, travelling with it. An exact match, so a
      // criterion silently entering or leaving the instrument's scope fails
      // here as well as in the emitted-criteria test below. 1.4.3 is absent
      // because the contrast pass is a separate stage and has not run: it
      // joins in `withContrast`, never here.
      scope: { criteria: SUMMARISE_CRITERIA },
    });

    // The body text of the document appears nowhere. `headingTexts` and
    // `order` carry it and must not leak through here.
    expect(JSON.stringify(summary)).not.toContain('order');
  });

  it('has no gaps when the source supplied everything', () => {
    expect(summarise(provenance()).gaps).toEqual([]);
  });

  it('names a missing title with its criterion', () => {
    const summary = summarise(
      provenance({ title: { kind: 'no-heading-to-copy' }, structure: structure({ title: null }) }),
    );

    expect(summary.title).toBe('no-heading-to-copy');
    // No title text at all, rather than an empty string that reads like one.
    expect(summary.titleText).toBeUndefined();
    expect(summary.gaps).toContainEqual(expect.stringContaining('2.4.2'));
  });

  it('names an undeclared language as a deliberate omission', () => {
    // Not "we failed to set it" — the exporter's `en-US` guess was removed. The
    // gap is honest and visible; the guess would have been invisible.
    const summary = summarise(provenance({ sourceLanguage: null }));

    expect(summary.sourceLanguage).toBeNull();
    expect(summary.gaps).toContainEqual(expect.stringContaining('3.1.1'));
  });

  it('counts only figures with ABSENT alt, not empty alt', () => {
    // Empty alt is a positive claim that the graphic carries no meaning; absent
    // alt is an unanswered question. Only the second is a gap, and collapsing
    // them is how a document lost four meaningful images and scored clean.
    const summary = summarise(
      provenance({
        structure: structure({
          figures: [
            { type: 'Figure', alt: null, actualText: null , page: null},
            { type: 'Figure', alt: '', actualText: null , page: null},
            { type: 'Figure', alt: 'A site map', actualText: null , page: null},
          ],
          images: 3,
        }),
      }),
    );

    expect(summary.figures).toBe(3);
    expect(summary.gaps).toContainEqual('1.1.1: 1 figure with no alt text');
  });

  it('pluralises the figure gap', () => {
    const summary = summarise(
      provenance({
        structure: structure({
          figures: [
            { type: 'Figure', alt: null, actualText: null , page: null},
            { type: 'Figure', alt: null, actualText: null , page: null},
          ],
          images: 2,
        }),
      }),
    );

    expect(summary.gaps).toContainEqual('1.1.1: 2 figures with no alt text');
  });

  it('reports an untagged output as a structural gap', () => {
    const summary = summarise(provenance({ structure: structure({ structureElements: 0 }) }));

    expect(summary.tagged).toBe(false);
    expect(summary.gaps).toContainEqual(expect.stringContaining('1.3.1'));
  });
});

describe('logSafe', () => {
  it('drops the title, keeping everything else', () => {
    // A response may echo the title — the caller uploaded the file. A log line
    // persists and travels, so it may not.
    const summary = summarise(provenance());
    const safe = logSafe(summary);

    expect('titleText' in safe).toBe(false);
    expect(JSON.stringify(safe)).not.toContain('Planning Committee Agenda');
    expect(safe.title).toBe('already-titled');
    expect(safe.pages).toBe(2);
  });
});

describe('isWordDocument', () => {
  /** A ZIP local header followed by the OOXML part names, as a real .docx has. */
  function docxLike(): Uint8Array {
    const names = Buffer.from('[Content_Types].xml....word/document.xml', 'latin1');
    return new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...names]);
  }

  it('accepts a ZIP carrying the OOXML word parts', () => {
    expect(isWordDocument(docxLike())).toEqual({ ok: true, kind: 'docx' });
  });

  it('accepts a legacy OLE .doc', () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    expect(isWordDocument(ole)).toEqual({ ok: true, kind: 'doc' });
  });

  it('refuses a text file, whatever it is named', () => {
    // The measured case: LibreOffice converts this happily, so the gate has to
    // be here or a text file becomes a "remediated" PDF.
    const text = new Uint8Array(Buffer.from('this is not a Word file', 'latin1'));
    const result = isWordDocument(text);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/not a Word document/);
  });

  it('refuses a ZIP that is not OOXML', () => {
    // .xlsx, .pptx, .odt and a plain archive all start `PK\x03\x04`. The magic
    // number alone is not the check.
    const zip = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      ...Buffer.from('[Content_Types].xml....xl/workbook.xml', 'latin1'),
    ]);
    const result = isWordDocument(zip);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/without the OOXML/);
  });

  it('refuses an empty upload', () => {
    const result = isWordDocument(new Uint8Array());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/empty/);
  });

  it('does not scan the whole buffer looking for part names', () => {
    // The names live in the first local headers. A 25MB file whose only mention
    // of `word/` is at the end is not a .docx, and scanning for it would mean
    // reading 25MB to reject something already known to be wrong.
    const far = new Uint8Array(20_000);
    far.set([0x50, 0x4b, 0x03, 0x04], 0);
    far.set(Buffer.from('[Content_Types].xml word/document.xml', 'latin1'), 15_000);

    expect(isWordDocument(far).ok).toBe(false);
  });
});

describe('titleFromFilename', () => {
  it('turns a descriptive municipal filename into its own title', () => {
    // `[V]` The shape of all nine real 2.4.2-blocked documents.
    expect(titleFromFilename('Conflict_of_Interest_Law_for_Municipal_Employees.docx')).toBe(
      'Conflict of Interest Law for Municipal Employees',
    );
    expect(titleFromFilename('Open_Space_Comm_2026-1-26_approved_minutes.docx')).toBe(
      'Open Space Comm 2026 1 26 approved minutes',
    );
    expect(titleFromFilename('BoardOfHealthAgenda.docx')).toBe('Board Of Health Agenda');
  });

  it('refuses junk names, keeping the honest gap', () => {
    // A bad derived title is worse than a reported absence.
    for (const junk of [
      'doc1.docx', 'Document.docx', 'untitled.docx', 'final_v2.doc', 'scan0001.docx',
      'IMG_4302.docx', 'copy of copy.docx', 'temp.docx', 'draft.doc', '20260827.docx',
      'r03.docx', 'a.docx',
    ]) {
      expect(titleFromFilename(junk), junk).toBeNull();
    }
  });

  it('caps length and strips control characters — the upload name is caller input', () => {
    const derived = titleFromFilename('Fee\u0007Schedule_' + 'x'.repeat(400) + '.docx');
    expect(derived).not.toContain('\u0007');
    expect(derived!.length).toBeLessThanOrEqual(200);
  });
});

describe('the punch list', () => {
  const structure = (over: object) =>
    documentStructureSchema.parse({
      marked: true,
      signed: false,
      encrypted: false,
      annotationsNotInStructure: 0,
      formFields: 0,
      formFieldsWithoutName: 0,
      embeddedFiles: 0,
      structureElements: 10, textChars: 100, images: 0, pages: 1, lang: 'en',
      title: 'T', headings: [], headingTexts: [], figures: [], tables: [], lists: [], order: [],
      ...over,
    });
  const provenance = (over: object) => ({
    title: { kind: 'already-titled' as const, title: 'T' },
    sourceLanguage: 'en',
    structure: structure(over),
  });

  it('names each undescribed figure as one actionable item', () => {
    const s = summarise(provenance({
      figures: [
        { type: 'Figure', alt: null, actualText: null , page: null},
        { type: 'Figure', alt: 'described', actualText: null , page: null},
        { type: 'Figure', alt: null, actualText: null , page: null},
      ],
      images: 3,
    }));
    expect(s.needs?.map((n) => n.criterion)).toEqual(['1.1.1', '1.1.1']);
    expect(s.needs?.[0].item).toContain('Figure 1');
    expect(s.needs?.[1].item).toContain('Figure 3');
  });

  it('names a heading-level skip as a decision, not a fix', () => {
    const s = summarise(provenance({ headings: ['H1', 'H3'] }));
    expect(s.needs).toEqual([
      { criterion: '2.4.10', item: 'Heading levels skip from H1 to H3 — decide whether the author meant an H2' },
    ]);
  });

  it('names a document that starts below H1 as the same decision family', () => {
    // r13's shape: nine headings, none of them H1. Not a skip between
    // consecutive headings, so version 2 delivered it with an empty punch
    // list while veraPDF failed it on 7.4.2 — a silent gap, the exact thing
    // the promise forbids.
    const s = summarise(provenance({ headings: ['H2', 'H3', 'H2'] }));
    expect(s.needs).toEqual([
      {
        criterion: '2.4.10',
        item: 'Heading levels start at H2 — decide whether the document should begin at an H1',
      },
    ]);
  });

  it('names both the deep start and a later skip, once each', () => {
    const s = summarise(provenance({ headings: ['H3', 'H3', 'H5'] }));
    expect(s.needs?.map((n) => n.item)).toEqual([
      'Heading levels start at H3 — decide whether the document should begin at an H1',
      'Heading levels skip from H3 to H5 — decide whether the author meant an H4',
    ]);
  });

  it('asks for the language when the document declares none', () => {
    const s = summarise({ ...provenance({ headings: ['H1'] }), sourceLanguage: null });
    expect(s.needs).toEqual([
      {
        criterion: '3.1.1',
        item: 'The document declares no language — name the one it is written in, because a language is never guessed',
      },
    ]);
    // The gap states the fact and the item asks for the work. Both, because
    // "so none is claimed" is not something anybody can act on.
    expect(s.gaps.some((g) => g.startsWith('3.1.1'))).toBe(true);
  });

  it('puts the document-level item first, ahead of per-element ones', () => {
    const s = summarise({
      ...provenance({ figures: [{ type: 'Figure', alt: null, actualText: null , page: null}], images: 1 }),
      sourceLanguage: null,
    });
    expect(s.needs?.map((n) => n.criterion)).toEqual(['3.1.1', '1.1.1']);
  });

  it('says nothing about language when the document declares one', () => {
    const s = summarise({ ...provenance({ headings: ['H1'] }), sourceLanguage: 'cy-GB' });
    expect('needs' in s).toBe(false);
  });

  it('names form fields and links that sit outside the structure', () => {
    const s = summarise(provenance({ annotationsNotInStructure: 7 }));
    expect(s.needs?.[0].criterion).toBe('1.3.1');
    expect(s.needs?.[0].item).toContain('7 form fields or links sit outside');
    expect(s.needs?.[0].item).toContain('reading order');
  });

  it('reads as singular for one, because a punch list is read by a person', () => {
    const s = summarise(provenance({ annotationsNotInStructure: 1 }));
    expect(s.needs?.[0].item).toContain('1 form field or link');
    expect(s.needs?.[0].item).not.toContain('fields');
  });

  it('carries a count and never the document own content', () => {
    // The item renders on the client's public shared page. Counts and
    // outcomes only, which is the standing rule for everything leaving here.
    const s = summarise(
      provenance({
        annotationsNotInStructure: 2,
        formFields: 0,
        formFieldsWithoutName: 0,
        embeddedFiles: 0,
        headings: ['H1'],
        headingTexts: [{ level: 'H1', text: 'Ratepayer Jane Doe of 14 Mill Lane' }],
      }),
    );
    expect(s.needs?.[0].item).not.toContain('Jane Doe');
    expect(s.needs?.[0].item).toContain('2 form fields');
  });

  it('is absent, never empty, when nothing needs a person', () => {
    const s = summarise(provenance({ headings: ['H1', 'H2'] }));
    expect('needs' in s).toBe(false);
  });
});


describe('withConformance', () => {
  const base = summarise({
    title: { kind: 'already-titled' as const, title: 'T' },
    sourceLanguage: 'en',
    structure: {
      structureElements: 10,
      marked: true,
      signed: false,
      encrypted: false,
      annotationsNotInStructure: 0,
      formFields: 0,
      formFieldsWithoutName: 0,
      embeddedFiles: 0,
      textChars: 100,
      images: 0,
      pages: 1,
      lang: 'en',
      title: 'T',
      headings: ['H1'],
      headingTexts: [{ level: 'H1', text: 'T' }],
      figures: [],
      tables: [],
      lists: [],
      order: [],
    },
  });

  it('carries a compliant verdict and adds no work', () => {
    const s = withConformance(base, { checker: 'verapdf-ua1', compliant: true });
    expect(s.conformance).toEqual({ checker: 'verapdf-ua1', compliant: true });
    expect('needs' in s).toBe(false);
  });

  it('translates a font that was never embedded into the work that fixes it', () => {
    const s = withConformance(base, {
      checker: 'verapdf-ua1',
      compliant: false,
      failingClauses: ['7.21.4.1-1'],
    });
    expect(s.needs).toHaveLength(1);
    expect(s.needs?.[0].criterion).toBe('PDF/UA 7.21.4');
    // The remedy is the source, which pairing already surfaces — never a
    // silent substitution.
    expect(s.needs?.[0].item).toContain('Word source');
  });

  it('does not tell a document with embedded fonts that its fonts are missing', () => {
    // The defect: `7.21.4` was matched as a FAMILY and always printed the
    // never-embedded sentence. Its two members say opposite things —
    // `7.21.4.1` is a font with no data, `7.21.4.2` is an embedded font whose
    // CIDSet does not list every character used.
    //
    // Latent rather than shipped, and worth stating precisely: 13 documents
    // fail only `7.21.4.2-2` in the KEYS, but `[V]` all 52 delivered documents
    // carrying a `7.21.4` clause carry `7.21.4.1-1` and none carries
    // `7.21.4.2` — `stripCidSets` removes the CIDSet before delivery. The path
    // that reaches this is a font that pass cannot read, which has not
    // happened in 148 documents. The sentence would still be false when it
    // did.
    const s = withConformance(base, {
      checker: 'verapdf-ua1',
      compliant: false,
      failingClauses: ['7.21.4.2-2'],
    });
    expect(s.needs).toHaveLength(1);
    expect(s.needs?.[0].criterion).toBe('PDF/UA 7.21.4');
    expect(s.needs?.[0].item).toContain('CIDSet');
    expect(s.needs?.[0].item).not.toContain('never embedded');
  });

  it('says both things when a document has both problems', () => {
    const s = withConformance(base, {
      checker: 'verapdf-ua1',
      compliant: false,
      failingClauses: ['7.21.4.1-1', '7.21.4.2-2'],
    });
    // Two items, because they are two different defects with two different
    // remedies. They share the family criterion, which is what `score.ts`
    // accounts for the clauses by.
    expect(s.needs).toHaveLength(2);
    expect(s.needs?.every((n) => n.criterion === 'PDF/UA 7.21.4')).toBe(true);
  });

  it('names an unrecognised member of the font family by id rather than describing it', () => {
    // A family is not a licence to guess. A clause this vocabulary has never
    // seen must not inherit either sentence just because its prefix is known.
    const s = withConformance(base, {
      checker: 'verapdf-ua1',
      compliant: false,
      failingClauses: ['7.21.4.3-9'],
    });
    expect(s.needs).toHaveLength(1);
    expect(s.needs?.[0].item).toContain('7.21.4.3-9');
    expect(s.needs?.[0].item).not.toContain('never embedded');
  });

  it('translates untagged page content without offering to guess it', () => {
    const s = withConformance(base, {
      checker: 'verapdf-ua1',
      compliant: false,
      failingClauses: ['7.1-3'],
    });
    expect(s.needs?.[0].criterion).toBe('PDF/UA 7.1-3');
    expect(s.needs?.[0].item).toContain('inventing');
  });

  it('rolls everything unrecognized into a catch-all — no clause is ever silent', () => {
    const s = withConformance(base, {
      checker: 'verapdf-ua1',
      compliant: false,
      failingClauses: ['7.18.4-1', '6.2-1'],
    });
    // `base` voices no annotation item, so 7.18.4-1 is named here too: a
    // clause is only left to one of our items when that item is present.
    expect(s.needs).toHaveLength(1);
    expect(s.needs?.[0].item).toContain('2 further PDF/UA checks fail');
    expect(s.needs?.[0].item).toContain('6.2-1');
    expect(s.needs?.[0].item).toContain('7.18.4-1');
  });

  it('says the missing identifier is correct, and asks for no work', () => {
    // The catch-all would have said "a person must review 5-1" — telling the
    // client to add back the conformance claim this document is not entitled
    // to make. The clause is still reported as failing, because it is.
    const s = withConformance(base, {
      checker: 'verapdf-ua1',
      compliant: false,
      failingClauses: ['5-1', '6.2-1'],
    });
    const identifier = s.needs?.find((n) => n.criterion === 'PDF/UA 5-1');

    expect(identifier?.item).toContain('No PDF/UA-1 conformance identifier is written');
    expect(identifier?.item).toContain('needs no action');
    // Self-contained, because the public report renders punch items without
    // their criterion label — an item that leaned on "PDF/UA 5-1:" trailed off
    // mid-sentence there, under a heading that called it work.
    expect(identifier?.item.trim().endsWith('.')).toBe(true);
    // It states the file's state and never who chose it. `withConformance` also
    // runs on the INSPECTION path, over a client's own document that we neither
    // wrote nor decided anything about; claiming we withheld the identifier
    // there would be a statement about provenance nobody checked.
    expect(identifier?.item).not.toMatch(/deliberate|we |withheld/i);
    // Still counted as failing by the checker, and still carried in the verdict.
    expect(s.conformance).toEqual({
      checker: 'verapdf-ua1',
      compliant: false,
      failingClauses: ['5-1', '6.2-1'],
    });
    // And it never lands in the catch-all as work.
    const catchAll = s.needs?.find((n) => n.criterion === 'PDF/UA');
    expect(catchAll?.item).not.toContain('5-1');
  });

  it('leaves clauses our own vocabulary already voices to the items that voice them', () => {
    // Language (7.2.*), figures (7.3), headings (7.4), title (7.1-9) and a form
    // field's name (7.18.1-3) each have a gap or item of their own; repeating
    // them through the checker would say everything twice. Each one has to
    // actually BE there, which is what this fixture supplies.
    //
    // The 7.18 clause here is `7.18.1-3` and NOT `7.18.5-2`, which this fixture
    // used to carry. A link with no `/Contents` is not what the annotation
    // item says — it says a reader cannot REACH the annotation — so routing the
    // 7.18 family whole let one item silence four unrelated clauses.
    const voiced: RemediationSummary = {
      ...base,
      gaps: ['2.4.2: no title, and no heading to copy one from'],
      needs: [
        { criterion: '3.1.1', item: 'name the language it is written in' },
        { criterion: '1.1.1', item: 'Figure 1 needs a human-written description' },
        { criterion: '2.4.10', item: 'heading levels skip' },
        { criterion: '1.3.1', item: 'a form field sits outside the structure' },
        { criterion: '4.1.2', item: 'a form field has no accessible name' },
      ],
    };
    const s = withConformance(voiced, {
      checker: 'verapdf-ua1',
      compliant: false,
      failingClauses: ['7.2-34', '7.3-1', '7.4.2-1', '7.1-9', '7.18.1-3'],
    });
    // The five items it arrived with, and no catch-all on top of them.
    expect(s.needs).toHaveLength(5);
    expect(s.needs?.some((n) => n.criterion === 'PDF/UA')).toBe(false);
    // But the verdict itself still says the document is not conformant —
    // the floor under every translation decision.
    expect(s.conformance).toMatchObject({ compliant: false });
  });

  it('names a clause whose item is missing rather than assuming it was said', () => {
    // The defect the blind corpus found, as a test. Two real documents came
    // back with no items, no gaps, and `compliant: false` naming 7.18.1-2 and
    // 7.18.5-2 — neither conformant nor punch-listed, which is the one
    // outcome this product promises never to produce. Suppression assumed the
    // annotation item would be there; our counter had found nothing to say,
    // so nothing said it.
    const s = withConformance(base, {
      checker: 'verapdf-ua1',
      compliant: false,
      failingClauses: ['7.18.1-2', '7.18.5-2'],
    });

    expect(s.needs).toHaveLength(1);
    expect(s.needs?.[0].criterion).toBe('PDF/UA');
    expect(s.needs?.[0].item).toContain('7.18.1-2');
    expect(s.needs?.[0].item).toContain('7.18.5-2');
  });

  it('suppresses a clause per family, not per document', () => {
    // A document that voices headings but not annotations suppresses the
    // heading clause and names the annotation one. The old rule dropped both
    // because it never looked at which item was present.
    const s = withConformance(
      { ...base, needs: [{ criterion: '2.4.10', item: 'heading levels skip' }] },
      { checker: 'verapdf-ua1', compliant: false, failingClauses: ['7.4.2-1', '7.18.5-2'] },
    );

    const catchAll = s.needs?.find((n) => n.criterion === 'PDF/UA');
    expect(catchAll?.item).toContain('7.18.5-2');
    expect(catchAll?.item).not.toContain('7.4.2-1');
  });

  it('an absent checker is an answer, never a pass', () => {
    const s = withConformance(base, { checker: 'none', reason: 'unavailable' });
    expect(s.conformance).toEqual({ checker: 'none', reason: 'unavailable' });
    expect('needs' in s).toBe(false);
  });

  it('appends to an existing punch list rather than replacing it', () => {
    const withItem = summarise({
      title: { kind: 'already-titled' as const, title: 'T' },
      sourceLanguage: null,
      structure: {
        structureElements: 10,
        marked: true,
        signed: false,
        encrypted: false,
        annotationsNotInStructure: 0,
        formFields: 0,
        formFieldsWithoutName: 0,
        embeddedFiles: 0,
        textChars: 100,
        images: 0,
        pages: 1,
        lang: null,
        title: 'T',
        headings: [],
        headingTexts: [],
        figures: [],
        tables: [],
        lists: [],
        order: [],
      },
    });
    const s = withConformance(withItem, {
      checker: 'verapdf-ua1',
      compliant: false,
      failingClauses: ['7.21.4.1-1'],
    });
    expect(s.needs?.map((n) => n.criterion)).toEqual(['3.1.1', 'PDF/UA 7.21.4']);
  });
});

describe('documents attached to the document', () => {
  const needs = (over = {}) => summarise(provenance({ structure: structure(over) })).needs ?? [];

  it('says nothing when there are no attachments', () => {
    expect(needs().some((n) => n.criterion === 'PDF/UA 7.11')).toBe(false);
  });

  it('names an attachment nobody examined', () => {
    // The blind corpus planted a tagged cover sheet over an untagged payload
    // and watched it deliver with an empty punch list: no clause fails,
    // because veraPDF validates the outer document and our reading walks the
    // outer structure. Neither instrument opens an attachment.
    const item = needs({ embeddedFiles: 1 }).find((n) => n.criterion === 'PDF/UA 7.11');

    expect(item?.item).toContain('1 document is attached');
    expect(item?.item).toContain('was not examined');
    expect(item?.item).toContain('needs remediating on its own');
  });

  it('pluralises, and counts rather than naming', () => {
    const item = needs({ embeddedFiles: 3 }).find((n) => n.criterion === 'PDF/UA 7.11');

    expect(item?.item).toContain('3 documents are attached');
    expect(item?.item).toContain('were not examined');
    // Counts and outcomes only: this renders on a client's public report, and
    // an attachment's filename is document content.
    expect(item?.item).not.toMatch(/\.(pdf|docx?|xlsx?)/i);
  });

  it('is not a WCAG criterion, because nothing was checked', () => {
    // The annotation item reuses 1.3.1 because the defect is KNOWN. Here the
    // attachment was never opened, so naming a success criterion would assert
    // a failure nobody verified — the invention this product refuses.
    const item = needs({ embeddedFiles: 2 }).find((n) => n.item.includes('attached'));

    expect(item?.criterion).toBe('PDF/UA 7.11');
  });
});

describe('a placeholder is not a title', () => {
  it.each([
    'Microsoft Word - Fee_Schedule.docx',
    'Microsoft Word - Document1',
    'Word - notice.docx',
    'Acrobat: scan_0001.pdf',
  ])('refuses %s on provenance — a producer filled that field, not a person', (title) => {
    expect(isPlaceholderTitle(title)).toBe(true);
  });

  it.each(['Document1.docx', 'untitled', 'scan 0001', 'final v2', 'IMG_2031', 'a', '   '])(
    'refuses %s on the same junk table the filename chain uses',
    (title) => {
      expect(isPlaceholderTitle(title)).toBe(true);
    },
  );

  it.each([
    'Annual Drainage Report',
    'Agenda',
    '2026 Fee Schedule',
    'Word Choice in Municipal Notices',
    'Conflict of Interest Law for Municipal Employees',
  ])('keeps %s, because a policy that eats real titles is worse than the problem', (title) => {
    expect(isPlaceholderTitle(title)).toBe(false);
  });

  it('judges the words, not the spacing around them', () => {
    // The same normalisation `titleFromFilename` does, so a title neither
    // survives nor dies by how it was spaced.
    expect(isPlaceholderTitle('  Untitled  ')).toBe(true);
    expect(isPlaceholderTitle('  Annual Drainage  Report ')).toBe(false);
  });
});

describe('a description that describes nothing', () => {
  // WCAG Technique F30 category 1: placeholder text. Matched WHOLE, never as a
  // prefix — see the "keeps" block below for why that distinction is the whole
  // safety of the rule.
  it.each(['Decorative', 'image', 'PICTURE', 'graphic', 'spacer', 'blank', 'placeholder'])(
    'refuses %s — a placeholder word is not a description (F30)',
    (alt) => {
      expect(isPlaceholderAlt(alt)).toBe(true);
    },
  );

  // F30 category 3: filenames, and the paths they arrive inside. These are the
  // shapes an exporter writes when a person did not.
  it.each([
    '\\\\fileserver\\Design\\Templates\\banner',
    'C:\\Users\\clerk\\Desktop\\seal.png',
    '/Users/clerk/Pictures/logo',
    'file:///tmp/chart',
    'chart_final_v2.png',
    'DSC_0041.JPEG',
  ])('refuses %s on provenance — a machine put that there', (alt) => {
    expect(isPlaceholderAlt(alt)).toBe(true);
  });

  // F30 category 2: programming references, and a mail client's own handle for
  // an inline image.
  it.each(['Picture 3', 'image12', '0001', 'cid:image001.png@01D0A82E'])(
    'refuses %s — a reference to the graphic is not a description of it',
    (alt) => {
      expect(isPlaceholderAlt(alt)).toBe(true);
    },
  );

  // The guard that matters more than every detection above it. A description
  // beginning with a placeholder word is still a description, and a predicate
  // that ate these would be worse than the problem it solves.
  it.each([
    'Image of the north pump house at dusk',
    'Picture of the council chamber, seats empty',
    'Photo showing the east basin after the storm',
    'Graphic comparing 2025 and 2026 permit volumes',
    'County seal',
    'Chart of quarterly permit volumes',
  ])('keeps %s, because a real description is not a placeholder', (alt) => {
    expect(isPlaceholderAlt(alt)).toBe(false);
  });

  it('keeps a two-character CJK description — short is not absent', () => {
    // Deliberately NOT the `length < 3` refusal the title chain uses. This is a
    // real description of a building, and it is two characters.
    expect(isPlaceholderAlt('\u5e81\u820e')).toBe(false);
    expect(isPlaceholderAlt('\u062d\u062f\u064a\u0642\u0629')).toBe(false);
  });

  it('treats a trailing NUL as a terminator, not as content', () => {
    // Three legitimate descriptions in the blind corpus carry one, and one of
    // them is on the only conformant real PDF. Reading the NUL as content
    // flagged all three.
    expect(isPlaceholderAlt('The Ohio State University\u0000')).toBe(false);
    expect(isPlaceholderAlt('Decorative\u0000')).toBe(true);
  });

  it('strips an exporter prefix before judging, as the title chain does', () => {
    expect(isPlaceholderAlt('Description: cid:image001.png@01D0A82E')).toBe(true);
    expect(isPlaceholderAlt('Description: the mayor at the ribbon cutting')).toBe(false);
  });

  it('leaves empty alt alone — that is a claim, not an omission', () => {
    // `document-structure.ts` records why: empty says the graphic carries no
    // meaning. Whether PDF/UA agrees is a separate question, and not this
    // predicate's to decide.
    expect(isPlaceholderAlt('')).toBe(false);
    expect(isPlaceholderAlt('   ')).toBe(false);
  });

  it('bounds the work an untrusted document can set', () => {
    expect(isPlaceholderAlt('x'.repeat(200_000))).toBe(false);
  });
});

describe('figures a reader learns nothing about', () => {
  const figs = (...alts: Array<string | null>) =>
    alts.map((alt) => ({ type: 'Figure', alt, actualText: null , page: null}));
  const read = (...alts: Array<string | null>) =>
    summarise(provenance({ structure: structure({ figures: figs(...alts), images: alts.length }) }));

  it('counts absent and placeholder descriptions as the same work', () => {
    expect(undescribedFigures(figs(null, 'Decorative', 'The north basin', null)))
      .toEqual({ absent: 2, placeholder: 1, total: 3 });
  });

  it('folds both into ONE 1.1.1 gap, because gap identity is the criterion', () => {
    // A second `1.1.1:` gap would collide under `documentGapKey`, and the
    // regression comparator would read one failure as two.
    const alt = read(null, 'Decorative').gaps.filter((line) => line.startsWith('1.1.1:'));

    expect(alt).toHaveLength(1);
    expect(alt[0]).toContain('2 figures');
  });

  it('prints only the sub-counts that are non-zero', () => {
    // A bulk export gives every figure the same placeholder, so absent is zero.
    // Gaps render on a client's report, and "(0 with no alt text, ...)" spends
    // the reader's attention on a clause that says nothing.
    const only = read('Decorative', 'Decorative').gaps.find((g) => g.startsWith('1.1.1:'));

    expect(only).toContain('2 figures whose description is a placeholder');
    expect(only).not.toContain('0 with no alt text');
  });

  it('leaves the wording untouched when nothing new applies', () => {
    // A stored baseline taken before this reading must not read as a changed
    // document just because the instrument grew.
    expect(read(null).gaps).toContain('1.1.1: 1 figure with no alt text');
  });

  it('raises one punch item per figure, whichever way it is undescribed', () => {
    const items = (read(null, 'Decorative', 'A real description').needs ?? [])
      .filter((n) => n.criterion === '1.1.1');

    expect(items).toHaveLength(2);
    expect(items[1].item).toContain('F30');
  });

  it('never quotes the description it is refusing', () => {
    // One of these strings in the wild is a UNC path naming a private host and
    // an internal directory tree, and the punch list renders on a public page.
    const items = read('\\\\192.168.0.8\\Design\\Projects').needs ?? [];

    expect(items).toHaveLength(1);
    expect(items[0].criterion).toBe('1.1.1');
    expect(JSON.stringify(items)).not.toContain('192.168');
  });
});

describe('boundSummary, when the document itself is the problem', () => {
  const measure = (value: unknown) => JSON.stringify(value).length;

  it('trims a title that would cost the client the whole summary', () => {
    // Every punch item can be dropped and the header still be over the limit,
    // because `titleText` is the document's OWN title and has no bounded
    // length. A header over the client's limit is rejected whole — the client
    // gets the file and no summary at all: no counts, no verdict, no punch
    // list. A shortened title beside a complete punch list is strictly better.
    const summary = summarise(provenance({
      title: { kind: 'already-titled', title: 'A'.repeat(60_000) },
    }));
    expect(measure(summary)).toBeGreaterThan(SUMMARY_HEADER_BUDGET);

    const bounded = boundSummary(summary, measure);
    expect(measure(bounded)).toBeLessThanOrEqual(SUMMARY_HEADER_BUDGET);
    // Marked, so nobody reads it as what the document says.
    expect(bounded.titleText?.endsWith('…')).toBe(true);
    // The KIND is untouched: provenance is not what was too big.
    expect(bounded.title).toBe('already-titled');
  });

  it('keeps the punch list when the title is what has to go', () => {
    // Order matters. The punch list is the deliverable; the title is
    // decoration beside it. Trimming the title must not cost a single item.
    const figures = Array.from({ length: 12 }, () => ({
      type: 'Figure', alt: null, actualText: null, page: 1,
    }));
    const summary = summarise(provenance({
      title: { kind: 'already-titled', title: 'B'.repeat(40_000) },
      structure: structure({ figures, images: 12 }),
    }));

    const bounded = boundSummary(summary, measure);
    expect(measure(bounded)).toBeLessThanOrEqual(SUMMARY_HEADER_BUDGET);
    expect(bounded.needs).toHaveLength(summary.needs?.length ?? 0);
    expect(bounded.needs?.some((n) => n.criterion === 'summary')).toBe(false);
  });

  it('drops the title text entirely rather than deliver an oversized header', () => {
    // The extreme: not even a marker fits alongside everything else. The text
    // goes and nothing else does — `title` still states the provenance, and the
    // text itself is in the document.
    const summary = summarise(provenance({
      title: { kind: 'already-titled', title: 'C'.repeat(200_000) },
    }));
    const bounded = boundSummary(summary, measure, 200);
    expect(measure(bounded)).toBeLessThanOrEqual(Math.max(200, measure({ ...bounded, titleText: undefined })));
    expect(bounded.titleText).toBeUndefined();
    expect(bounded.title).toBe('already-titled');
  });
});

describe('the scope this instrument claims', () => {
  /**
   * Every criterion the emitters can actually produce, collected by running
   * them rather than by reading them.
   *
   * This is the guard that keeps `CHECKED_CRITERIA` honest. The constant is
   * rendered to a client as "checked here", so a criterion added to `gapsIn` or
   * `needsIn` without being added to the constant would understate the
   * instrument, and one removed without the constant changing would overstate
   * it. Both are the same defect as the claim this whole change exists to fix.
   */
  describe('where a figure is', () => {
    const fig = (over = {}) => ({ type: 'Figure', alt: null, actualText: null, page: null, ...over });
    const items = (figures: unknown[]) =>
      (summarise(provenance({ structure: structure({ figures, images: figures.length }) })).needs ?? [])
        .filter((n) => n.criterion === '1.1.1')
        .map((n) => n.item);

    it('names the page, so the item can be acted on', () => {
      // The ordinal alone is a position in `structure.figures`; nobody can find
      // figure 47 in a 37-page document without counting tags.
      expect(items([fig({ page: 5 })])[0]).toContain('Figure 1 (p5)');
    });

    it('says nothing about the page when the element declares none', () => {
      // Absent beats invented. Never "(page unknown)", which spends header
      // bytes to say nothing.
      const item = items([fig()])[0];
      expect(item).toContain('Figure 1:');
      expect(item).not.toContain('(p');
      expect(item.toLowerCase()).not.toContain('unknown');
    });

    it('calls a Formula a Formula', () => {
      // `Inspect` collects Formula into the same array. Once the item names a
      // page, a client can go there and find no figure.
      expect(items([fig({ type: 'Formula', page: 2 })])[0]).toContain('Formula 1 (p2)');
    });

    it('locates a placeholder description too, not only a missing one', () => {
      expect(items([fig({ alt: 'image', page: 9 })])[0])
        .toBe('Figure 1 (p9): alt text is a placeholder, not a description (WCAG F30) — write one');
    });

    it('keeps one item per figure, because the corpus counts them', () => {
      // `score.ts` compares `needs` as a multiset, and p36/p37 exist to fail if
      // the F30 predicate ever narrows back to a presence check. Collapsing
      // these into one aggregated item would delete that guard silently.
      expect(items([fig({ page: 1 }), fig({ page: 2 }), fig({ alt: 'photo', page: 3 })])).toHaveLength(3);
    });
  });

  describe('the summary header budget', () => {
    const measure = (value: RemediationSummary) => JSON.stringify(value).length;
    const withNeeds = (needs: Array<{ criterion: string; item: string }>): RemediationSummary => ({
      ...summarise(provenance()),
      needs,
    });
    const figures = (n: number, from = 1) =>
      Array.from({ length: n }, (_, i) => ({
        criterion: '1.1.1',
        item: `Figure ${i + from}: no alt text and no caption to transcribe — write a description`,
      }));

    it('leaves a summary that already fits completely alone', () => {
      const summary = withNeeds(figures(3));
      expect(boundSummary(summary, measure)).toBe(summary);
    });

    it('never exceeds the budget, however many items arrive', () => {
      // The property the whole thing exists for. 101 figures is the real
      // document that broke a delivery; 5,000 is the shape nobody has sent yet.
      for (const n of [101, 500, 5000]) {
        const bounded = boundSummary(withNeeds(figures(n)), measure);
        expect(measure(bounded), `${n} items overflowed`).toBeLessThanOrEqual(SUMMARY_HEADER_BUDGET);
      }
    });

    it('says how many it did not show, and never drops them in silence', () => {
      const bounded = boundSummary(withNeeds(figures(400)), measure);
      const notice = (bounded.needs ?? []).find((n) => n.criterion === 'summary');
      expect(notice, 'omitted items were dropped silently').toBeDefined();

      const shown = (bounded.needs ?? []).filter((n) => n.criterion !== 'summary').length;
      expect(notice?.item).toContain(`${400 - shown} items`);
      // Self-contained: the public report renders items with no criterion, and
      // this one has to distinguish a short LIST from a short COUNT itself.
      expect(notice?.item).toContain('nothing is missing from the counts');
    });

    it('keeps one item of every criterion, even the ones at the end', () => {
      // The reason truncation is not enough. On the real document the three
      // items worth reading — fonts, identifier, the PDF/UA catch-all — sit
      // behind 101 near-identical figure lines.
      const bounded = boundSummary(
        withNeeds([
          ...figures(400),
          { criterion: 'PDF/UA 7.21.4', item: 'the fonts were never embedded' },
          { criterion: 'PDF/UA 5-1', item: 'no conformance identifier, which is correct' },
          { criterion: 'PDF/UA', item: '2 further PDF/UA checks fail — a person must review' },
        ]),
        measure,
      );

      const criteria = new Set((bounded.needs ?? []).map((n) => n.criterion));
      expect(criteria).toContain('1.1.1');
      expect(criteria).toContain('PDF/UA 7.21.4');
      expect(criteria).toContain('PDF/UA 5-1');
      expect(criteria).toContain('PDF/UA');
    });

    it('keeps the punch list in the order it arrived', () => {
      // Selection and ordering are separate steps on purpose. The
      // per-criterion picks are drawn from all over the list — the PDF/UA items
      // sit behind 101 figure lines on the real document — and emitting them in
      // selection order would hoist them to the front and silently reshuffle a
      // client's punch list.
      const all = [
        ...figures(400),
        { criterion: 'PDF/UA 7.21.4', item: 'the fonts were never embedded' },
        { criterion: 'PDF/UA', item: '2 further PDF/UA checks fail — a person must review' },
      ];
      const bounded = boundSummary(withNeeds(all), measure);

      const shown = (bounded.needs ?? []).filter((n) => n.criterion !== 'summary');
      const positions = shown.map((n) => all.findIndex((a) => a.item === n.item));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      // Non-vacuous: the picks really do come from both ends of the list.
      expect(shown.length).toBeGreaterThan(2);
      expect(shown.at(-1)?.criterion).toBe('PDF/UA');
    });

    it('holds the budget even when one item is itself enormous', () => {
      // Rule 1 cannot save a document whose single item exceeds the budget on
      // its own; what it must not do is emit it anyway.
      const bounded = boundSummary(
        withNeeds([
          { criterion: '1.1.1', item: 'x'.repeat(SUMMARY_HEADER_BUDGET * 2) },
          { criterion: '1.3.1', item: 'y'.repeat(SUMMARY_HEADER_BUDGET * 2) },
        ]),
        measure,
      );
      expect(measure(bounded)).toBeLessThanOrEqual(SUMMARY_HEADER_BUDGET);
    });

    it('bounds the gaps it was given rather than rewriting them', () => {
      // The counts live in the gaps, and the notice promises they are complete.
      // If bounding ever touched them that promise would be false.
      const summary = withNeeds(figures(400));
      const bounded = boundSummary(summary, measure);
      expect(bounded.gaps).toEqual(summary.gaps);
    });
  });

  describe('4.1.2 form field names', () => {
    it('names the count, and says the label is not the internal field name', () => {
      const s = summarise(provenance({
        structure: structure({ formFields: 289, formFieldsWithoutName: 135 }),
      }));

      expect(s.gaps).toContain('4.1.2: 135 form fields with no accessible name');
      const need = (s.needs ?? []).find((n) => n.criterion === '4.1.2');
      expect(need?.item).toContain('135 of 289 form fields');
      // The commonest wrong fix is to treat /T as a label, so the item has to
      // rule it out itself: the public report renders items with no criterion.
      expect(need?.item).toContain('internal field name');
    });

    it('says nothing when every field is named', () => {
      const s = summarise(provenance({
        structure: structure({ formFields: 12, formFieldsWithoutName: 0 }),
      }));
      expect(s.gaps.some((g) => g.startsWith('4.1.2:'))).toBe(false);
      expect((s.needs ?? []).some((n) => n.criterion === '4.1.2')).toBe(false);
    });

    it('drops the "of" clause when every field is unnamed', () => {
      const s = summarise(provenance({
        structure: structure({ formFields: 2, formFieldsWithoutName: 2 }),
      }));
      const need = (s.needs ?? []).find((n) => n.criterion === '4.1.2');
      expect(need?.item).toContain('2 form fields have no accessible name');
      expect(need?.item).not.toContain(' of 2');
    });

    it('is a separate item from the annotation-nesting one on the same widgets', () => {
      // Both fire on r13's 289 widgets and answer different questions: can a
      // reader REACH the field, and does the reader learn what it is FOR.
      const s = summarise(provenance({
        structure: structure({
          annotationsNotInStructure: 289,
          formFields: 289,
          formFieldsWithoutName: 135,
        }),
      }));
      const criteria = (s.needs ?? []).map((n) => n.criterion);
      expect(criteria).toContain('1.3.1');
      expect(criteria).toContain('4.1.2');
    });

    it('leaves 7.18.1-3 to the catch-all when our own item is absent', () => {
      // The earned-suppression rule. Our counter says every field is named;
      // veraPDF disagrees. The clause must still reach the client rather than
      // be suppressed by an item that is not there.
      const s = withConformance(
        summarise(provenance({ structure: structure({ formFields: 4, formFieldsWithoutName: 0 }) })),
        { checker: 'verapdf-ua1', compliant: false, failingClauses: ['7.18.1-3'] },
      );
      const catchAll = (s.needs ?? []).find((n) => n.criterion === 'PDF/UA');
      expect(catchAll?.item).toContain('7.18.1-3');
    });

    it('names every other 7.18 clause even while the annotation item fires', () => {
      // The family-route defect, measured on the corpus before it was fixed:
      // r13 reached a client with 7.18.3-1 and 7.18.4-1 in no gap, no need and
      // no catch-all, because /^7\.18\./ routed the whole family to 1.3.1 and
      // the annotation item was present for an unrelated reason. Suppression is
      // earned per CRITERION, so one item silenced four unrelated questions.
      const s = withConformance(
        summarise(provenance({
          structure: structure({
            annotationsNotInStructure: 289,
            formFields: 289,
            formFieldsWithoutName: 135,
          }),
        })),
        {
          checker: 'verapdf-ua1',
          compliant: false,
          // r13's real 7.18 set, plus p30's link clause.
          failingClauses: ['7.18.1-3', '7.18.3-1', '7.18.4-1', '7.18.5-1'],
        },
      );

      const catchAll = (s.needs ?? []).find((n) => n.criterion === 'PDF/UA');
      for (const clause of ['7.18.3-1', '7.18.4-1', '7.18.5-1']) {
        expect(catchAll?.item, `${clause} reached the client nowhere`).toContain(clause);
      }
      // 7.18.1-3 stays suppressed, because the 4.1.2 item genuinely says it.
      expect((s.needs ?? []).some((n) => n.criterion === '4.1.2')).toBe(true);
      expect(catchAll?.item).not.toContain('7.18.1-3');
    });

    it('does not let the nesting item suppress the form-name clause', () => {
      // The defect itself. `7.18.1-3` used to route to 1.3.1, so an annotation
      // item present for an unrelated reason swallowed it and 135 unlabelled
      // fields reached a client named nowhere.
      const s = withConformance(
        summarise(provenance({
          structure: structure({
            annotationsNotInStructure: 289,
            formFields: 289,
            formFieldsWithoutName: 0,
          }),
        })),
        { checker: 'verapdf-ua1', compliant: false, failingClauses: ['7.18.1-3'] },
      );
      const voiced = (s.needs ?? []).some(
        (n) => n.criterion === '4.1.2' || (n.criterion === 'PDF/UA' && n.item.includes('7.18.1-3')),
      );
      expect(voiced, '7.18.1-3 reached the client nowhere').toBe(true);
    });
  });

  const emitted = () => {
    const seen = new Set<string>();
    const collect = (summary: RemediationSummary) => {
      for (const gap of summary.gaps) seen.add(gap.slice(0, gap.indexOf(':')));
      for (const need of summary.needs ?? []) seen.add(need.criterion);
    };

    // 2.4.2 — nothing to title with. 3.1.1 — no declared language.
    collect(summarise(provenance({
      title: { kind: 'no-heading-to-copy' },
      sourceLanguage: null,
      structure: structure({ title: null }),
    })));
    // 1.1.1 — an undescribed figure. 1.3.1 — no structure tree at all.
    collect(summarise(provenance({
      structure: structure({
        figures: [{ type: 'Figure', alt: null, actualText: null , page: null}],
        images: 1,
        structureElements: 0,
      }),
    })));
    // 1.3.1 again, from the other side: an annotation outside the tree.
    collect(summarise(provenance({
      structure: structure({ annotationsNotInStructure: 2 }),
    })));
    // 4.1.2 — a form field carrying no accessible name.
    collect(summarise(provenance({
      structure: structure({ formFields: 3, formFieldsWithoutName: 2 }),
    })));
    // 2.4.10 — a heading ladder that starts below H1.
    collect(summarise(provenance({
      structure: structure({ headings: ['H3'], headingTexts: [{ level: 'H3', text: 'Deep' }] }),
    })));
    // 1.4.3 — contrast, which arrives through `withContrast` rather than the
    // two emitters, exactly as the conformance items arrive through
    // `withConformance`. Driving only `summarise` would leave the criterion
    // claimed in the scope and produced by nothing the test can see.
    collect(withContrast(summarise(provenance()), {
      pairs: 2, passing: 0, failing: 1, failingGlyphs: 9,
      undetermined: 1, undeterminedGlyphs: 4, decorative: 1, decorativeGlyphs: 2,
      findings: [{ fg: '#FF0000', bg: '#FFFFFF', large: false, ratio: 4, required: 4.5, glyphs: 9, page: 2 }],
    }));

    return seen;
  };

  it('claims exactly the criteria its emitters can produce', () => {
    expect([...emitted()].sort()).toEqual([...CHECKED_CRITERIA].sort());
  });

  it('never lists a criterion as both checked and not checked', () => {
    const checked = new Set<string>(CHECKED_CRITERIA);
    for (const criterion of NOT_CHECKED_CRITERIA) {
      expect(checked.has(criterion.number), `${criterion.number} is on both lists`).toBe(false);
    }
  });

  it('travels with every summary, so a caller reading the header sees it', () => {
    // The response header carries the summary and nothing else. Scope that
    // lived only in rendered copy would leave an API consumer with the same
    // unqualified claim this change removes from the screens.
    expect(summarise(provenance()).scope).toEqual({ criteria: SUMMARISE_CRITERIA });
  });

  it('does not claim contrast until the pass that measures it has run', () => {
    // The defect: `scope` was the whole constant unconditionally, so a delivery
    // whose contrast stage could not run told the client 1.4.3 was checked
    // while the `contrast` field beside it was absent — and every surface
    // renders that absence as "not checked". The two disagreed about the same
    // document. The inspect-only path, which never runs contrast at all,
    // claimed it on every reading.
    const withoutTheStage = summarise(provenance());
    expect(withoutTheStage.contrast).toBeUndefined();
    expect(withoutTheStage.scope?.criteria).not.toContain('1.4.3');

    const measured = withContrast(withoutTheStage, CLEAN_CONTRAST);
    expect(measured.scope?.criteria).toContain('1.4.3');
    // Canonical order, not append order: the line renders to a client.
    expect(measured.scope).toEqual({ criteria: [...CHECKED_CRITERIA] });
  });

  it('leaves an unrecorded scope unrecorded when contrast runs', () => {
    // A reading stored before the field existed cannot say what it looked for.
    // Inventing a scope here would render as full coverage on every surface —
    // the exact overstatement the optional field exists to prevent.
    const stored: RemediationSummary = { ...summarise(provenance()), scope: undefined };
    expect(withContrast(stored, CLEAN_CONTRAST).scope).toBeUndefined();
  });

  it('costs the header almost nothing, and nothing that grows', () => {
    // The summary travels in `x-remediation-summary`, which a 101-figure
    // document already took to 12,946 bytes against Node's 16KB default.
    // A scope that scaled with the document would re-break that delivery.
    const bytes = JSON.stringify(summarise(provenance()).scope).length;
    expect(bytes).toBeLessThan(120);
  });
});

describe('withContrast', () => {
  const base = (): RemediationSummary => summarise(provenance());
  const reading = (over = {}) => ({
    pairs: 1, passing: 0, failing: 0, failingGlyphs: 0,
    undetermined: 0, undeterminedGlyphs: 0, decorative: 0, decorativeGlyphs: 0,
    findings: [] as Array<{
      fg: string; bg: string; large: boolean; ratio: number;
      required: number; glyphs: number; page: number;
    }>,
    ...over,
  });
  const finding = (over = {}) => ({
    fg: '#FF0000', bg: '#FFFFFF', large: false, ratio: 4, required: 4.5, glyphs: 9, page: 2, ...over,
  });

  it('names a failure with its worst ratio and its pages', () => {
    const s = withContrast(base(), reading({
      failing: 1, failingGlyphs: 9, findings: [finding()],
    }));

    expect(s.gaps).toContainEqual(expect.stringContaining('1.4.3:'));
    expect(s.gaps.find((g) => g.startsWith('1.4.3'))).toContain('4.00:1');
    expect(s.needs?.[0].item).toContain('page 2');
  });

  it('folds every contrast fact into ONE 1.4.3 gap', () => {
    // `documentGapKey` identifies a gap by the criterion before its colon, so a
    // second `1.4.3:` string would read as two failures where there is one.
    const s = withContrast(base(), reading({
      failing: 1, failingGlyphs: 9, undetermined: 1, undeterminedGlyphs: 4,
      findings: [finding()],
    }));

    expect(s.gaps.filter((g) => g.startsWith('1.4.3:'))).toHaveLength(1);
  });

  it('voices undetermined text rather than passing over it', () => {
    // A ratio nobody could measure is not a pass. Reporting one from an
    // unreliable sample would invent a failure; saying nothing would hide one.
    const s = withContrast(base(), reading({ undetermined: 3, undeterminedGlyphs: 40 }));

    expect(s.needs?.some((n) => n.criterion === '1.4.3' && /could|no ratio|by eye/.test(n.item)))
      .toBe(true);
    expect(s.gaps.some((g) => g.startsWith('1.4.3:'))).toBe(true);
  });

  it('keeps decoration in its own bucket, neither failure nor pass', () => {
    // `/Artifact` is broader than WCAG's exemption — it also covers running
    // heads and page numbers, which are visible text WCAG does not exempt.
    const s = withContrast(base(), reading({ decorative: 1, decorativeGlyphs: 82 }));
    const item = s.needs?.find((n) => n.criterion === '1.4.3');

    expect(item?.item).toContain('82');
    expect(item?.item).toMatch(/decoration/);
    // Not asserted as a failure: no gap, because we did not establish one.
    expect(s.gaps.some((g) => g.startsWith('1.4.3:'))).toBe(false);
  });

  it('says nothing at all when every pair passes', () => {
    const s = withContrast(base(), reading({ passing: 4 }));

    expect(s.gaps.some((g) => g.startsWith('1.4.3:'))).toBe(false);
    expect(s.needs).toBeUndefined();
    // The reading still travels, so a surface can say "checked" rather than
    // leaving the reader to guess whether it ran.
    expect(s.contrast?.passing).toBe(4);
  });

  it('never carries the measured text, and bounds the page list', () => {
    // The stage this replaced printed 30 glyphs of the run it measured, off a
    // real municipal document. The summary renders on a public report page.
    const s = withContrast(base(), reading({
      failing: 9, failingGlyphs: 200,
      findings: Array.from({ length: 9 }, (_, i) => finding({ page: i + 1 })),
    }));
    const item = s.needs?.find((n) => n.criterion === '1.4.3')?.item ?? '';

    expect(JSON.stringify(s)).not.toContain('sample');
    // Five pages then a count — an unbounded list is a header-size problem.
    expect(item).toContain('and 4 more');
    expect(item.length).toBeLessThan(400);
  });

  it('reports large text against 3:1, as WCAG does', () => {
    // 18pt, or 14pt bold. A large-text pair at 3.2:1 passes and must not appear.
    const s = withContrast(base(), reading({
      passing: 1, findings: [],
    }));

    expect(s.gaps.some((g) => g.startsWith('1.4.3:'))).toBe(false);
  });
});
