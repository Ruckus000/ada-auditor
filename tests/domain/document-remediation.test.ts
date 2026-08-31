import { describe, expect, it } from 'vitest';

import {
  isWordDocument,
  logSafe,
  summarise,
  withConformance,
  CHECKED_CRITERIA,
  NOT_CHECKED_CRITERIA,
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
    annotationsNotInStructure: 0,
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
      // here as well as in the emitted-criteria test below.
      scope: { criteria: [...CHECKED_CRITERIA] },
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
            { type: 'Figure', alt: null, actualText: null },
            { type: 'Figure', alt: '', actualText: null },
            { type: 'Figure', alt: 'A site map', actualText: null },
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
            { type: 'Figure', alt: null, actualText: null },
            { type: 'Figure', alt: null, actualText: null },
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
      annotationsNotInStructure: 0,
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
        { type: 'Figure', alt: null, actualText: null },
        { type: 'Figure', alt: 'described', actualText: null },
        { type: 'Figure', alt: null, actualText: null },
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
      ...provenance({ figures: [{ type: 'Figure', alt: null, actualText: null }], images: 1 }),
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
      annotationsNotInStructure: 0,
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

  it('translates the font family into the work that actually fixes it', () => {
    const s = withConformance(base, {
      checker: 'verapdf-ua1',
      compliant: false,
      failingClauses: ['7.21.4.1-1', '7.21.4.2-2'],
    });
    expect(s.needs).toHaveLength(1);
    expect(s.needs?.[0].criterion).toBe('PDF/UA 7.21.4');
    // The remedy is the source, which pairing already surfaces — never a
    // silent substitution.
    expect(s.needs?.[0].item).toContain('Word source');
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
    // Language (7.2.*), figures (7.3), headings (7.4), title (7.1-9) and
    // annotation nesting (7.18.*) each have a gap or item of their own;
    // repeating them through the checker would say everything twice. Each one
    // has to actually BE there, which is what this fixture supplies.
    const voiced: RemediationSummary = {
      ...base,
      gaps: ['2.4.2: no title, and no heading to copy one from'],
      needs: [
        { criterion: '3.1.1', item: 'name the language it is written in' },
        { criterion: '1.1.1', item: 'Figure 1 needs a human-written description' },
        { criterion: '2.4.10', item: 'heading levels skip' },
        { criterion: '1.3.1', item: 'a form field sits outside the structure' },
      ],
    };
    const s = withConformance(voiced, {
      checker: 'verapdf-ua1',
      compliant: false,
      failingClauses: ['7.2-34', '7.3-1', '7.4.2-1', '7.1-9', '7.18.5-2'],
    });
    // The four items it arrived with, and no catch-all on top of them.
    expect(s.needs).toHaveLength(4);
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
        annotationsNotInStructure: 0,
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
    alts.map((alt) => ({ type: 'Figure', alt, actualText: null }));
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
        figures: [{ type: 'Figure', alt: null, actualText: null }],
        images: 1,
        structureElements: 0,
      }),
    })));
    // 1.3.1 again, from the other side: an annotation outside the tree.
    collect(summarise(provenance({
      structure: structure({ annotationsNotInStructure: 2 }),
    })));
    // 2.4.10 — a heading ladder that starts below H1.
    collect(summarise(provenance({
      structure: structure({ headings: ['H3'], headingTexts: [{ level: 'H3', text: 'Deep' }] }),
    })));

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
    expect(summarise(provenance()).scope).toEqual({ criteria: [...CHECKED_CRITERIA] });
  });

  it('costs the header almost nothing, and nothing that grows', () => {
    // The summary travels in `x-remediation-summary`, which a 101-figure
    // document already took to 12,946 bytes against Node's 16KB default.
    // A scope that scaled with the document would re-break that delivery.
    const bytes = JSON.stringify(summarise(provenance()).scope).length;
    expect(bytes).toBeLessThan(120);
  });
});
