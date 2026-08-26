// Tests for the scoring in compare.mjs, which had none until a document that
// lost all four of its meaningful images scored DELIVERABLE with zero defects.
//
// Every conclusion this project has published came out of `defectsFor`, and
// nothing checked it. The gap it missed was not subtle — the figure check had a
// `>` branch and no `<` branch — and the reason it survived is that the only way
// to exercise this code was to run the whole pipeline over 28 PDFs and read the
// output by eye.
//
// Fixtures here are the smallest object that reaches the branch under test.
// They are not realistic documents and are not meant to be.
//
// Usage: node --test compare.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defectsFor } from './compare.mjs';

/** An Inspect result with nothing in it; spread over it to set one thing. */
const inspected = (over = {}) => ({
  figures: [], tables: [], lists: [], headings: [], headingTexts: [],
  order: [], images: 0, textChars: 500, lang: 'en', title: 'A Title',
  ...over,
});

/** Ground truth with the fields defectsFor always reads. */
const truth = (over = {}) => ({ figures: [], tables: [], lists: [], language: 'en', ...over, });

const kinds = (d, kind) => d.filter((x) => x.kind === kind);
const assertions = (d) => kinds(d, 'assertion');
const omissions = (d) => kinds(d, 'omission');
const figureDefects = (d) => d.filter((x) => /Figure elements/.test(x.msg));

// --- the defect that motivated all of this ---------------------------------

test('meaningful images artifacted out of the tree are an assertion, not an omission', () => {
  // 06-images-uncaptioned, as Brief C left it: ground truth records four
  // meaningful figures, the repair marked every image decorative, and five
  // images are still drawn on the page while the tree mentions none.
  const d = defectsFor(
    truth({ figures: [{}, {}, {}, {}] }),
    inspected({ figures: [], images: 5 }),
  );
  const found = figureDefects(d);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'assertion', 'hidden content is a claim, not a gap');
  assert.match(found[0].msg, /artifacted out of the structure tree/);
});

test('missing figures with no image behind them are an omission', () => {
  // 07-complex-chart and h11: the chart is drawn, never an image XObject, so
  // nothing was hidden. A real gap, and honest.
  const d = defectsFor(
    truth({ figures: [{}] }),
    inspected({ figures: [], images: 0 }),
  );
  const found = figureDefects(d);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'omission');
  assert.match(found[0].msg, /no image behind them/);
});

test('over-tagging is still an assertion', () => {
  // Pinned so the branch that already worked cannot regress while fixing the
  // one that did not.
  const d = defectsFor(
    truth({ figures: [{}] }),
    inspected({ figures: [{ alt: 'a' }, { alt: 'b' }, { alt: 'c' }], images: 3 }),
  );
  const found = figureDefects(d);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'assertion');
  assert.match(found[0].msg, /2 extra/);
});

test('the right number of figures is not a defect', () => {
  const d = defectsFor(
    truth({ figures: [{}, {}] }),
    inspected({ figures: [{ alt: 'one' }, { alt: 'two' }], images: 2 }),
  );
  assert.equal(figureDefects(d).length, 0);
});

test('a document with no figures expected and none tagged is clean', () => {
  const d = defectsFor(truth(), inspected());
  assert.equal(figureDefects(d).length, 0);
  assert.equal(assertions(d).length, 0);
});

test('repeated images count toward what is expected', () => {
  // A logo on five pages is one description; ground truth records it under
  // repeatedImages, and tagging it once must not read as under-tagging.
  const d = defectsFor(
    truth({ figures: [{}], repeatedImages: [{ pages: 5 }] }),
    inspected({ figures: [{ alt: 'chart' }, { alt: 'logo' }], images: 6 }),
  );
  assert.equal(figureDefects(d).length, 0);
});

// --- the mustNot* fields, authored to catch assertions and never read --------

test('text ground truth forbids as a heading is an assertion when tagged as one', () => {
  const d = defectsFor(
    truth({ mustNotBeHeadings: ['1200 Grand Concourse, Bronx'] }),
    inspected({
      headings: ['H2'],
      headingTexts: [{ level: 'H2', text: '1200 Grand Concourse, Bronx' }],
    }),
  );
  const found = assertions(d).filter((x) => /must not be one/.test(x.msg));
  assert.equal(found.length, 1);
});

test('mustNotBeHeadings does not fire when the text is left alone', () => {
  const d = defectsFor(
    truth({ mustNotBeHeadings: ['1200 Grand Concourse, Bronx'] }),
    inspected({ headings: [], headingTexts: [] }),
  );
  assert.equal(assertions(d).filter((x) => /must not be one/.test(x.msg)).length, 0);
});

test('mustNotBeTitle fires on the document title', () => {
  const d = defectsFor(
    truth({ mustNotBeTitle: ['DRAFT'] }),
    inspected({ title: 'DRAFT' }),
  );
  assert.equal(assertions(d).filter((x) => /must not become the title/.test(x.msg)).length, 1);
});

test('mustNotBeTables fires when the named content is tagged into a table', () => {
  const d = defectsFor(
    truth({ mustNotBeTables: ['Column one body text'] }),
    inspected({
      tables: [{ th: 0, td: 1, tr: 1, cells: [{ type: 'TD', text: 'Column one body text', scope: null, row: '0' }] }],
    }),
  );
  assert.equal(assertions(d).filter((x) => /must not be one/.test(x.msg)).length, 1);
});

// --- language, which was checked for presence and never for value -----------

test('a wrong /Lang is an assertion', () => {
  const d = defectsFor(truth({ language: 'cy' }), inspected({ lang: 'en-US' }));
  assert.equal(assertions(d).filter((x) => /Lang/.test(x.msg)).length, 1);
});

test('a regional variant satisfies the primary subtag', () => {
  const d = defectsFor(truth({ language: 'cy' }), inspected({ lang: 'cy-GB' }));
  assert.equal(d.filter((x) => /Lang/.test(x.msg)).length, 0);
});

test('a missing /Lang is an omission, not an assertion', () => {
  const d = defectsFor(truth({ language: 'en' }), inspected({ lang: null }));
  const found = d.filter((x) => /Lang/.test(x.msg));
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'omission');
});

// --- shapes that must not throw --------------------------------------------

test('ground truth missing every optional key does not throw', () => {
  const d = defectsFor({}, inspected());
  assert.ok(Array.isArray(d));
});

test('an Inspect result from before the images key was added is treated as no images', () => {
  // Old evidence JSON on disk has no `images`. It must degrade to the omission
  // branch rather than crashing or inventing an assertion from undefined.
  const s = inspected({ figures: [], images: undefined });
  delete s.images;
  const d = defectsFor(truth({ figures: [{}] }), s);
  const found = figureDefects(d);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'omission');
});
