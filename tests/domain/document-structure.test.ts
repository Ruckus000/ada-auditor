import { describe, expect, it } from 'vitest';

import {
  contentChanges,
  documentStructureSchema,
  isTagged,
  languageTagSchema,
  type DocumentStructure,
} from '../../src/domain/document-structure';

/**
 * The schema is the boundary between a subprocess's stdout and everything that
 * reads it, so these tests are about what it must *refuse* as much as what it
 * accepts.
 */

/** A real `Inspect` result, trimmed to one of each thing it reports. */
const REAL_OUTPUT = {
  marked: true,
  signed: false,
  annotationsNotInStructure: 0,
  formFields: 0,
  formFieldsWithoutName: 0,
  embeddedFiles: 0,
  structureElements: 42,
  textChars: 1500,
  images: 2,
  pages: 3,
  lang: 'en-GB',
  title: 'Planning Committee Agenda',
  headings: ['H1', 'H2'],
  headingTexts: [
    { level: 'H1', text: 'Agenda' },
    { level: 'H2', text: 'Apologies' },
  ],
  figures: [{ type: 'Figure', alt: 'A map of the site', actualText: null , page: null}],
  tables: [
    {
      th: 1,
      td: 2,
      tr: 1,
      cells: [
        { type: 'TH', text: 'Item', scope: 'Column', row: 0 },
        { type: 'TD', text: '1', scope: null, row: 0 },
      ],
    },
  ],
  lists: [{ depth: 1, items: 4 }],
  order: [{ type: 'H1', text: 'Agenda' }],
};

describe('documentStructureSchema', () => {
  it('accepts a real Inspect result', () => {
    const parsed = documentStructureSchema.parse(REAL_OUTPUT);
    expect(parsed.structureElements).toBe(42);
    expect(parsed.tables[0]?.cells[0]?.scope).toBe('Column');
  });

  it('accepts null for every field Inspect emits bare `null` for', () => {
    // `Inspect.java`'s `q()` returns the literal `null` for a null string, so
    // an untitled document in an unset language is a normal result, not a
    // malformed one. Three of four real already-tagged municipal PDFs have no
    // title at all.
    const parsed = documentStructureSchema.parse({
      ...REAL_OUTPUT,
      lang: null,
      title: null,
      figures: [{ type: 'Figure', alt: null, actualText: null , page: null}],
    });
    expect(parsed.title).toBeNull();
    expect(parsed.figures[0]?.alt).toBeNull();
  });

  it('keeps empty alt distinct from absent alt', () => {
    // These are different claims and nothing may collapse them: empty says the
    // graphic carries no meaning, absent says nobody answered. Guessing they
    // were the same deleted four meaningful images from one document.
    const empty = documentStructureSchema.parse({
      ...REAL_OUTPUT,
      figures: [{ type: 'Figure', alt: '', actualText: null , page: null}],
    });
    expect(empty.figures[0]?.alt).toBe('');
    expect(empty.figures[0]?.alt).not.toBeNull();
  });

  it('rejects a missing required field rather than yielding undefined', () => {
    const { images: _images, ...withoutImages } = REAL_OUTPUT;
    expect(documentStructureSchema.safeParse(withoutImages).success).toBe(false);
  });

  it('rejects a wrongly typed count', () => {
    // A stage that printed `"images": "2"` must fail here, not three layers
    // later during arithmetic.
    expect(
      documentStructureSchema.safeParse({ ...REAL_OUTPUT, images: '2' }).success,
    ).toBe(false);
  });

  it('ignores a field a newer Inspect adds', () => {
    // Deliberately not `.strict()`: this reads our own tool's output, where an
    // unknown key means the tool learned to report something new. Breaking a
    // running deployment over that would be wrong, while a missing known field
    // still fails above.
    const parsed = documentStructureSchema.parse({ ...REAL_OUTPUT, somethingNew: 7 });
    expect(parsed.pages).toBe(3);
    expect('somethingNew' in parsed).toBe(false);
  });
});

