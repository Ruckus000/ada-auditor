import { z } from 'zod';

import { languageToCarry } from './document-structure';
import { docxDeclaredLanguage, zipEntry } from './docx-language';

/**
 * What the SOURCE document says about its own structure.
 *
 * A Word document states its headings, tables, lists and figures explicitly, in
 * its own XML. That statement is authored fact, not inference — which makes it
 * the one reference a client's document carries with it, and the only thing we
 * can hold a delivered PDF against without hand-authored ground truth.
 *
 * This is the reference half of the fidelity check. `source-fidelity.ts` is the
 * comparison; `integrations/documents/source-truth.ts` is the reader that fills
 * this in. The type lives here because the domain comparator and an integration
 * both need it and neither may import the other — the same reason
 * `ConversionProvenance` lives in `document-remediation.ts`.
 *
 * ## Why this is not `contentChanges`
 *
 * `contentChanges` in `document-structure.ts` compares a reading of the PDF
 * with a later reading of the same PDF, and answers "did the repair step move
 * anything". It needs no reference, which is exactly why it works on a client's
 * PDF that has none. It cannot answer "does the output match what the author
 * wrote", because both its readings come from the output. Two instruments, two
 * questions; neither replaces the other.
 */

/**
 * Where the reading came from, and therefore how much it is worth.
 *
 * `ooxml` is the document's own XML, read without LibreOffice — an independent
 * reference, so a comparison against it grades the whole chain, import and
 * export both.
 *
 * `engine-derived` is a reading taken from LibreOffice's flat-ODF import,
 * because legacy `.doc` is an OLE container with no XML to read. The importer
 * produced the reference, so a comparison against it grades **the export half
 * only** — it cannot see a heading the importer itself dropped. Weaker than
 * source truth and far better than ungraded, and it is labelled rather than
 * quietly mixed in, on the `Conformance.checker: 'none'` precedent: a reading
 * that means less must never render as a reading that means more.
 */
export type SourceOracle = 'ooxml' | 'engine-derived';

export const sourceTruthSchema = z.union([
  /**
   * Neither oracle could read it. Not an error and not a clean bill: the
   * fidelity check reports "not verified" and the conversion is unaffected,
   * exactly as an absent `conformance` renders as "not checked".
   */
  z.object({ readable: z.literal(false) }),
  z.object({
    readable: z.literal(true),
    oracle: z.enum(['ooxml', 'engine-derived']),
    /** `dc:title`, or null when the field is absent or whitespace. */
    title: z.string().nullable(),
    /**
     * The language the document declares, by `docxDeclaredLanguage`'s rule —
     * the same function that decides what is written into the PDF. Null means
     * the document declares none, which is a claim rather than a gap.
     */
    language: z.string().nullable(),
    /** `headingLevels.length`, carried so a reader need not derive it. */
    headings: z.number().int().nonnegative(),
    /**
     * One entry per heading that carries text, in document order, 1-based.
     *
     * The sequence, not just the count: a delivered document can carry the
     * right NUMBER of headings and restate the author's hierarchy at different
     * depths, and that is the defect class the 2026-08-27 campaign left
     * itemised on five real documents.
     */
    headingLevels: z.array(z.number().int().positive()),
    tables: z.number().int().nonnegative(),
    /** Distinct numbering groups. Recorded, but `listItems` is what is compared. */
    lists: z.number().int().nonnegative(),
    /**
     * List ITEMS, which is the unit that survives the export.
     *
     * `[V]` The export splits one Word numbering group into several PDF `L`
     * structures wherever the list is interrupted — one source group became
     * twelve delivered lists on a real document — so group counts disagree
     * between two honest instruments while the item count is the same content
     * on both sides.
     */
    listItems: z.number().int().nonnegative(),
    figures: z.number().int().nonnegative(),
    /** Figures the AUTHOR described. The floor the delivered document must meet. */
    figuresWithAlt: z.number().int().nonnegative(),
  }),
]);

