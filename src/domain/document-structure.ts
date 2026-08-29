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
  /**
   * What the catalog's MarkInfo CLAIMS — not what the tree contains.
   *
   * Read `marked === true && structureElements === 0` as the document
   * asserting an accessibility property it does not have. Producers write it,
   * and until this field existed the product could not see it: `isTagged()`
   * answers what is true, this answers what was claimed, and the gap between
   * them is exactly the thing this project refuses to produce itself.
   */
  marked: z.boolean(),
  /**
   * Whether the document carries a real digital signature.
   *
   * Repair rewrites the catalog, and that invalidates a signature — an
   * incremental save does not rescue it, preserving earlier signatures only
   * for the additive operations DocMDP permits. A certified municipal record
   * silently losing its signature is a worse outcome than the accessibility
   * gap it was repaired for, so this is refused on rather than reported.
   */
  signed: z.boolean(),
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

/**
 * A BCP-47 language tag, loosely.
 *
 * Not a full BCP-47 parser — enough to refuse `english`, `EN_US` and the empty
 * string, which are the shapes a caller actually gets wrong. This matters more
 * than it looks: `/Lang` is a **claim about the document**, written into bytes
 * that get delivered, and a wrong one is exactly the class of defect this
 * project calls an assertion — invisible to a reader, and worse than saying
 * nothing at all.
 */
export const languageTagSchema = z
  .string()
  .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'expected a BCP-47 language tag such as `en` or `cy-GB`');

/**
 * The fields that describe what the document *says*, as opposed to what it is
 * labelled with.
 *
 * Split out because the distinction is the whole safety argument for letting a
 * repair stage write a file. A metadata pass may set `/Lang` and the XMP
 * packet; it may not add a heading, drop a figure out of the tree or reorder
 * anything. `title` and `lang` are absent from this list because they are the
 * labels; everything else is the content.
 */
export const CONTENT_FIELDS = [
  'structureElements',
  'textChars',
  'images',
  'pages',
  'headings',
  'headingTexts',
  'figures',
  'tables',
  'lists',
  'order',
] as const satisfies readonly (keyof DocumentStructure)[];

/**
 * Which content fields a repair changed — empty when it changed none.
 *
 * This is how "the process exited 0" becomes "the document still says what it
 * said". A repair stage's failure mode is a delivered file carrying a wrong
 * claim that no reviewer can see: four meaningful images artifacted out of the
 * structure tree look identical, in the PDF, to four images that were never
 * there. Comparing a reading taken before the repair with one taken after is
 * what makes that visible without any ground truth to compare against — which
 * matters, because a client's document has none.
 *
 * Compared by serialising rather than walking: both readings come from the same
 * Java emitter and then through the same zod schema, so key order is fixed on
 * both sides and a structural walk would buy nothing but its own bugs.
 */
export function contentChanges(
  before: DocumentStructure,
  after: DocumentStructure,
): string[] {
  return CONTENT_FIELDS.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
}
