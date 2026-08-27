import type { DocumentStructure } from './document-structure';

/**
 * What a remediation produced, and where every claim in it came from.
 *
 * These types live in `domain` rather than beside the conversion that fills
 * them because two layers need them and neither may import the other: the route
 * that returns a summary, and anything in `services/` that later turns one into
 * findings. `services/` importing an integration is the layering violation this
 * codebase does not have, and moving a plain-data contract here is cheaper than
 * making an exception for it.
 */

/**
 * Where the document's title came from.
 *
 * The three cases are deliberately not collapsible. A title the author wrote and
 * a title copied from the author's own first heading are both transcription, but
 * they are different transcriptions — and "absent" is a gap somebody has to
 * close, not a failure of the pipeline. Inventing one from body text would be a
 * fourth case, and it is the one this project refuses to have.
 */
export type TitleOutcome =
  | { kind: 'already-titled'; title: string }
  | { kind: 'transcribed'; title: string }
  /**
   * Derived from the source's FILENAME — authored text too: a clerk who
   * saves "Conflict_of_Interest_Law_for_Municipal_Employees.docx" named the
   * document, just not in the metadata field. `[V]` Nine of thirty-one real
   * municipal documents were blocked by 2.4.2 alone, every one carrying a
   * richly descriptive filename. The provenance label keeps the derivation
   * visible to every reviewer.
   */
  | { kind: 'filename-derived'; title: string }
  | { kind: 'no-heading-to-copy' };

export type ConversionProvenance = {
  title: TitleOutcome;
  /** The language the SOURCE declared. Null means it declared none. */
  sourceLanguage: string | null;
  /** The structure of the finished document, as read back. */
  structure: DocumentStructure;
};

/**
 * The part of a remediation that is safe to hand back and safe to log.
 *
 * Counts and outcomes, never text. `DocumentStructure` carries the document's
 * actual words — `headingTexts[].text`, `order[].text`, every table cell — and
 * the documents this runs on are municipal records naming real people. The
 * research record states the rule on every page that touched one: *structure
 * only, no document content quoted*.
 *
 * `title` is the single exception, and only in a response: the caller uploaded
 * the file and is being handed it straight back, so echoing its title tells them
 * nothing they did not supply. `logSafe` below strips even that, because a log
 * line persists and travels where a response does not.
 */
export type RemediationSummary = {
  title: TitleOutcome['kind'];
  /** Present only when there is one; never invented. */
  titleText?: string;
  sourceLanguage: string | null;
  tagged: boolean;
  pages: number;
  headings: number;
  tables: number;
  lists: number;
  figures: number;
  /** What is still wrong, each naming its WCAG success criterion. */
  gaps: string[];
};

/**
 * The honest half of the record.
 *
 * A remediation that reports only what it fixed is the "98% of machine-checkable
 * failures removed" claim that was never 98% of the work. These are the things a
 * human still has to answer, and each names the criterion it fails so it lines
 * up with `services/wcag-reference.ts` when findings integration arrives.
 */
/**
 * The version of the gap vocabulary `gapsIn` below emits — the same shape as
 * `GATE_VERSION` in `services/reporting.ts`, for the same reason: a stored
 * reading must not be reinterpreted by code that speaks differently.
 *
 * **Bump this whenever `gapsIn` changes which criteria it can emit or when
 * their meaning shifts** — adding a check, removing one, renumbering. The
 * document regression comparator refuses to diff readings across versions
 * (`incomparable`), because a vocabulary change diffed silently would report
 * OUR change as the client's document changing. A count inside an existing
 * gap string changing is NOT a version bump — the comparator already keys on
 * the criterion, not the count.
 */
export const INSTRUMENT_VERSION = 1;

function gapsIn(provenance: ConversionProvenance): string[] {
  const { structure, title, sourceLanguage } = provenance;
  const gaps: string[] = [];

  if (title.kind === 'no-heading-to-copy') {
    gaps.push(
      '2.4.2: the document has no title, no heading to copy one from, and no usable filename to derive one',
    );
  }

  if (sourceLanguage === null) {
    // Not "we failed to set it" — we removed what the exporter guessed. An
    // omission a reviewer can see beats a language claim nobody made.
    gaps.push('3.1.1: the source declares no language, so none is claimed');
  }

  // Absent alt and empty alt are different claims and must not be counted
  // together: empty says the graphic carries no meaning, absent says nobody
  // answered. Only the second is a gap.
  const withoutAlt = structure.figures.filter((figure) => figure.alt === null).length;
  if (withoutAlt > 0) {
    gaps.push(
      `1.1.1: ${withoutAlt} figure${withoutAlt === 1 ? '' : 's'} with no alt text`,
    );
  }

  if (structure.structureElements === 0) {
    gaps.push('1.3.1: the output carries no structure tree');
  }

  return gaps;
}