export type SourceTruth = z.infer<typeof sourceTruthSchema>;
export type ReadableSourceTruth = Extract<SourceTruth, { readable: true }>;

/* -------------------------------------------------------------------------- */
/*  Readers. Both pure: bytes or XML in, a reading out.                        */
/* -------------------------------------------------------------------------- */

const UNREADABLE: SourceTruth = { readable: false };

const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;

/**
 * What a `.docx` says about itself, from its own bytes.
 *
 * No subprocess and no filesystem — `zipEntry` walks the central directory and
 * `inflateRawSync` does the rest, so this runs identically on a laptop and
 * inside a deployed function. That matters more than it looks: the spike shelled
 * out to `unzip`, and this project has already lost four separate rounds to
 * binaries that were present locally and absent in the runtime.
 *
 * Returns `readable: false` for legacy `.doc`, which is an OLE container with
 * no XML to read. `sourceTruthFromFodt` is the fallback for that case.
 */
export function sourceTruthFromDocx(bytes: Uint8Array): SourceTruth {
  const documentPart = zipEntry(bytes, 'word/document.xml');
  if (documentPart === null) return UNREADABLE;

  const doc = documentPart.toString('utf8');
  const styles = zipEntry(bytes, 'word/styles.xml')?.toString('utf8') ?? '';
  const core = zipEntry(bytes, 'docProps/core.xml')?.toString('utf8') ?? '';
  // Cannot be unreadable: `docxDeclaredLanguage` returns that only when
  // `word/document.xml` is missing, and the guard above already returned for
  // that. Narrowed rather than asserted, so a future change to either rule
  // fails here instead of silently defaulting to "declares none".
  const declared = docxDeclaredLanguage(bytes);
  // Through `languageToCarry`, because the pipeline does. `convert.ts` puts it
  // between this parser and `Finish`, so an unusable tag — `en US`, `!!` — is
  // parsed identically on both sides and then DECLINED on the delivered one.
  // Read raw, the source would declare a language the delivered document does
  // not carry, and the client would be told their language was lost when the
  // truth is their tag was never usable. Same parser, and now the same rule
  // about what that parse is worth.
  const language = declared.readable ? languageToCarry(declared.language) : null;

  // Headings: any paragraph whose STYLE DEFINITION carries an outline level
  // (covering HeadingN and every custom style — `[V]` one municipal document
  // used a style literally named "Heading", no digit), plus paragraphs with a
  // direct-formatting `w:outlineLvl` (`[V]` four documents declared all their
  // structure that way, zero pStyle in the body). A pStyle-name-only version
  // under-read both shapes and mis-graded legitimate transcription as
  // invention.
  //
  // Two passes on purpose: an optional group inside a lazy match is simply
  // skipped, so the one-regex version never captured a level at all. Find each
  // style block first, then look inside it.
  // What each style says, and what it INHERITS.
  //
  // A style declares heading-ness three ways — an explicit `w:outlineLvl`, the
  // canonical `w:name` ("heading 2", lower-case with a space, whatever the
  // producer called the id), or the id spelling — and it can also declare none
  // of them and inherit from a parent through `w:basedOn`.
  //
  // `[V]` Blind corpus r28 is the inheriting shape, and it is the common one:
  // "Style Heading 2 + Not Italic" is literally what Word auto-generates when
  // somebody changes formatting on a heading. Four of its seventeen
  // heading-styled paragraphs used two such derived styles, which declare no
  // outline level of their own and carry a name no pattern matches. LibreOffice
  // resolves the inheritance, so they arrive in the PDF as headings; a reader
  // that stops at the style's own attributes read 9 where the truth was 13, and
  // under the old rules that under-count INVERTED a heading lost into three
  // invented and refused a sound document.
  //
  // Numbering inherits the same way, so both resolve in one walk.
  const HEADING_NAME = /^heading\s*([1-9])$/i;

  // Roles the FORMAT defines, which are commonly `basedOn` a heading purely to
  // borrow its look. Inheriting heading-ness into one is over-reach.
  //
  // `[V]` Blind corpus r23 and r30: `TOCHeading` is `basedOn Heading1`, the
  // walk resolved it to level 1, and each document then reported "1 heading did
  // not survive conversion" about a "Table of Contents" caption the exporter
  // correctly never tagged. Two of nine, and it recurs on any document with a
  // generated contents page.
  //
  // Named rather than inferred from shape, because shape cannot tell them
  // apart: "Style Heading 2 + Not Italic" also carries a non-heading name and
  // also inherits, and that one IS a content heading. Add a role here when a
  // document shows one, not before — "Index Heading" is the same construction
  // and stays out until something measures it.
  const NON_CONTENT_ROLE = /^toc\s*heading$/i;

  type StyleFacts = { level: number | null; numbered: boolean; basedOn: string | null };
  const styleDeclared = new Map<string, StyleFacts>();
  for (const block of styles.matchAll(/<w:style [^>]*w:styleId="([^"]+)"[\s\S]*?<\/w:style>/g)) {
    const id = block[1];
    if (id === undefined) continue;
    const outline = /<w:outlineLvl w:val="([0-8])"\s*\/>/.exec(block[0])?.[1];
    const name = /<w:name w:val="([^"]*)"\s*\/>/.exec(block[0])?.[1];
    const fromName = name === undefined ? undefined : HEADING_NAME.exec(name)?.[1];
    const fromId = HEADING_NAME.exec(id)?.[1];
    const level =
      outline !== undefined
        ? Number(outline) + 1
        : fromName !== undefined
          ? Number(fromName)
          : fromId !== undefined
            ? Number(fromId)
            : null;
    // A named non-content role declares nothing and inherits nothing: the walk
    // stops here rather than borrowing a level from the style it copies.
    const isRole = name !== undefined && NON_CONTENT_ROLE.test(name);
    styleDeclared.set(id, {
      level: isRole ? null : level,
      numbered: /<w:numPr>/.test(block[0]),
      basedOn: isRole ? null : (/<w:basedOn w:val="([^"]+)"\s*\/>/.exec(block[0])?.[1] ?? null),
    });
  }

  /**
   * Walk `basedOn` to a fixed point.
   *
   * The visited set is not defensive decoration: these chain — a tweak of a
   * tweak — and a malformed document can close the loop. A reader that hangs on
   * a cyclic style is worse than one that gives up on it, so a cycle resolves
   * to "declares nothing" and the paragraph simply is not counted.
   */
  const resolveStyle = (id: string): StyleFacts => {
    const seen = new Set<string>();
    let level: number | null = null;
    let numbered = false;
    let at: string | null = id;
    while (at !== null && !seen.has(at)) {
      seen.add(at);
      const facts: StyleFacts | undefined = styleDeclared.get(at);
      if (facts === undefined) break;
      if (level === null) level = facts.level;
      numbered = numbered || facts.numbered;
      at = facts.basedOn;
    }
    return { level, numbered, basedOn: null };
  };

  const styleFacts = new Map<string, StyleFacts>();
  for (const id of styleDeclared.keys()) styleFacts.set(id, resolveStyle(id));

  // Per paragraph, and only paragraphs that carry text. `[V]` Every heading
  // "lost" in conversion was an empty one — a blank heading-styled line — and
  // the pipeline deletes those as the defects they are. Truth counts what a
  // reader can hear.
  const headingLevels: number[] = [];
  const numberingGroups = new Set<string>();
  let listItemCount = 0;
  for (const match of doc.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const para = match[0];
    // Content, not tag presence: Word itself leaves empty `<w:t></w:t>` when
    // pasting, and a tag that says nothing is as silent as no tag. One
    // definition of "empty" across the pipeline and this reading, or they drift.
    const text = [...para.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)]
      .map((t) => t[1] ?? '')
      .join('');

    const style = /w:pStyle w:val="([^"]+)"/.exec(para)?.[1];
    const resolved = style === undefined ? undefined : styleFacts.get(style);
    const numId = /<w:numId w:val="(\d+)"/.exec(para)?.[1];
    // `w:numId="0"` is OOXML's REMOVAL marker, not a reference to list zero: it
    // says this paragraph does not number, and it is how a document takes one
    // paragraph back out of a style-numbered run. It overrides the style.
    //
    // This is the one reader bug found pointing the other way — it inflates the
    // source read, which inflates omissions rather than causing a refusal.
    // `[V]` Blind corpus r34 read 94 against 93 delivered, the only document
    // where the source read exceeded the delivery.
    const numberingRemoved = numId === '0';

    // The level is resolved BEFORE the item check, because a paragraph that is
    // a heading is not also a list item and the check needs to know.
    //
    // Every style route — outline level, canonical name, id spelling and
    // inheritance — is resolved above. A style the document USES but never
    // declares still gets the id-spelling read, which is the only signal left.
    const undeclaredId = style === undefined ? undefined : HEADING_NAME.exec(style)?.[1];
    const fromStyle = resolved?.level ?? (undeclaredId === undefined ? null : Number(undeclaredId));
    const direct = /<w:outlineLvl w:val="([0-8])"\s*\/>/.exec(para)?.[1];
    const level = fromStyle ?? (direct === undefined ? null : Number(direct) + 1);

    // A list item is a paragraph that numbers and is NOT a heading.
    //
    // **A numbered heading numbers through its style and is still a heading.**
    // `[V]` r15's `Heading1` definition carries `numPr` — "1. INTRODUCTION" —
    // so all six of its headings were counted twice, and fidelity told the
    // client "0 list items delivered for 6 in the source". The export is
    // right: a numbered heading tags as `/H1` with the number in its text,
    // which is what PDF/UA asks for and is not a list.
    //
    // This is also the whole of the 2026-08-27 campaign's "five list items
    // lost on export". `[V]` The heading/item overlap equals the recorded loss
    // on every affected document — r21 5, r24 5, r26 5, r15 6 — so nothing was
    // lost and the export never dropped anything.
    //
    // Counted BEFORE the empty-text guard below, and that asymmetry with
    // headings is measured rather than stylistic. `removeEmptyHeadings` deletes
    // a blank heading-styled line, so truth must not count it. Nothing deletes
    // a blank numbered line: `[V]` r04 and r08 each carry one, the export keeps
    // it, and skipping it read 24 against 25 delivered — a false assertion that
    // refused both documents. Neither carries a heading, so the guard above
    // leaves them alone.
    if (
      !numberingRemoved &&
      level === null &&
      (/<w:numPr>/.test(para) || resolved?.numbered === true)
    ) {
      listItemCount += 1;
      numberingGroups.add(numId ?? `style:${style ?? ''}`);
    }

    if (text.trim() === '') continue;

    if (level !== null) headingLevels.push(level);
  }

  // Figures in BOTH dialects, and — within VML — everything that DRAWS.
  //
  // DrawingML is the easy half: one `wp:docPr` per drawing, covering pictures
  // and shapes alike, with alt on `descr=`.
  //
  // VML is where this reader has been wrong twice. `[V]` One real municipal
  // document held its two images as OLE-embedded `v:shape`/`v:imagedata` WMFs,
  // invisible to a DrawingML-only count. And `[V]` measured through real
  // conversions: a `v:shape` with preset geometry and no imagedata, a
  // `v:rect`, and a `v:oval` each produce exactly **one tagged /Figure with
  // zero image XObjects on the page**. Counting only images read those as the
  // pipeline inventing a graphic and refused sound documents with a 422 —
  // the same class as r09's `draw:custom-shape` on the flat-ODF path.
  //
  // Two exclusions, both measured or structural:
  //   * a `v:shape` whose only content is a `v:textbox` draws nothing and
  //     produces no /Figure — it is text in a box;
  //   * `<v:shapetype>` declares a preset for other elements to reuse and
  //     draws nothing itself. `\b` after `shape` cannot match `shapetype`
  //     (both sides are word characters), so it is excluded by construction.
  const docPr = [...doc.matchAll(/<wp:docPr [^>]*>/g)].map((m) => m[0]);
  const vmlShapes = [...doc.matchAll(/<v:shape\b(?:[^>]*\/>|[\s\S]*?<\/v:shape>)/g)].map(
    (m) => m[0],
  );
  const vmlPrimitives = [
    ...doc.matchAll(/<v:(?:rect|oval|line|roundrect|polyline|curve|arc)\b[^>]*>/g),
  ].map((m) => m[0]);
  const vml = [
    ...vmlShapes.filter((block) => /<v:imagedata\b/.test(block) || !/<v:textbox\b/.test(block)),
    ...vmlPrimitives,
  ];

  const titleMatch = /<dc:title>([\s\S]*?)<\/dc:title>/.exec(core)?.[1];

  return {
    readable: true,
    oracle: 'ooxml',
    title: titleMatch !== undefined && titleMatch.trim() !== '' ? titleMatch.trim() : null,
    // THE SAME PARSER THAT DECIDES WHAT GETS WRITTEN. Not a second reading of
    // the same bytes.
    //
    // `docxDeclaredLanguage` is what `convert.ts` hands to `Finish` as the
    // document's `/Lang`, and its rule is specific: the `w:lang` inside
    // `<w:docDefaults>`, else the majority across the body's own runs. A
    // plausible-looking "first `w:lang` in styles.xml" disagrees with it on two
    // real shapes — a file with no `styles.xml` at all, and a `docDefaults`
    // declaring nothing beside a style that declares something — and the
    // fidelity gate reads that disagreement as the pipeline inventing a
    // language and **refuses the document with a 422**.
    //
    // `[V]` Both shapes are pinned in `source-truth.test.ts`. This is the
    // failure `extract-docx-truth.mjs` already records — "seven inventions that
    // were two parsers disagreeing about one file" — and the flat-ODF path
    // below avoids it by taking its language from the caller for exactly this
    // reason. One parser.
    language,
    headings: headingLevels.length,
    headingLevels,
    // `[ >]` rather than a bare `>`, the same idiom the paragraph scan uses:
    // it admits an attributed open tag and still cannot match `<w:tblPr>`,
    // which is the sibling that would otherwise double every count.
    tables: count(doc, /<w:tbl[ >]/g),
    lists: numberingGroups.size,
    // Counted per PARAGRAPH above, so a style-numbered document is read the
    // same as an inline-numbered one, and an empty numbered line counts as
    // little as an empty heading does.
    listItems: listItemCount,
    figures: docPr.length + vml.length,
    // Alt on any counted VML element, not just pictures — a drawn shape can
    // carry `alt=` too, and it is the same author's description either way.
    figuresWithAlt:
      docPr.filter((tag) => /descr="[^"]/.test(tag)).length +
      vml.filter((block) => /^<v:[a-z]+\b[^>]*\balt="[^"]/.test(block)).length,
  };
}

