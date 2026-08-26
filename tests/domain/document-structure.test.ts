import { describe, expect, it } from 'vitest';

import {
  documentStructureSchema,
  isTagged,
  type DocumentStructure,
} from '../../src/domain/document-structure';

/**
 * The schema is the boundary between a subprocess's stdout and everything that
 * reads it, so these tests are about what it must *refuse* as much as what it
 * accepts.
 */

/** A real `Inspect` result, trimmed to one of each thing it reports. */
const REAL_OUTPUT = {
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
  figures: [{ type: 'Figure', alt: 'A map of the site', actualText: null }],
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
      figures: [{ type: 'Figure', alt: null, actualText: null }],
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
      figures: [{ type: 'Figure', alt: '', actualText: null }],
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
      structureElements: 0,
    }) satisfies DocumentStructure;
    expect(isTagged(untagged)).toBe(false);
    expect(untagged.textChars).toBeGreaterThan(0);
  });

  it('is true once the tree has elements', () => {
    expect(isTagged(documentStructureSchema.parse(REAL_OUTPUT))).toBe(true);
  });
});