export function summarise(provenance: ConversionProvenance): RemediationSummary {
  const { structure, title } = provenance;

  return {
    title: title.kind,
    ...(title.kind === 'no-heading-to-copy' ? {} : { titleText: title.title }),
    sourceLanguage: provenance.sourceLanguage,
    tagged: structure.structureElements > 0,
    pages: structure.pages,
    headings: structure.headings.length,
    tables: structure.tables.length,
    lists: structure.lists.length,
    figures: structure.figures.length,
    gaps: gapsIn(provenance),
  };
}

/**
 * The same summary with the document's title removed.
 *
 * For logs. Everything else here is a count or an outcome kind, so this is the
 * one field that has to go.
 */
export function logSafe(summary: RemediationSummary): Omit<RemediationSummary, 'titleText'> {
  const { titleText: _title, ...rest } = summary;
  return rest;
}

/* -------------------------------------------------------------------------- */

/**
 * Is this actually a Word document?
 *
 * `[V]` This cannot be delegated to the converter. LibreOffice sniffs content
 * rather than trusting the extension, so a text file named `.docx` converts
 * successfully — measured, not assumed. **A successful conversion is not
 * evidence that the input was a Word document.**
 *
 * ## What this proves, and what it does not
 *
 * It proves the container shape. A `.docx` is a ZIP whose local file headers
 * store their filenames *uncompressed*, so the OOXML part names are readable in
 * the raw bytes without unzipping anything — which makes this a real check
 * rather than a magic-number guess, and costs no dependency.
 *
 * It does **not** prove the document is well-formed, and it is not a scanner.
 * It is a gate against mislabelled input, which is the thing measured to
 * actually happen.
 */
export type UploadCheck =
  | { ok: true; kind: 'docx' | 'doc' | 'pdf' }
  | { ok: false; reason: string };

/** ZIP local file header: the first four bytes of every `.docx`. */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/** OLE compound file: the legacy `.doc` container. */
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];

/**
 * How far in to look for the OOXML part names.
 *
 * They sit in the first local file headers, right at the front. Scanning the
 * whole buffer would work and would also mean scanning 25MB to reject a file we
 * already know the shape of.
 */
const SCAN_BYTES = 8192;

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, index) => bytes[index] === byte);
}

export function isWordDocument(bytes: Uint8Array): UploadCheck {
  if (bytes.length === 0) {
    return { ok: false, reason: 'the uploaded file is empty' };
  }

  if (startsWith(bytes, OLE_MAGIC)) {
    return { ok: true, kind: 'doc' };
  }

  if (!startsWith(bytes, ZIP_MAGIC)) {
    return {
      ok: false,
      reason: 'not a Word document: expected a .docx (ZIP) or .doc (OLE) container',
    };
  }

  // A ZIP alone is not enough — .xlsx, .pptx, .odt and a plain archive all
  // start the same way. The part names are what say this is a Word document.
  const head = Buffer.from(bytes.subarray(0, SCAN_BYTES)).toString('latin1');
  if (!head.includes('[Content_Types].xml') || !head.includes('word/')) {
    return {
      ok: false,
      reason: 'not a Word document: a ZIP without the OOXML `word/` parts',
    };
  }

  return { ok: true, kind: 'docx' };
}

/**
 * Is this a PDF?
 *
 * Same rule and same honesty as `isWordDocument`: it proves the container, not
 * that the file is sound. PDFBox rejects anything past the header it cannot
 * parse, which is the right division of labour — this refuses the
 * obviously-wrong upload before a JVM is started for it.
 *
 * The header is looked for in a window rather than only at offset 0, because
 * the specification tolerates leading bytes and real writers emit them.
 */
export function isPdf(bytes: Uint8Array): UploadCheck {
  if (bytes.length === 0) {
    return { ok: false, reason: 'the uploaded file is empty' };
  }

  const head = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  if (!head.includes('%PDF-')) {
    return { ok: false, reason: 'not a PDF: no %PDF- header in the first 1024 bytes' };
  }

  return { ok: true, kind: 'pdf' };
}

/**
 * A displayable title out of a filename, or null when the name says nothing.
 *
 * Junk refusal is the whole safety of the feature: "doc1", "untitled",
 * "final_v2", scanner names and bare ids produce no title at all — the
 * honest 2.4.2 gap survives — because a bad derived title is worse than a
 * reported absence. The refusal table is also the injection backstop for a
 * caller-supplied upload name: what passes is words, capped and stripped of
 * control characters.
 */
const JUNK_FILENAMES =
  /^(doc(ument)?s?[ ]?\d*|untitled|new|final([ ]?v?\d+)?|scan(ned)?[ ]?\d*|img[ ]?\d*|image[ ]?\d*|file[ ]?\d*|copy([ ]of)?.*|temp|draft|[a-z]{0,3}[\d .]*)$/i;

export function titleFromFilename(name: string): string | null {
  const stem = name
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
    .trim();

  if (stem.length < 3 || JUNK_FILENAMES.test(stem)) {
    return null;
  }
  return stem;
}