/**
 * The same reading, taken from LibreOffice's flat-ODF import.
 *
 * The fallback for legacy `.doc`, whose OLE container holds no XML. **Labelled
 * `engine-derived`, because the importer produced this reference** — a
 * comparison against it grades the export half only and cannot see a heading
 * the importer itself dropped.
 *
 * The XML is passed in rather than converted here, because the conversion
 * pipeline has already produced exactly this flat ODF on its way to a PDF.
 * Running LibreOffice a second time would cost a second import and buy
 * literally nothing: the same engine reading the same file.
 */
export function sourceTruthFromFodt(xml: string, language: string | null): SourceTruth {
  const body = /<office:text\b[\s\S]*?<\/office:text>/.exec(xml)?.[0];
  if (body === undefined) return UNREADABLE;

  // Same rule as the OOXML path: a heading that says nothing is not a heading.
  const headingLevels = [...body.matchAll(/<text:h\b([^>]*)>([\s\S]*?)<\/text:h>/g)]
    .filter((m) => (m[2] ?? '').replace(/<[^>]+>/g, '').trim() !== '')
    .map((m) => Number(/text:outline-level="(\d+)"/.exec(m[1] ?? '')?.[1] ?? 1));

  // What becomes a `/Figure` on export, which is more than raster images.
  //
  // `[V]` Measured on r09: a legacy `.doc` whose only graphic is a
  // `draw:custom-shape` — a drawn vector shape, no binary image data anywhere
  // in the file — exports as one tagged `/Figure`. A frames-with-`draw:image`
  // count read that as the pipeline inventing a graphic the author never
  // placed, which is precisely backwards: the author drew it.
  //
  // `draw:object` covers embedded OLE, the other shape legacy `.doc` uses.
  const frames = [...body.matchAll(/<draw:frame\b[\s\S]*?<\/draw:frame>/g)]
    .map((m) => m[0])
    .filter((frame) => /<draw:(?:image|object|object-ole)\b/.test(frame));
  const shapes = count(body, /<draw:custom-shape[ >]/g);

  const title = /<dc:title>([\s\S]*?)<\/dc:title>/.exec(xml)?.[1];

  return {
    readable: true,
    oracle: 'engine-derived',
    title: title !== undefined && title.trim() !== '' ? title.trim() : null,
    // Handed in by the caller, which composes it with `readLanguage` — the one
    // language parser. `[V]` A second parser read "en" where `readLanguage`
    // composes "en-US", and the grader reported seven inventions that were two
    // parsers disagreeing about one file.
    language,
    headings: headingLevels.length,
    headingLevels,
    // `[ >]`, never `\b`. `[V]` A word boundary sits between `table` and the
    // hyphen of `table:table-cell`, so `/<table:table\b/` counts every cell,
    // row and column as a table: one real table in r09 read as **24**, and the
    // comparator reported a 23-table loss that never happened. Same trap in
    // `<text:list\b`, which counts `text:list-item` and `text:list-header`
    // (26 against a true 10).
    //
    // The same defect is live in `experiments/document-remediation/
    // extract-docx-truth.mjs:48-49`, so every engine-derived table and list
    // figure in the 2026-08-27 campaign — the seven legacy `.doc` documents —
    // was inflated. Recorded in the results write-up.
    tables: count(body, /<table:table[ >]/g),
    lists: count(body, /<text:list[ >]/g),
    // Items that carry content, never the structural wrappers.
    //
    // ODF represents a list that starts INDENTED as an outer list holding one
    // item whose only child is the real list. That wrapper has no paragraph,
    // no text and nothing a screen reader could announce, and the export emits
    // no `LI` for it — correctly, because there is nothing to tag.
    //
    // `[V]` r02 is the whole of its 43→42: it carries exactly one such
    // wrapper, and counting it read as a delivered document that had dropped
    // an item. The sibling case — an item with its own paragraph AND a nested
    // list — is a real item, is delivered, and still counts; r02 has one of
    // those too, which is why the subtraction is by shape and not by "single
    // item list".
    //
    // `\s*` rather than a parser because this reader is regexes over a flat
    // file by design; in JS it spans the newlines a pretty-printed fodt has.
    listItems:
      count(body, /<text:list-item[ >]/g) -
      count(body, /<text:list-item[^>]*>\s*<text:list[ >]/g),
    figures: frames.length + shapes,
    // Only framed graphics can carry a description; a bare drawn shape has
    // nowhere to put one, so it counts toward `figures` and never toward this.
    figuresWithAlt: frames.filter((frame) => /<svg:(?:desc|title)>[^<]/.test(frame)).length,
  };
}
