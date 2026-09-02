import { describe, expect, it } from 'vitest';

import {
  INSTRUMENT_VERSION,
  boundSummary,
  logSafe,
  summarise,
  transportSummary,
  withConformance,
  withContrast,
  withDeclarations,
  withExcerpt,
  withRepairability,
  type ConversionProvenance,
  type RemediationSummary,
} from '../../src/domain/document-remediation';
import { documentStructureSchema } from '../../src/domain/document-structure';
import { planRepair } from '../../src/services/document-repair';

/**
 * Every punch item has an identity.
 *
 * `needs[i]` is the sentence a person reads; `asks[i]` is what a program needs
 * to attach an answer to it: a stable id, the kind of answer it takes, and who
 * can give it. They are emitted from the same loop through one helper, and the
 * contract is POSITIONAL — so the whole test is that the two arrays line up.
 */

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
    lists: [],
    order: [{ type: 'H1', text: 'Planning Committee Agenda' }],
    ...over,
  });

const provenance = (over: Partial<ConversionProvenance> = {}): ConversionProvenance => ({
  title: { kind: 'already-titled', title: 'Planning Committee Agenda' },
  sourceLanguage: 'en-GB',
  structure: structure(),
  ...over,
});

/** A reading that fires every emitter this vocabulary has. */
function everything(): RemediationSummary {
  const s = structure({
    lang: null,
    annotationsNotInStructure: 2,
    formFields: 3,
    formFieldsWithoutName: 2,
    embeddedFiles: 1,
    headings: ['H2', 'H4'],
    headingTexts: [{ level: 'H2', text: 'Deep' }, { level: 'H4', text: 'Deeper' }],
    figures: [
      { type: 'Figure', alt: null, actualText: null, page: 1 },
      { type: 'Figure', alt: 'decorative', actualText: null, page: 1 },
      { type: 'Figure', alt: 'image.png', actualText: null, page: 2 },
      { type: 'Figure', alt: 'A site map', actualText: null, page: 2 },
    ],
    images: 4,
  });
  let summary = summarise(provenance({ sourceLanguage: null, structure: s }));
  summary = withConformance(summary, {
    checker: 'verapdf-ua1',
    compliant: false,
    failingClauses: ['7.21.4.1-1', '7.21.4.2-2', '7.21.4.9-9', '7.1-3', '5-1', '7.18.3-1'],
  });
  summary = withContrast(summary, {
    pairs: 3, passing: 0, failing: 1, failingGlyphs: 9,
    undetermined: 1, undeterminedGlyphs: 4, decorative: 1, decorativeGlyphs: 2,
    findings: [{ fg: '#FF0000', bg: '#FFFFFF', large: false, ratio: 4, required: 4.5, glyphs: 9, page: 2 }],
  });
  return withRepairability(summary, planRepair(s, undefined));
}

