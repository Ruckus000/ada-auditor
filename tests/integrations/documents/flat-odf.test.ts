import { describe, expect, it } from 'vitest';

import { deriveAltFromCaptions, firstHeading, readLanguage, readTitle, removeEmptyHeadings, repairTitle } from '../../../src/integrations/documents/flat-odf';

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

describe('removeEmptyHeadings', () => {
  it('removes self-closing, empty-paired, and whitespace-only headings, counting each', () => {
    // The measured shape: every heading "lost" in conversion was an empty
    // one — a blank line an author left heading-styled.
    const { xml, removed } = removeEmptyHeadings(
      '<text:h text:outline-level="1"/>' +
        '<text:h text:outline-level="2"></text:h>' +
        '<text:h text:outline-level="2">   <text:s/>  </text:h>' +
        '<text:h text:outline-level="1">Budget</text:h>',
    );

    expect(removed).toBe(3);
    expect(xml).toBe('<text:h text:outline-level="1">Budget</text:h>');
  });

  it('touches nothing when every heading speaks', () => {
    const input = '<text:h text:outline-level="1">A</text:h><text:p/>';
    expect(removeEmptyHeadings(input)).toEqual({ xml: input, removed: 0 });
  });
});

describe('deriveAltFromCaptions', () => {
  const frame = (inner = '<draw:image/>') =>
    `<draw:frame draw:name="Figure 1">${inner}</draw:frame>`;

  it('transcribes an adjacent caption into svg:desc, before the frame closes', () => {
    // `[V]` The placement is load-bearing: injected before draw:image the
    // exporter drops it; before </draw:frame> it reaches /Alt.
    const { xml, derived } = deriveAltFromCaptions(
      `<text:p>${frame()}</text:p><text:p>Photo: the culvert inlet before clearing</text:p>`,
    );
    expect(derived).toBe(1);
    expect(xml).toContain('<svg:desc>Photo: the culvert inlet before clearing</svg:desc></draw:frame>');
  });

  it('leaves an uncaptioned image alone — its absence belongs on the punch list', () => {
    const input = `<text:p>${frame()}</text:p><text:p>The council met on Tuesday.</text:p>`;
    expect(deriveAltFromCaptions(input)).toEqual({ xml: input, derived: 0 });
  });

  it('never overwrites a description the document already has', () => {
    const input = `<text:p>${frame('<draw:image/><svg:desc>existing</svg:desc>')}</text:p><text:p>Figure 1: new</text:p>`;
    expect(deriveAltFromCaptions(input).derived).toBe(0);
  });

  it('refuses a sentence that merely begins with a caption word', () => {
    // `[V]` The false positive this closes: "Map of the district was
    // circulated to members." is a sentence about a meeting, and it became an
    // image's description. Worse than no description, because it also silences
    // the 1.1.1 punch item that would have reported the figure as undescribed
    // — so nobody ever finds out it is wrong.
    const prose = [
      'Map of the district was circulated to members.',
      'Maps of the district are available on request.',
      'The committee agreed to proceed.',
      'Figures were presented by the treasurer.',
      'Photographs may be requested from the clerk.',
    ];
    for (const text of prose) {
      const input = `<text:p>${frame()}</text:p><text:p>${text}</text:p>`;
      expect(deriveAltFromCaptions(input), text).toEqual({ xml: input, derived: 0 });
    }
  });

  it('still transcribes the labelled shapes an author writes', () => {
    // A number or letter ("Figure 3", "Exhibit A"), or a delimiter that marks a
    // label ("Photo —", "Image:"). Both are the shape of something written to
    // NAME a figure rather than to say something.
    const captions = [
      'Figure 3: the site plan',
      'Figure 3 The site plan',
      'Fig. 2 — Culvert inlet',
      'Photo — the mayor at the opening',
      'Exhibit A: schedule of fees',
      'Map 4: district boundaries',
      'Chart 1 Annual rainfall',
      'Illustration B — cross-section',
      'Image: front elevation',
    ];
    for (const text of captions) {
      const input = `<text:p>${frame()}</text:p><text:p>${text}</text:p>`;
      expect(deriveAltFromCaptions(input).derived, text).toBe(1);
    }
  });

  it('transcribes only from the paragraph that immediately follows', () => {
    // Adjacency was already strict and is worth pinning: a heading or a body
    // paragraph in between means the caption-shaped text belongs to something
    // else, and pairing across it would attach a description to the wrong
    // image.
    const separated = [
      `<text:p>${frame()}</text:p><text:h>Section 2</text:h><text:p>Figure 3: the site plan</text:p>`,
      `<text:p>${frame()}</text:p><text:p>Unrelated body text.</text:p><text:p>Figure 3: the site plan</text:p>`,
    ];
    for (const input of separated) {
      expect(deriveAltFromCaptions(input).derived).toBe(0);
    }
  });

  it('escapes caption entities on the way in', () => {
    const { xml } = deriveAltFromCaptions(
      `<text:p>${frame()}</text:p><text:p>Figure 2: Roads &amp; Bridges</text:p>`,
    );
    expect(xml).toContain('<svg:desc>Figure 2: Roads &amp; Bridges</svg:desc>');
  });
});
