import { describe, expect, it } from 'vitest';

import { languageToCarry } from '../../src/domain/document-structure';
import { docxDeclaredLanguage } from '../../src/domain/docx-language';
import { sourceTruthFromDocx, sourceTruthFromFodt } from '../../src/domain/source-truth';
import { para, styleDef, wordCore, wordDocument, wordStyles, zip } from '../support/docx-fixture';

/**
 * The readers behind the fidelity check.
 *
 * These decide what "the source said" means, so every number the comparator
 * reports rests on them. The three heading dialects below are not hypothetical
 * shapes: each was found in a real municipal document, and the first version of
 * this reader saw only one of them — mis-grading legitimate transcription as
 * invention, on documents that were fine.
 */

const readable = (bytes: Uint8Array) => {
  const truth = sourceTruthFromDocx(bytes);
  if (!truth.readable) throw new Error('expected a readable reading');
  return truth;
};

describe('headings, in all three dialects municipalities actually use', () => {
  it('reads levels from a style definition carrying an outline level', () => {
    // `[V]` One document used a style literally named "Heading", no digit — so
    // the level can only come from the style DEFINITION, not from its name.
    const truth = readable(
      zip([
        ['word/document.xml', wordDocument(para('A Section', { style: 'Heading' }))],
        ['word/styles.xml', wordStyles('en-US', styleDef('Heading', 1))],
      ]),
    );
    expect(truth.headingLevels).toEqual([2]);
  });

  it('falls back to the literal HeadingN style name', () => {
    const truth = readable(
      zip([
        ['word/document.xml', wordDocument(para('A Section', { style: 'Heading3' }))],
        ['word/styles.xml', wordStyles('en-US')],
      ]),
    );
    expect(truth.headingLevels).toEqual([3]);
  });

  it('reads a direct-formatting outline level with no style at all', () => {
    // `[V]` Four documents declared all their structure this way — zero pStyle
    // anywhere in the body.
    const truth = readable(
      zip([
        ['word/document.xml', wordDocument(para('A Section', { outline: 1 }))],
        ['word/styles.xml', wordStyles('en-US')],
      ]),
    );
    expect(truth.headingLevels).toEqual([2]);
  });

  it('records the sequence in document order, not just a count', () => {
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument(
            para('One', { style: 'Heading1' }) +
              para('Two', { style: 'Heading3' }) +
              para('Three', { style: 'Heading2' }),
          ),
        ],
        ['word/styles.xml', wordStyles('en-US')],
      ]),
    );
    expect(truth.headingLevels).toEqual([1, 3, 2]);
    expect(truth.headings).toBe(3);
  });

  it('does not count a heading-styled line that says nothing', () => {
    // `[V]` Every heading "lost" in conversion was an empty one. The pipeline
    // deletes those; truth must not count them, or the two disagree forever.
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument(
            para('Real', { style: 'Heading1' }) +
              '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t></w:t></w:r></w:p>' +
              '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>   </w:t></w:r></w:p>',
          ),
        ],
        ['word/styles.xml', wordStyles('en-US')],
      ]),
    );
    expect(truth.headingLevels).toEqual([1]);
  });

  it('does not mistake a pPr block for a paragraph', () => {
    const truth = readable(
      zip([
        ['word/document.xml', wordDocument(para('Body text'))],
        ['word/styles.xml', wordStyles('en-US')],
      ]),
    );
    expect(truth.headings).toBe(0);
  });
});