describe('asks beside needs', () => {
  it('emits exactly one ask per punch item, in the same order, with the same criterion', () => {
    const summary = everything();
    expect(summary.needs).toBeDefined();
    expect(summary.asks).toBeDefined();
    expect(summary.asks).toHaveLength(summary.needs!.length);
    summary.needs!.forEach((need, i) => {
      expect(summary.asks![i].criterion, need.item).toBe(need.criterion);
    });
  });

  it('gives every ask an id no other ask in the reading shares', () => {
    const ids = everything().asks!.map((ask) => ask.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is absent exactly when the punch list is absent', () => {
    const clean = summarise(provenance());
    expect('needs' in clean).toBe(false);
    expect('asks' in clean).toBe(false);
  });

  it('keys a figure by its ordinal and snapshots what it looked like', () => {
    const summary = everything();
    const figures = summary.asks!.filter((ask) => ask.kind === 'figure');
    expect(figures.map((ask) => ask.id)).toEqual(['figure:0', 'figure:1', 'figure:2']);
    expect(figures[1].target).toEqual({ ordinal: 1, type: 'Figure', page: 1, prior: 'decorative' });
    expect(figures[2].target).toEqual({ ordinal: 2, type: 'Figure', page: 2, prior: 'placeholder' });
    // The described figure raises no ask at all.
    expect(figures.some((ask) => ask.id === 'figure:3')).toBe(false);
  });

  it('carries the image digest on a figure ask, so repeats of one image can be answered once', () => {
    const s = structure({
      figures: [
        { type: 'Figure', alt: null, actualText: null, page: 1, imageDigest: 'sha256:logo', box: { page: 1, x: 10, y: 10, w: 40, h: 20 } },
        { type: 'Figure', alt: null, actualText: null, page: 2, imageDigest: 'sha256:logo', box: null },
        { type: 'Figure', alt: null, actualText: null, page: 2, imageDigest: null },
      ],
      images: 3,
    });
    const asks = summarise(provenance({ structure: s })).asks!.filter((ask) => ask.kind === 'figure');
    expect(asks.map((ask) => ask.target)).toEqual([
      { ordinal: 0, type: 'Figure', page: 1, prior: 'absent', imageDigest: 'sha256:logo' },
      { ordinal: 1, type: 'Figure', page: 2, prior: 'absent', imageDigest: 'sha256:logo' },
      { ordinal: 2, type: 'Figure', page: 2, prior: 'absent' },
    ]);
  });

  it('keys a heading decision by its index in the ladder', () => {
    const headings = everything().asks!.filter((ask) => ask.kind === 'heading');
    expect(headings).toEqual([
      { id: 'heading:0', kind: 'heading', criterion: '2.4.10', answerable: 'operator', target: { index: 0, from: 0, to: 2 } },
      { id: 'heading:1', kind: 'heading', criterion: '2.4.10', answerable: 'operator', target: { index: 1, from: 2, to: 4 } },
    ]);
  });

  it('says who can answer each kind', () => {
    const byId = new Map(everything().asks!.map((ask) => [ask.id, ask.answerable]));
    expect(byId.get('language')).toBe('operator');
    expect(byId.get('contrast:failing')).toBe('operator');
    expect(byId.get('contrast:undetermined')).toBe('operator');
    expect(byId.get('contrast:decorative')).toBe('operator');
    expect(byId.get('pdfua')).toBe('operator');
    expect(byId.get('fonts:not-embedded')).toBe('client');
    expect(byId.get('fonts:cidset')).toBe('client');
    expect(byId.get('fonts:other')).toBe('client');
    expect(byId.get('untagged')).toBe('client');
    expect(byId.get('annotations')).toBe('client');
    expect(byId.get('form-fields')).toBe('client');
    expect(byId.get('attachments')).toBe('client');
    // The one item that is not work.
    expect(byId.get('identifier')).toBe('none');
  });
});

describe('withRepairability', () => {
  it('turns a refusal into a client ask that persists with the reading', () => {
    // Today a refusal is an HTTP answer and nothing else: an inspected signed
    // PDF says nothing about its signature until somebody clicks Repair, and
    // then forgets. As an ask it is on the record from the first reading.
    const s = structure({ signed: true });
    const summary = withRepairability(summarise(provenance({ structure: s })), planRepair(s, undefined));
    expect(summary.needs).toContainEqual({
      criterion: 'repair',
      item: expect.stringContaining('digital signature'),
    });
    expect(summary.asks).toContainEqual({
      id: 'repair:signed', kind: 'repair', criterion: 'repair', answerable: 'client',
    });
  });

  it('adds nothing when the document can be repaired', () => {
    const s = structure();
    const before = summarise(provenance({ structure: s }));
    expect(withRepairability(before, planRepair(s, undefined))).toEqual(before);
  });
});

describe('what leaves the vocabulary', () => {
  it('strips asks and the excerpt from the transport copy, and only those', () => {
    const summary = { ...everything(), excerpt: { figures: [] } };
    const forHeader = transportSummary(summary);
    expect('asks' in forHeader).toBe(false);
    expect('excerpt' in forHeader).toBe(false);
    expect(forHeader.needs).toEqual(summary.needs);
    expect(forHeader.conformance).toEqual(summary.conformance);
  });

  it('never lets a bounded copy carry asks — a trimmed list can no longer be indexed', () => {
    const summary = everything();
    const bounded = boundSummary(transportSummary(summary), (v) => JSON.stringify(v).length, 900);
    expect(bounded.needs!.length).toBeLessThan(summary.needs!.length);
    expect('asks' in bounded).toBe(false);
  });

  it('keeps the excerpt out of the logs', () => {
    const summary = { ...summarise(provenance()), excerpt: { figures: [] } };
    expect('excerpt' in logSafe(summary)).toBe(false);
  });
});

describe('withExcerpt', () => {
  it('quotes the document around each open figure so a person can describe it from context', () => {
    const s = structure({
      figures: [
        { type: 'Figure', alt: null, actualText: null, page: 1 },
        { type: 'Figure', alt: 'A site map', actualText: null, page: 2 },
        { type: 'Figure', alt: null, actualText: null, page: 2 },
      ],
      images: 3,
      order: [
        { type: 'H1', text: 'Planning Committee Agenda' },
        { type: 'P', text: 'The site is shown below.' },
        { type: 'Figure', text: null },
        { type: 'Caption', text: 'Figure 1: the proposed site' },
        { type: 'H2', text: 'Parking' },
        { type: 'Figure', text: null },
        { type: 'P', text: 'Spaces are marked.' },
        { type: 'Figure', text: null },
      ],
    });
    const summary = withExcerpt(summarise(provenance({ structure: s })), s);

    expect(summary.excerpt).toEqual({
      figures: [
        {
          ordinal: 0,
          context: {
            heading: 'Planning Committee Agenda',
            before: 'The site is shown below.',
            after: 'Figure 1: the proposed site',
            caption: 'Figure 1: the proposed site',
          },
        },
        // The described figure (ordinal 1) is not open and gets no excerpt;
        // the third figure's nearest text lies behind it.
        { ordinal: 2, context: { heading: 'Parking', before: 'Spaces are marked.' } },
      ],
    });
  });

  it('adds nothing when no figure is open', () => {
    const base = summarise(provenance());
    expect(withExcerpt(base, structure())).toEqual(base);
  });
});

describe('withDeclarations', () => {
  it('records what the pipeline wrote from a person, as counts', () => {
    const summary = withDeclarations(summarise(provenance()), { language: true, figures: 2 });
    expect(summary.declared).toEqual({ language: true, figures: 2 });
  });

  it('records nothing when nothing was declared', () => {
    const base = summarise(provenance());
    expect(withDeclarations(base, { figures: 0 })).toEqual(base);
  });
});

describe('the instrument version', () => {
  it('moved to 12 for the repair ask, so stored baselines read incomparable once', () => {
    expect(INSTRUMENT_VERSION).toBe(12);
  });
});