describe('isTagged', () => {
  it('is false for an untagged PDF that still has text', () => {
    const untagged = documentStructureSchema.parse({
      ...REAL_OUTPUT,
      marked: false,
      signed: false,
      annotationsNotInStructure: 0,
      formFields: 0,
      formFieldsWithoutName: 0,
      embeddedFiles: 0,
      structureElements: 0,
    }) satisfies DocumentStructure;
    expect(isTagged(untagged)).toBe(false);
    expect(untagged.textChars).toBeGreaterThan(0);
  });

  it('answers what is true, never what the document claims', () => {
    // A producer writing MarkInfo/Marked true onto a document with no
    // structure tree is the exact false statement this product refuses to
    // make itself, and a real shape: `marked` is what was claimed,
    // `isTagged` is what is so, and nothing may read one for the other.
    const lying = documentStructureSchema.parse({
      ...REAL_OUTPUT,
      marked: true,
      signed: false,
      annotationsNotInStructure: 0,
      formFields: 0,
      formFieldsWithoutName: 0,
      embeddedFiles: 0,
      structureElements: 0,
    }) satisfies DocumentStructure;
    expect(lying.marked).toBe(true);
    expect(isTagged(lying)).toBe(false);
  });

  it('is true once the tree has elements', () => {
    expect(isTagged(documentStructureSchema.parse(REAL_OUTPUT))).toBe(true);
  });
});

describe('contentChanges', () => {
  const base = documentStructureSchema.parse(REAL_OUTPUT);

  it('sees no content change when only the language label moves', () => {
    // The property that makes a metadata repair safe to trust: `Finish` may set
    // /Lang and the XMP packet, and must leave everything the document says
    // exactly as it was.
    const after = documentStructureSchema.parse({ ...REAL_OUTPUT, lang: 'cy-GB' });
    expect(contentChanges(base, after)).toEqual([]);
  });

  it('sees no content change when only the title label moves', () => {
    const after = documentStructureSchema.parse({ ...REAL_OUTPUT, title: 'Something Else' });
    expect(contentChanges(base, after)).toEqual([]);
  });

  it('catches a figure dropping out of the structure tree', () => {
    // The exact defect this exists for. Four meaningful images artifacted out
    // of the tree are, in the delivered PDF, indistinguishable from four images
    // that were never there — and `images` stays put while `figures` empties,
    // which is what makes it detectable at all.
    const after = documentStructureSchema.parse({ ...REAL_OUTPUT, figures: [] });
    expect(contentChanges(base, after)).toContain('figures');
  });

  it('catches a heading being demoted', () => {
    const after = documentStructureSchema.parse({
      ...REAL_OUTPUT,
      headings: ['H1'],
      headingTexts: [{ level: 'H1', text: 'Agenda' }],
    });
    expect(contentChanges(base, after)).toEqual(
      expect.arrayContaining(['headings', 'headingTexts']),
    );
  });

  it('catches a cell being promoted to a header', () => {
    // `Tables` does this legitimately; a metadata pass doing it would be
    // inventing a claim about the document.
    const after = documentStructureSchema.parse({
      ...REAL_OUTPUT,
      tables: [
        {
          ...REAL_OUTPUT.tables[0],
          th: 2,
          td: 1,
          cells: [
            { type: 'TH', text: 'Item', scope: 'Column', row: 0 },
            { type: 'TH', text: '1', scope: 'Column', row: 0 },
          ],
        },
      ],
    });
    expect(contentChanges(base, after)).toContain('tables');
  });

  it('catches reading order changing even when nothing is added or removed', () => {
    // Same elements, different sequence. Counts alone would call this identical.
    const after = documentStructureSchema.parse({
      ...REAL_OUTPUT,
      order: [
        { type: 'H2', text: 'Apologies' },
        { type: 'H1', text: 'Agenda' },
      ],
    });
    expect(contentChanges(base, after)).toContain('order');
  });

  it('reports every changed field, not just the first', () => {
    const after = documentStructureSchema.parse({
      ...REAL_OUTPUT,
      marked: true,
      signed: false,
      annotationsNotInStructure: 0,
      formFields: 0,
      formFieldsWithoutName: 0,
      embeddedFiles: 0,
      structureElements: 1,
      images: 0,
      figures: [],
    });
    expect(contentChanges(base, after).sort()).toEqual(['figures', 'images', 'structureElements']);
  });
});

describe('languageTagSchema', () => {
  it('accepts the tags real documents use', () => {
    for (const tag of ['en', 'cy', 'en-GB', 'cy-GB', 'es-419']) {
      expect(languageTagSchema.safeParse(tag).success, tag).toBe(true);
    }
  });

  it('refuses shapes that would write a false claim into the file', () => {
    // Each of these produces a PDF that passes machine validation and states
    // something untrue about the document.
    for (const tag of ['', 'english', 'EN_US', 'e', '  ']) {
      expect(languageTagSchema.safeParse(tag).success, tag).toBe(false);
    }
  });
});