describe('figures, in both image dialects', () => {
  it('counts DrawingML images and reads their descr as alt', () => {
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument(
            '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="a" descr="The city seal"/></wp:inline></w:drawing></w:r></w:p>' +
              '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="2" name="b"/></wp:inline></w:drawing></w:r></w:p>',
          ),
        ],
      ]),
    );
    expect(truth.figures).toBe(2);
    expect(truth.figuresWithAlt).toBe(1);
  });

  it('counts VML images, which a DrawingML-only reader cannot see', () => {
    // `[V]` One real municipal document held its two images as OLE-embedded
    // WMFs. A docPr-only count read the pipeline's honest 1.1.1 gap as an
    // import invention.
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument(
            '<w:p><w:r><w:pict><v:shape id="s1" alt="A map"><v:imagedata r:id="rId4"/></v:shape></w:pict></w:r></w:p>' +
              '<w:p><w:r><w:pict><v:shape id="s2"><v:imagedata r:id="rId5"/></v:shape></w:pict></w:r></w:p>',
          ),
        ],
      ]),
    );
    expect(truth.figures).toBe(2);
    expect(truth.figuresWithAlt).toBe(1);
  });

  it('does not count a VML shape whose only content is a text box', () => {
    // `[V]` Measured through a real conversion: a textbox-only `v:shape`
    // produces NO /Figure. A text box is text, not a graphic.
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument('<w:p><w:r><w:pict><v:shape id="s1"><v:textbox/></v:shape></w:pict></w:r></w:p>'),
        ],
      ]),
    );
    expect(truth.figures).toBe(0);
  });

  it('counts VML shapes that DRAW without carrying a raster image', () => {
    // `[V]` Measured through a real conversion, three fixtures, all of which
    // produced exactly one tagged /Figure with zero image XObjects on the page:
    // a `v:shape` with preset geometry and no imagedata, a `v:rect`, and a
    // `v:oval`. Reading them as zero source figures made the delivered document
    // look like it had invented a graphic, and the gate refused it with a 422.
    //
    // The same class as r09's `draw:custom-shape` on the flat-ODF path, which
    // was caught in measurement; this half was caught in review. Note that
    // `v:rect` and `v:oval` are not `v:shape` at all, so a shape-only reader
    // could never have seen them.
    for (const [what, markup] of [
      ['autoshape', '<v:shape id="s1" coordsize="21600,21600" path="m0,0l21600,0xe" fillcolor="#ccc"><v:path/></v:shape>'],
      ['rect', '<v:rect id="r1" style="width:120pt;height:60pt" fillcolor="#999"/>'],
      ['oval', '<v:oval id="o1" style="width:100pt;height:80pt"/>'],
      ['line', '<v:line id="l1" from="0,0" to="100pt,0"/>'],
    ] as const) {
      const truth = readable(
        zip([['word/document.xml', wordDocument(`<w:p><w:r><w:pict>${markup}</w:pict></w:r></w:p>`)]]),
      );
      expect(truth.figures, what).toBe(1);
    }
  });

  it('reads alt off a drawn VML shape, not only off a picture', () => {
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument(
            '<w:p><w:r><w:pict><v:rect id="r1" alt="An organisational chart" style="width:9pt"/></w:pict></w:r></w:p>',
          ),
        ],
      ]),
    );
    expect(truth.figures).toBe(1);
    expect(truth.figuresWithAlt).toBe(1);
  });

  it('does not mistake a v:shapetype definition for a drawn shape', () => {
    // `<v:shapetype>` declares a preset for later `v:shape` elements to reuse.
    // It draws nothing itself, and counting it would inflate every document
    // Word wrote with legacy shapes.
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument(
            '<w:p><w:r><w:pict><v:shapetype id="_x0000_t202" coordsize="21600,21600"><v:path/></v:shapetype>' +
              '<v:shape id="s1" type="#_x0000_t202"><v:textbox/></v:shape></w:pict></w:r></w:p>',
          ),
        ],
      ]),
    );
    expect(truth.figures).toBe(0);
  });

  it('treats an empty descr as no description', () => {
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument('<w:p><w:r><w:drawing><wp:docPr id="1" name="a" descr=""/></w:drawing></w:r></w:p>'),
        ],
      ]),
    );
    expect(truth.figures).toBe(1);
    expect(truth.figuresWithAlt).toBe(0);
  });
});

