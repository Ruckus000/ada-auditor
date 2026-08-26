import { describe, expect, it } from 'vitest';

import {
  firstHeading,
  readLanguage,
  readTitle,
  repairTitle,
} from '../../../src/integrations/documents/flat-odf';

/**
 * The transcription rules, without LibreOffice.
 *
 * These are pure string transforms, so they belong in the fast suite even
 * though they live under `integrations/` — the layering rule is about what a
 * module *imports*, and this imports nothing.
 *
 * Every case here is really the same question asked five ways: does it copy
 * only what the document states?
 */

const meta = (inner: string) =>
  `<?xml version="1.0"?><office:document><office:meta>${inner}</office:meta>` +
  `<office:body><office:text></office:text></office:body></office:document>`;

const withBody = (metaInner: string, body: string) =>
  `<?xml version="1.0"?><office:document><office:meta>${metaInner}</office:meta>` +
  `<office:body><office:text>${body}</office:text></office:body></office:document>`;

describe('readTitle', () => {
  it('reads a declared title', () => {
    expect(readTitle(meta('<dc:title>Committee Agenda</dc:title>'))).toBe('Committee Agenda');
  });

  it('treats an empty or whitespace title as absent', () => {
    // Unlike image alt text, a title has no "deliberately blank" meaning —
    // nobody marks a document as intentionally untitled.
    expect(readTitle(meta('<dc:title></dc:title>'))).toBeNull();
    expect(readTitle(meta('<dc:title>   </dc:title>'))).toBeNull();
    expect(readTitle(meta(''))).toBeNull();
  });

  it('decodes entities rather than returning raw markup', () => {
    expect(readTitle(meta('<dc:title>Planning &amp; Zoning</dc:title>'))).toBe('Planning & Zoning');
  });
});

describe('firstHeading', () => {
  it('reads the first heading the source marks as one', () => {
    const xml = withBody('', '<text:h text:outline-level="1">Agenda</text:h><text:p>Body</text:p>');
    expect(firstHeading(xml)).toBe('Agenda');
  });

  it('strips inline markup inside the heading', () => {
    const xml = withBody('', '<text:h><text:span>Planning</text:span> Committee</text:h>');
    expect(firstHeading(xml)).toBe('Planning Committee');
  });

  it('returns null when the document marks no heading', () => {
    // The case that blocks four of the nine real municipal documents. It must
    // not fall through to body text.
    const xml = withBody('', '<text:p>This looks like a title but is not one</text:p>');
    expect(firstHeading(xml)).toBeNull();
  });
});

describe('readLanguage', () => {
  it('reads a bare language', () => {
    expect(readLanguage('<style:text-properties fo:language="cy" />')).toBe('cy');
  });

  it('pairs language with country when the source states both', () => {
    expect(
      readLanguage('<style:text-properties fo:language="cy" fo:country="GB" />'),
    ).toBe('cy-GB');
  });

  it('returns null when the source declares no language', () => {
    // Load-bearing. LibreOffice writes `en-US` onto the exported PDF anyway,
    // and this null is what tells the pipeline to remove that claim rather
    // than carry a statement the document never made.
    expect(readLanguage(withBody('', '<text:p>No language anywhere.</text:p>'))).toBeNull();
  });

  it('does not widen a bare language into a regional variant', () => {
    // LibreOffice turns a declared `en` into `en-US` on export. `en` and
    // `en-US` are different claims, and only one of them was made.
    expect(readLanguage('<style:text-properties fo:language="en" />')).toBe('en');
  });
});

describe('repairTitle', () => {
  it('leaves an already-titled document alone', () => {
    const xml = meta('<dc:title>Real Title</dc:title>');
    const result = repairTitle(xml);

    expect(result.xml).toBe(xml);
    expect(result.outcome).toEqual({ kind: 'already-titled', title: 'Real Title' });
  });

  it('transcribes the first heading into an absent title', () => {
    const xml = withBody('', '<text:h>Planning Committee</text:h><text:p>Body</text:p>');
    const result = repairTitle(xml);

    expect(result.outcome).toEqual({ kind: 'transcribed', title: 'Planning Committee' });
    expect(readTitle(result.xml)).toBe('Planning Committee');
  });

  it('fills an empty title element in place', () => {
    const xml = withBody('<dc:title/>', '<text:h>Agenda</text:h>');
    const result = repairTitle(xml);

    expect(readTitle(result.xml)).toBe('Agenda');
    // One title element, not two — a second would be written and ignored.
    expect(result.xml.match(/<dc:title>/g)?.length).toBe(1);
  });

  it('declines when there is no heading to copy, and says so', () => {
    // The honest outcome, and the one that blocks four real documents. An
    // untitled document stays untitled and fails 2.4.2 visibly.
    const xml = withBody('', '<text:p>Body text that is not a heading.</text:p>');
    const result = repairTitle(xml);

    expect(result.xml).toBe(xml);
    expect(result.outcome).toEqual({ kind: 'no-heading-to-copy' });
    expect(readTitle(result.xml)).toBeNull();
  });

  it('escapes markup characters when transcribing', () => {
    // A heading containing `&` must not produce invalid XML downstream.
    const xml = withBody('', '<text:h>Planning &amp; Zoning</text:h>');
    const result = repairTitle(xml);

    expect(result.xml).toContain('<dc:title>Planning &amp; Zoning</dc:title>');
    expect(readTitle(result.xml)).toBe('Planning & Zoning');
  });
});
