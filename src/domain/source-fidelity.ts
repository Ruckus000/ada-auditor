import { z } from 'zod';

import type { DocumentStructure } from './document-structure';
import type { ReadableSourceTruth, SourceTruth } from './source-truth';

/**
 * Does the delivered PDF say what the source document said?
 *
 * Pure: source truth in, delivered structure in, defect list out. No I/O, no
 * clock, no subprocess — the same discipline `compare.mjs` protects with an
 * explicit guard, and the reason this is testable without a JVM.
 *
 * ## The two-defect model
 *
 * Carried over verbatim from `experiments/document-remediation/compare.mjs`,
 * because the distinction is the whole product and a second vocabulary would
 * drift from the first:
 *
 * - **assertion** — the output states something the source did not. A screen
 *   reader user is *misled* rather than merely underserved, and no reviewer has
 *   any signal that something is wrong. **This is the hard gate. It must be
 *   zero, and a document carrying one is not delivered.**
 * - **omission** — the output failed to carry something the source stated. Bad,
 *   and the reason a document needs review rather than shipping clean, but
 *   honest: a human sees the gap. These become `needs[]` items.
 *
 * The asymmetry is deliberate and is the reason the gate can be strict without
 * refusing most documents.
 *
 * ## Which rows may assert, and why the counts may not
 *
 * **Only the VALUE rows gate: language and title.** Those compare a fact the
 * source states against the same fact in the output, and neither depends on
 * this reader having enumerated anything completely.
 *
 * **Every COUNT row reports and never gates** — headings, tables, list items,
 * figures. A count comparison asks "is delivered greater than source", and the
 * source side of it is structurally a **lower bound**: enumerating every OOXML
 * dialect that becomes a heading, a list item or a graphic is open-ended, and
 * this reader has been short four times in one week, every time in the same
 * direction:
 *
 *   1. VML `v:imagedata`-only, missing OLE-embedded WMFs
 *   2. `draw:custom-shape` on the flat-ODF path — r09
 *   3. `v:rect` / `v:oval`, which are not `v:shape` at all
 *   4. style-level `w:numPr`, and heading styles whose id is not `HeadingN` —
 *      blind corpus r34 read 13 list items against 93 delivered, and r28 read
 *      9 headings against a true 13, which **inverted** a lost heading into an
 *      invented one and refused the document
 *
 * Each was a false assertion, and a false assertion means the client receives
 * nothing at all. The counts also over-fire honestly: an exporter that splits
 * one table across pages delivers more tables than the source declares without
 * inventing anything.
 *
 * `[V]` The evidence that settles it is the two corpora disagreeing because of
 * the population rather than the code: **0 assertions across 31 documents the
 * converter was tuned against, 3 across 9 it had never seen.** A lower bound
 * compared against a complete reading cannot carry a refusal.
 *
 * ## What this cannot see
 *
 * **A source whose own structure is wrong.** If an author tagged a street
 * address as `H1` — the measured `newcastle` case, six headings that were a
 * centred masthead — this reports a faithful match, because it *is* one. That
 * is a source-quality question, it needs a different instrument, and pretending
 * this covers it would be the same over-claim the research record keeps
 * catching. Stated here so it is not rediscovered a fourth time.
 */

export const defectSchema = z.object({
  /**
   * `unverified` is the third value and it exists because the other two were
   * carrying its meaning. `[V]` After the count rows stopped gating, r28
   * reported "12 headings in the delivered document for 9 read in the source"
   * as an OMISSION — nothing was omitted, the delivered document has more, and
   * a client reading "omission" beside a larger number is told something false
   * about a document that is fine.
   *
   * It means: the delivered document carries more of this than the source
   * reading accounts for, and **we cannot tell whether the export added
   * structure or our reading of the source is short.** Given this reader has
   * been short five times in a week and the export has never been shown to
   * invent, the second is far likelier — but "likelier" is not a verdict, and
   * naming it honestly is cheaper than picking one.
   */
  kind: z.enum(['assertion', 'omission', 'unverified']),
  /** The WCAG success criterion, spelled as `services/wcag-reference.ts` does. */
  criterion: z.string(),
  /** One sentence a reviewer can act on. Counts and outcomes, never document text. */
  detail: z.string(),
  /**
   * How much the comparison behind this defect is worth.
   *
   * Repeated on every defect rather than reported once alongside them: a defect
   * travels — into a log line, a punch list, a report row — and a caveat that
   * stays behind at the call site is a caveat that stops being read.
   */
  oracle: z.enum(['ooxml', 'engine-derived']),
});