describe('lists, tables, title and language', () => {
  it('counts list ITEMS, and groups separately', () => {
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument(
            '<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>a</w:t></w:r></w:p>' +
              '<w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>b</w:t></w:r></w:p>' +
              '<w:p><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>c</w:t></w:r></w:p>',
          ),
        ],
      ]),
    );
    expect(truth.listItems).toBe(3);
    expect(truth.lists).toBe(2);
  });

  it('counts list items numbered at the STYLE level, not only inline', () => {
    // `[V]` Blind corpus r34: `document.xml` carries 13 inline `w:numPr` and
    // `styles.xml` carries 21 — the document numbers through its styles, so its
    // list paragraphs have no inline numbering at all. Reading 13 against 93
    // delivered turned a faithful conversion into "the pipeline invented 80
    // list items" and refused the document. The pipeline cannot manufacture 80
    // list items; the reader was low.
    const styles =
      '<w:styles><w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:styleId="ListPara"><w:name w:val="List Paragraph"/>' +
      '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr></w:pPr></w:style>' +
      '</w:styles>';
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument(
            para('one', { style: 'ListPara' }) +
              para('two', { style: 'ListPara' }) +
              para('three', { style: 'ListPara' }) +
              '<w:p><w:pPr><w:numPr><w:numId w:val="9"/></w:numPr></w:pPr><w:r><w:t>inline</w:t></w:r></w:p>',
          ),
        ],
        ['word/styles.xml', styles],
      ]),
    );
    expect(truth.listItems).toBe(4);
  });

  it('does not count a paragraph whose numbering is explicitly REMOVED', () => {
    // `<w:numId w:val="0"/>` is OOXML's removal marker, not a reference to list
    // zero: it says this paragraph does not number, and it is how a document
    // takes one paragraph out of a style-numbered run. Counting it inflates the
    // source read by one per removal — which points the reader the opposite way
    // from every other bug found this week, and inflates omissions rather than
    // causing a refusal.
    const styles =
      '<w:styles><w:style w:styleId="ListPara">' +
      '<w:pPr><w:numPr><w:numId w:val="4"/></w:numPr></w:pPr></w:style></w:styles>';
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument(
            para('a', { style: 'ListPara' }) +
              para('b', { style: 'ListPara' }) +
              // Same style, numbering removed on this one paragraph.
              '<w:p><w:pPr><w:pStyle w:val="ListPara"/><w:numPr><w:numId w:val="0"/></w:numPr></w:pPr>' +
              '<w:r><w:t>not a list item</w:t></w:r></w:p>',
          ),
        ],
        ['word/styles.xml', styles],
      ]),
    );
    expect(truth.listItems).toBe(2);
  });

  it('DOES count an empty numbered paragraph, unlike an empty heading', () => {
    const styles =
      '<w:styles><w:style w:type="paragraph" w:styleId="ListPara">' +
      '<w:pPr><w:numPr><w:numId w:val="4"/></w:numPr></w:pPr></w:style></w:styles>';
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument(
            para('real', { style: 'ListPara' }) +
              '<w:p><w:pPr><w:pStyle w:val="ListPara"/></w:pPr><w:r><w:t>  </w:t></w:r></w:p>',
          ),
        ],
        ['word/styles.xml', styles],
      ]),
    );
    // `[V]` The asymmetry is measured, not stylistic. `removeEmptyHeadings`
    // deletes a blank heading-styled line, so truth must not count it. Nothing
    // deletes a blank numbered line — r04 and r08 each carry one, the export
    // keeps it, and skipping it read 24 against 25 delivered and refused both.
    expect(truth.listItems).toBe(2);
  });

  it('reads heading levels from the style’s canonical NAME, whatever the id is', () => {
    // `[V]` Blind corpus r28: 13 heading-styled paragraphs read as 9, and the
    // under-count inverted the sign — a heading LOST (13 source, 12 delivered)
    // was reported as structure INVENTED, refusing the document. A lost heading
    // reported as an invented one is worse than a missed finding.
    //
    // `w:name` is OOXML's canonical built-in name and is lower-case with a
    // space ("heading 1"); the id is whatever the producer chose. Matching only
    // a case-sensitive `Heading1` id misses every other spelling.
    const styles =
      '<w:styles>' +
      '<w:style w:type="paragraph" w:styleId="Overskrift1"><w:name w:val="heading 1"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="heading2"><w:name w:val="Heading 2"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/></w:style>' +
      '</w:styles>';
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument(
            para('a', { style: 'Overskrift1' }) +
              para('b', { style: 'heading2' }) +
              para('c', { style: 'Heading3' }),
          ),
        ],
        ['word/styles.xml', styles],
      ]),
    );
    expect(truth.headingLevels).toEqual([1, 2, 3]);
  });

  it('follows w:basedOn to a heading ancestor', () => {
    // `[V]` Blind corpus r28. "Style Heading 2 + Not Italic" is literally what
    // Word auto-generates when someone changes formatting on a heading, so this
    // shape is in a large fraction of real municipal documents. The derived
    // style declares no `outlineLvl` of its own — it inherits — and its
    // `w:name` does not match a canonical heading name, so a reader checking
    // only outline level, name and id misses every paragraph using it.
    // LibreOffice resolves the inheritance, which is why they arrive as
    // headings in the PDF and the two readings disagree.
    const styles =
      '<w:styles>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>' +
      '<w:style w:type="paragraph" w:customStyle="1" w:styleId="StyleHeading2NotItalic">' +
      '<w:name w:val="Style Heading 2 + Not Italic"/><w:basedOn w:val="Heading2"/></w:style>' +
      '</w:styles>';
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument(
            para('canonical', { style: 'Heading2' }) +
              para('derived', { style: 'StyleHeading2NotItalic' }),
          ),
        ],
        ['word/styles.xml', styles],
      ]),
    );
    expect(truth.headingLevels).toEqual([2, 2]);
  });

  it('does not inherit heading-ness into a style whose own role is not content', () => {
    // `[V]` Blind corpus r23 and r30. Word's `TOCHeading` is `basedOn Heading1`
    // purely to borrow its formatting, so a fixed-point walk resolves it to
    // level 1 and counts the "Table of Contents" caption as a content heading.
    // The exporter produces no PDF heading for it, so each document reported
    // "1 heading did not survive conversion" about something that was never
    // content — two of nine documents, and it recurs on any document with a
    // generated contents page, which for municipal reports is most long ones.
    //
    // The distinction is semantic, not structural: "Style Heading 2 + Not
    // Italic" also carries a non-heading name and also inherits, and that one
    // IS a content heading. So the rule names the role rather than guessing
    // from shape.
    const styles =
      '<w:styles>' +
      '<w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>' +
      '<w:style w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Heading1"/></w:style>' +
      '<w:style w:customStyle="1" w:styleId="StyleHeading1Blue">' +
      '<w:name w:val="Style Heading 1 + Blue"/><w:basedOn w:val="Heading1"/></w:style>' +
      '</w:styles>';
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument(
            para('Table of Contents', { style: 'TOCHeading' }) +
              para('A Real Section', { style: 'Heading1' }) +
              para('Another Real Section', { style: 'StyleHeading1Blue' }),
          ),
        ],
        ['word/styles.xml', styles],
      ]),
    );
    // The TOC caption is not counted; the formatting-derived heading still is.
    expect(truth.headingLevels).toEqual([1, 1]);
  });

  it('follows a chain of basedOn, and survives a cycle', () => {
    // Word writes these chained — a tweak of a tweak. A cycle is malformed but
    // a reader that loops on one is worse than a reader that gives up on it.
    const styles =
      '<w:styles>' +
      '<w:style w:styleId="Heading3"><w:name w:val="heading 3"/></w:style>' +
      '<w:style w:styleId="A"><w:name w:val="Style A"/><w:basedOn w:val="Heading3"/></w:style>' +
      '<w:style w:styleId="B"><w:name w:val="Style B"/><w:basedOn w:val="A"/></w:style>' +
      '<w:style w:styleId="Loop1"><w:name w:val="Loop One"/><w:basedOn w:val="Loop2"/></w:style>' +
      '<w:style w:styleId="Loop2"><w:name w:val="Loop Two"/><w:basedOn w:val="Loop1"/></w:style>' +
      '</w:styles>';
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument(para('deep', { style: 'B' }) + para('cyclic', { style: 'Loop1' })),
        ],
        ['word/styles.xml', styles],
      ]),
    );
    expect(truth.headingLevels).toEqual([3]);
  });

  it('inherits numbering through basedOn too', () => {
    const styles =
      '<w:styles>' +
      '<w:style w:styleId="ListPara"><w:pPr><w:numPr><w:numId w:val="4"/></w:numPr></w:pPr></w:style>' +
      '<w:style w:styleId="ListTight"><w:basedOn w:val="ListPara"/></w:style>' +
      '</w:styles>';
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument(para('a', { style: 'ListPara' }) + para('b', { style: 'ListTight' })),
        ],
        ['word/styles.xml', styles],
      ]),
    );
    expect(truth.listItems).toBe(2);
  });

  it('does not treat a style merely named like a heading in prose as one', () => {
    // "Heading Note" is not "heading 3". The name match is anchored.
    const styles =
      '<w:styles><w:style w:type="paragraph" w:styleId="HeadNote">' +
      '<w:name w:val="Heading Note"/></w:style></w:styles>';
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument(para('not a heading', { style: 'HeadNote' })),
        ],
        ['word/styles.xml', styles],
      ]),
    );
    expect(truth.headings).toBe(0);
  });

  it('counts tables, and does not double-count their properties block', () => {
    // `<w:tblPr>` is the sibling that a bare `<w:tbl` prefix match would count
    // as a second table on every real document.
    const truth = readable(
      zip([
        [
          'word/document.xml',
          wordDocument(
            '<w:tbl><w:tblPr><w:tblW w:w="0"/></w:tblPr><w:tr><w:tc/></w:tr></w:tbl>' +
              '<w:tbl><w:tblPr/><w:tr><w:tc/></w:tr></w:tbl>',
          ),
        ],
      ]),
    );
    expect(truth.tables).toBe(2);
  });

  it('reads a title, and treats a whitespace-only one as absent', () => {
    const withTitle = readable(
      zip([
        ['word/document.xml', wordDocument()],
        ['docProps/core.xml', wordCore('Budget Hearing')],
      ]),
    );
    expect(withTitle.title).toBe('Budget Hearing');

    const blank = readable(
      zip([
        ['word/document.xml', wordDocument()],
        ['docProps/core.xml', wordCore('   ')],
      ]),
    );
    expect(blank.title).toBeNull();
  });

  it('agrees with the parser that decides what /Lang is actually written', () => {
    // The property under test is AGREEMENT, not a value. `docxDeclaredLanguage`
    // is what `Finish` writes into the PDF (`convert.ts`); this reader is what
    // the fidelity gate holds that against. Any disagreement is read as the
    // pipeline inventing a language, and refuses the document with a 422.
    //
    // `[V]` Both shapes below did exactly that before this reader was pointed
    // at the same function. It is the failure `extract-docx-truth.mjs` already
    // records — "seven inventions that were two parsers disagreeing about one
    // file" — reintroduced on the OOXML path and caught in review.
    const cases: Array<[string, Uint8Array]> = [
      [
        'no styles.xml at all, language only on a body run',
        zip([
          [
            'word/document.xml',
            wordDocument('<w:p><w:r><w:rPr><w:lang w:val="es-ES"/></w:rPr><w:t>hola</w:t></w:r></w:p>'),
          ],
        ]),
      ],
      [
        'docDefaults declares none, but a later style does',
        zip([
          [
            'word/document.xml',
            wordDocument('<w:p><w:r><w:rPr><w:lang w:val="en-US"/></w:rPr><w:t>hello</w:t></w:r></w:p>'),
          ],
          [
            'word/styles.xml',
            wordStyles(null, '<w:style w:styleId="Heading1"><w:rPr><w:lang w:val="fr-FR"/></w:rPr></w:style>'),
          ],
        ]),
      ],
    ];

    for (const [what, bytes] of cases) {
      const written = docxDeclaredLanguage(bytes);
      const read = sourceTruthFromDocx(bytes);
      expect(read.readable, what).toBe(true);
      expect(written.readable, what).toBe(true);
      if (read.readable && written.readable) {
        // Against what is CARRIED, not what is parsed. `convert.ts` puts
        // `languageToCarry` between the parser and `Finish`, so comparing to
        // the raw parse would let the two sides disagree on any tag the
        // schema refuses — which is the disagreement this whole case exists
        // to forbid.
        expect(read.language, what).toBe(languageToCarry(written.language));
      }
    }
  });

  it('declines an unusable tag exactly as the pipeline does', () => {
    // `[V]` A `w:lang w:val="en US"` is a real shape — `docx-language.test.ts`
    // enumerates it beside `''`, `'not a language'`, `'!!'` and `'e'`. The
    // pipeline refuses to carry it, so `/Lang` comes out null. Read raw here,
    // the source would be "declares a language" against a delivered document
    // carrying none, and the client would be told their language was lost
    // when the truth is their tag was never usable.
    for (const junk of ['en US', 'not a language', '!!', 'e']) {
      const bytes = zip([
        ['[Content_Types].xml', '<Types/>'],
        ['word/document.xml', wordDocument('<w:p/>')],
        ['word/styles.xml', wordStyles(junk)],
      ]);

      const truth = sourceTruthFromDocx(bytes);
      expect(truth.readable, junk).toBe(true);
      if (truth.readable) expect(truth.language, junk).toBeNull();
    }
  });

  it('reads the declared language un-widened, and null when none is declared', () => {
    for (const lang of ['en', 'es', 'ar', 'zh-CN']) {
      const truth = readable(
        zip([
          ['word/document.xml', wordDocument()],
          ['word/styles.xml', wordStyles(lang)],
        ]),
      );
      expect(truth.language).toBe(lang);
    }
    const none = readable(
      zip([
        ['word/document.xml', wordDocument()],
        ['word/styles.xml', wordStyles(null)],
      ]),
    );
    expect(none.language).toBeNull();
  });
});

