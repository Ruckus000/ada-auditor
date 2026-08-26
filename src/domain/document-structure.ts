import { z } from 'zod';

/**
 * What a PDF's structure tree actually contains, as plain data.
 *
 * This is the contract for `Inspect`, the first document stage to graduate out
 * of `experiments/document-remediation/`. It reports and never judges —
 * deciding whether a document is *good* is a separate concern, the way
 * `services/deterministic-audit.ts` maps axe's output without axe ever
 * reaching services.
 *
 * ## Why a schema and not an interface
 *
 * This data arrives as the stdout of a subprocess. A TypeScript type would
 * describe what we *hope* crossed that boundary and check nothing; every field
 * below is read from a PDF written by somebody else, by a JVM we do not
 * control, and a wrong shape has to fail where it happens rather than three
 * layers later as `undefined`. So the boundary is parsed, not asserted.
 *
 * ## Why the objects are not `.strict()`
 *
 * `discoveryRequestSchema` is strict because it reads a request body, where an
 * unrecognised field means a caller is confused and should be told. This reads
 * our own tool's output, where an unrecognised field means the tool learned to
 * report something new. Stripping unknown keys keeps a newer `Inspect` from
 * breaking a running deployment, while a *missing* or wrongly-typed known field
 * still fails loudly — which is the half that matters.
 *
 * The `images` field is the reason that distinction is not hypothetical: it was
 * added to `Inspect` partway through the spike, and
 * `experiments/document-remediation/compare.test.mjs` still carries a test that
 * output predating it degrades rather than crashes.
 */

/**
 * One cell of a table.
 *
 * `scope` is nullable because most cells have none, and `null` here is a fact
 * rather than a gap: PDF/UA only requires a scope on header cells. `row` is the
 * index the cell was found at, which is what makes "a `/TH` sharing a row with
 * a `/TD` heads that row" checkable — the rule `FixScope.java` applies.
 */
export const tableCellSchema = z.object({
  type: z.string(),
  text: z.string().nullable(),
  scope: z.string().nullable(),
  row: z.number().int(),
});

export const tableSchema = z.object({
  /** Header cells. Zero across every table is the failure real documents show. */
  th: z.number().int(),
  td: z.number().int(),
  tr: z.number().int(),
  cells: z.array(tableCellSchema),
});

/**
 * A tagged graphic.
 *
 * `alt` and `actualText` are separately nullable and mean different things: alt
 * describes an image, actualText replaces it with the characters it draws. Alt
 * that is `null` is an unanswered question; alt that is the empty string is a
 * positive claim that the graphic carries no meaning. Collapsing the two is how
 * a document lost four meaningful images and still scored clean, so nothing
 * here may coerce one into the other.
 */
export const figureSchema = z.object({
  type: z.string(),
  alt: z.string().nullable(),
  actualText: z.string().nullable(),
});

export const documentStructureSchema = z.object({
  /** Total elements in the structure tree. Zero means the PDF is untagged. */
  structureElements: z.number().int(),
  /** Extracted text length. Distinguishes an untagged PDF from a scanned image. */
  textChars: z.number().int(),
  /**
   * Image XObjects the pages draw, whether or not the tree mentions them.
   *
   * Counted separately from `figures` on purpose. A meaningful image artifacted
   * out of the tree and an image that never existed both leave `figures` empty;
   * only this number tells them apart, and the first is a silent deletion while
   * the second is an honest gap.
   */
  images: z.number().int(),
  pages: z.number().int(),
  /** `/Lang`. Null means unset, which is an omission rather than a wrong claim. */
  lang: z.string().nullable(),
  /** `dc:title`. Absent on three of four real already-tagged municipal PDFs. */
  title: z.string().nullable(),
  /** Heading levels in document order, e.g. `['H1', 'H2', 'H2']`. */
  headings: z.array(z.string()),
  headingTexts: z.array(z.object({ level: z.string(), text: z.string().nullable() })),
  figures: z.array(figureSchema),
  tables: z.array(tableSchema),
  lists: z.array(z.object({ depth: z.number().int(), items: z.number().int() })),
  /** Block-level elements in structure order — the document's reading order. */
  order: z.array(z.object({ type: z.string(), text: z.string().nullable() })),
});

export type DocumentStructure = z.infer<typeof documentStructureSchema>;
export type TableCell = z.infer<typeof tableCellSchema>;
export type DocumentTable = z.infer<typeof tableSchema>;
export type DocumentFigure = z.infer<typeof figureSchema>;

/** A tree with no elements is an untagged PDF, whatever else it contains. */
export function isTagged(structure: DocumentStructure): boolean {
  return structure.structureElements > 0;
}