export type Defect = z.infer<typeof defectSchema>;
export type DefectKind = Defect['kind'];

/**
 * The fidelity verdict on one delivered document.
 *
 * The shape mirrors `Conformance` deliberately, because it carries the same
 * load-bearing distinction: **`checked: false` renders as "not verified", never
 * as clean.** A source we could not read is not a document that matched.
 */
export const fidelitySchema = z.union([
  z.object({
    checked: z.literal(true),
    oracle: z.enum(['ooxml', 'engine-derived']),
    defects: z.array(defectSchema),
  }),
  z.object({ checked: z.literal(false), reason: z.literal('source-unreadable') }),
]);

export type Fidelity = z.infer<typeof fidelitySchema>;

/**
 * The verdict, from a source reading and the delivered structure.
 *
 * Accepts a missing reading, not only an unreadable one. A provenance stored
 * before this instrument existed carries no `sourceTruth` at all, and the two
 * cases mean the same thing here — **no source reading, so nothing was
 * compared.** Both answer `checked: false`, which every surface renders as "not
 * verified". Throwing instead would turn an old row into a crash, and defaulting
 * to `checked: true` with no defects would turn it into a clean bill it never
 * earned.
 */
export function checkFidelity(
  truth: SourceTruth | undefined,
  delivered: DocumentStructure,
): Fidelity {
  if (truth === undefined || !truth.readable) {
    return { checked: false, reason: 'source-unreadable' };
  }
  return { checked: true, oracle: truth.oracle, defects: fidelityDefects(truth, delivered) };
}

/** The primary language subtag: `en-US` and `en-GB` are both `en`. */
function primarySubtag(tag: string): string {
  return (tag.split('-')[0] ?? tag).toLowerCase();
}

/** Whitespace and case are presentation, not a different title. */
function sameTitle(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  return norm(a) === norm(b);
}

/** `['H1','H2']` → `[1,2]`. Anything unparseable is skipped rather than guessed. */
function levelsOf(headings: string[]): number[] {
  return headings
    .map((h) => Number(/^H(\d)$/.exec(h)?.[1] ?? NaN))
    .filter((n) => Number.isFinite(n));
}