describe('containers this cannot read', () => {
  it('reports unreadable for a ZIP that is not a Word document', () => {
    expect(sourceTruthFromDocx(zip([['readme.txt', 'hello']]))).toEqual({ readable: false });
  });

  it('reports unreadable for bytes that are not a ZIP at all', () => {
    // Legacy .doc is an OLE compound file. `sourceTruthFromFodt` covers it.
    expect(sourceTruthFromDocx(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]))).toEqual({
      readable: false,
    });
  });

  it('reads stored entries as well as deflated ones', () => {
    const stored = readable(
      zip([['word/document.xml', wordDocument(para('One', { style: 'Heading1' }))]], 0),
    );
    expect(stored.headingLevels).toEqual([1]);
  });

  it('survives a missing styles part rather than throwing', () => {
    const truth = readable(zip([['word/document.xml', wordDocument(para('text'))]]));
    expect(truth.language).toBeNull();
    expect(truth.title).toBeNull();
  });
});

describe('the flat-ODF fallback, for legacy .doc', () => {
  const fodt = (body: string, title = '') =>
    `<office:document><office:meta>${title}</office:meta><office:body><office:text>${body}</office:text></office:body></office:document>`;

  it('labels every reading engine-derived, never source truth', () => {
    const truth = sourceTruthFromFodt(fodt('<text:p>body</text:p>'), 'en-US');
    expect(truth.readable).toBe(true);
    if (truth.readable) expect(truth.oracle).toBe('engine-derived');
  });

  it('reads heading levels and skips empty headings, matching the OOXML rule', () => {
    const truth = sourceTruthFromFodt(
      fodt(
        '<text:h text:outline-level="1">One</text:h>' +
          '<text:h text:outline-level="3">Three</text:h>' +
          '<text:h text:outline-level="2">   </text:h>',
      ),
      null,
    );
    if (!truth.readable) throw new Error('expected readable');
    expect(truth.headingLevels).toEqual([1, 3]);
  });

  it('takes its language from the caller, never parsing one itself', () => {
    // `[V]` A second language parser read "en" where `readLanguage` composes
    // "en-US", and the grader reported seven inventions that were two parsers
    // disagreeing about one file. One parser.
    const truth = sourceTruthFromFodt(fodt('<text:p>x</text:p>'), 'cy-GB');
    if (!truth.readable) throw new Error('expected readable');
    expect(truth.language).toBe('cy-GB');
  });

  it('counts framed images and the descriptions on them', () => {
    const truth = sourceTruthFromFodt(
      fodt(
        '<draw:frame><draw:image xlink:href="a.png"/><svg:desc>The seal</svg:desc></draw:frame>' +
          '<draw:frame><draw:image xlink:href="b.png"/></draw:frame>' +
          '<draw:frame><draw:text-box/></draw:frame>',
      ),
      null,
    );
    if (!truth.readable) throw new Error('expected readable');
    expect(truth.figures).toBe(2);
    expect(truth.figuresWithAlt).toBe(1);
  });

  it('reports unreadable when there is no office:text at all', () => {
    expect(sourceTruthFromFodt('<office:document/>', null)).toEqual({ readable: false });
  });
});
