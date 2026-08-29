import { describe, expect, it } from 'vitest';

import {
  isWordDocument,
  logSafe,
  summarise,
  titleFromFilename,
  type ConversionProvenance,
} from '../../src/domain/document-remediation';
import { documentStructureSchema } from '../../src/domain/document-structure';

const structure = (over = {}) =>
  documentStructureSchema.parse({
    marked: true,
    signed: false,
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

  it('is absent, never empty, when nothing needs a person', () => {
    const s = summarise(provenance({ headings: ['H1', 'H2'] }));
    expect('needs' in s).toBe(false);
  });
});