export function fidelityDefects(
  truth: SourceTruth,
  delivered: DocumentStructure,
): Defect[] {
  // Not verified is not clean, and it is also not a defect. The caller renders
  // the absence — exactly as an absent `conformance` renders as "not checked".
  if (!truth.readable) return [];

  const defects: Defect[] = [];
  const source: ReadableSourceTruth = truth;
  const { oracle } = source;

  // A WEAKER ORACLE MAY INFORM, NEVER GATE.
  //
  // `engine-derived` is LibreOffice's reading of a legacy `.doc`, and its own
  // documentation says it grades the export half only — the importer produced
  // the reference. Blocking a delivery on it would let a second-hand reading
  // refuse a sound document, which is the over-claim this project keeps
  // catching in other people's tools.
  //
  // `[V]` The first real run made the cost concrete. r09 is a `.doc` whose one
  // graphic is a drawn `draw:custom-shape`; the flat ODF names no image, the
  // export tags one honest `/Figure`, and a reading that gates would have
  // refused the document for the pipeline doing its job correctly.
  //
  // So on an engine-derived reading every finding is reported as an omission:
  // visible on the punch list, never silent, never a refusal.
  const gates = oracle === 'ooxml';
  const assert_ = (criterion: string, detail: string) =>
    defects.push({ kind: gates ? 'assertion' : 'unverified', criterion, detail, oracle });
  const omit = (criterion: string, detail: string) =>
    defects.push({ kind: 'omission', criterion, detail, oracle });
  /** Delivered carries more than the source reading accounts for. */
  const over = (criterion: string, detail: string) =>
    defects.push({ kind: 'unverified', criterion, detail, oracle });

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  /* ------------------------------------------------------------ headings */

  const deliveredHeadings = delivered.headings ?? [];
  if (deliveredHeadings.length > source.headings) {
    over(
      '1.3.1',
      `${plural(deliveredHeadings.length, 'heading')} in the delivered document, more than the ${source.headings} this reading of the source accounts for — check the extra structure is the author's`,
    );
  } else if (deliveredHeadings.length < source.headings) {
    omit(
      '1.3.1',
      `${plural(deliveredHeadings.length, 'heading')} in the delivered document for ${source.headings} declared in the source — ${source.headings - deliveredHeadings.length} did not survive conversion`,
    );
  } else {
    // Only when the counts agree. A count defect has already been reported
    // above, and re-describing the same loss as a level mismatch would report
    // one defect twice and inflate every tally built on these.
    const deliveredLevels = levelsOf(deliveredHeadings);
    const sourceLevels = source.headingLevels;
    if (
      deliveredLevels.length === sourceLevels.length &&
      deliveredLevels.some((level, i) => level !== sourceLevels[i])
    ) {
      // An OMISSION, not an assertion, and the reasoning is load-bearing
      // enough to write down — it was an assertion until the first real run.
      //
      // The gate exists to catch **fabricated existence**: a table, a figure,
      // a language claim that is not in the source. A level difference
      // fabricates nothing. The same headings are present, carrying the same
      // text, at a different depth — degraded precision, not invention.
      //
      // `[V]` Measured across the 31 real documents, every level difference is
      // one of two things and neither is ours to fix:
      //
      // - **The format ceiling.** PDF numbered heading types stop at H6. Three
      //   documents declare a Word outline level 7, and the exporter clamps to
      //   H6 because there is nothing else to write. Max delivered level across
      //   the whole corpus is 6.
      // - **The exporter re-levelling.** r09's table-of-contents heading leaves
      //   as H1 and arrives as H2.
      //
      // Refusing delivery on either would refuse a sound document permanently
      // for a defect with no remedy, which is a gate that only withholds
      // service. And it would contradict the product's own vocabulary:
      // `needsIn` already treats "these headings start too deep" as a decision
      // for a person, not a blocking defect. Reported here, on the punch list,
      // never silent.
      // Bounded, and deliberately not the whole sequence.
      //
      // `[V]` The summary rides to the client in the `x-remediation-summary`
      // HTTP header, which has roughly 3.4KB of headroom before Node's 16KB
      // default rejects the whole response — a 101-figure document once hit
      // 22,743 bytes and every client refused it, so the punch list vanished
      // entirely. Listing every level twice made this one item scale with the
      // document: ~256 bytes at 17 headings, ~1.7KB at 200. A count and the
      // first disagreement are what a reviewer acts on anyway.
      const first = deliveredLevels.findIndex((level, i) => level !== sourceLevels[i]);
      const differing = deliveredLevels.filter((level, i) => level !== sourceLevels[i]).length;
      omit(
        '2.4.10',
        `${plural(differing, 'heading')} of ${sourceLevels.length} arrived at a different depth from the source, first at heading ${first + 1} (delivered H${deliveredLevels[first]}, source H${sourceLevels[first]}) — PDF has no level below H6, and the exporter can re-level a contents heading`,
      );
    }
  }

  /* -------------------------------------------------------------- tables */

  const deliveredTables = (delivered.tables ?? []).length;
  if (deliveredTables > source.tables) {
    over(
      '1.3.1',
      `${plural(deliveredTables, 'table')} in the delivered document, more than the ${source.tables} in the source — usually one table split across pages, occasionally an invented one`,
    );
  } else if (deliveredTables < source.tables) {
    omit(
      '1.3.1',
      `${plural(deliveredTables, 'table')} in the delivered document for ${source.tables} in the source`,
    );
  }

  /* ---------------------------------------------------------- list items */

  // ITEMS, never groups. `[V]` The export splits one interrupted Word
  // numbering group into several PDF `L` structures — one became twelve on a
  // real document — so group counts disagree between two honest instruments
  // while the item count is the same content on both sides.
  const deliveredItems = (delivered.lists ?? []).reduce((total, list) => total + list.items, 0);
  if (deliveredItems > source.listItems) {
    over(
      '1.3.1',
      `${plural(deliveredItems, 'list item')} in the delivered document, more than the ${source.listItems} this reading of the source accounts for`,
    );
  } else if (deliveredItems < source.listItems) {
    omit(
      '1.3.1',
      `${plural(deliveredItems, 'list item')} in the delivered document for ${source.listItems} in the source`,
    );
  }

  /* ------------------------------------------------------------- figures */

  // THE FIGURE ROW INFORMS; IT DOES NOT GATE. Both directions are omissions.
  //
  // The two sides answer different questions and cannot be made to answer the
  // same one. The source read is `word/document.xml` — the body. The delivered
  // read is the whole PDF structure tree, headers and footers included. A
  // header logo that the exporter tagged rather than artifacted would show as
  // delivered-without-source and refuse a sound document, and the client would
  // get nothing at all.
  //
  // Counting headers on the source side does not fix it, it inverts it: header
  // images ARE normally artifacted, so counting them would put a spurious
  // "figures lost" item on every document carrying a letterhead — common, where
  // the false assertion is hypothetical.
  //
  // What settles it is the record. This reader has under-counted source figures
  // three times: VML `v:imagedata`-only, `draw:custom-shape` on the flat-ODF
  // path, and `v:rect`/`v:oval` which are not `v:shape` at all. Every one
  // pointed the same way — source too low, delivered "inventing" — and every
  // one would have refused a document that was fine. An enumeration wrong three
  // times in one week has not earned the right to withhold a delivery.
  //
  // Headings, tables, lists and language still gate: those enumerations have
  // held up, and their over-delivery genuinely means invented structure.
  const deliveredFigures = delivered.figures ?? [];
  if (deliveredFigures.length > source.figures) {
    over(
      '1.1.1',
      `${plural(deliveredFigures.length, 'figure')} in the delivered document, more than the ${source.figures} in the source body — usually a header or footer image the export tagged rather than artifacted`,
    );
  } else if (deliveredFigures.length < source.figures) {
    omit(
      '1.1.1',
      `${plural(deliveredFigures.length, 'figure')} in the delivered document for ${source.figures} in the source`,
    );
  }

  // Described figures, one direction only.
  //
  // Empty alt counts as described: it is a positive claim that the graphic
  // carries no meaning, which is an answer. Absent alt is an unanswered
  // question. `figureSchema` keeps them apart and so must this.
  //
  // Over-delivery is NOT a defect. `deriveAltFromCaptions` transcribes a
  // caption the author wrote into `svg:desc`, so a captioned document
  // legitimately delivers more described figures than the source declared —
  // the same author's words moved, not a new claim. Flagging it would refuse
  // every captioned document for the pipeline doing its job correctly.
  const deliveredDescribed = deliveredFigures.filter((figure) => figure.alt !== null).length;
  if (deliveredDescribed < source.figuresWithAlt) {
    omit(
      '1.1.1',
      `${deliveredDescribed} of ${deliveredFigures.length} delivered figures carry a description, against ${source.figuresWithAlt} the author described in the source — alt text was lost in conversion`,
    );
  }

  /* ------------------------------------------------------------ language */

  const deliveredLang = delivered.lang;
  if (source.language === null && deliveredLang !== null) {
    // The pipeline deliberately strips the exporter's guess when the source
    // declares nothing. A language here means something re-invented one.
    assert_(
      '3.1.1',
      `the delivered document declares a language the source never did — a language is transcribed, never guessed`,
    );
  } else if (source.language !== null && deliveredLang === null) {
    omit('3.1.1', `the source declares a language and the delivered document carries none`);
  } else if (
    source.language !== null &&
    deliveredLang !== null &&
    primarySubtag(source.language) !== primarySubtag(deliveredLang)
  ) {
    assert_(
      '3.1.1',
      `the delivered document declares a different language from the source — a reader is told the wrong thing about how to pronounce it`,
    );
  }

  /* --------------------------------------------------------------- title */

  // Only the two directions this instrument can honestly judge. A title the
  // source never had is NOT judged here: `TitleOutcome` already records
  // exactly where one came from — the author's own first heading, or a
  // descriptive filename, with junk names refused — and a second, weaker
  // opinion derived from counts would contradict a question already answered.
  if (source.title !== null && delivered.title === null) {
    omit('2.4.2', `the source carries a title and the delivered document has none`);
  } else if (
    source.title !== null &&
    delivered.title !== null &&
    !sameTitle(source.title, delivered.title)
  ) {
    assert_('2.4.2', `the delivered title is not the one the source declared`);
  }

  return defects;
}

/** Any assertion at all. The gate; nothing carrying one is delivered. */
export function hasAssertion(defects: Defect[]): boolean {
  return defects.some((defect) => defect.kind === 'assertion');
}
