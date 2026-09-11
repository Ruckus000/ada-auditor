import { z } from 'zod';

import type { DocumentStructure } from './document-structure';
import type { Fidelity } from './source-fidelity';
import type { SourceTruth } from './source-truth';

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
  /**
   * What the SOURCE said about its own structure — the reference half.
   *
   * Reported here rather than compared here: this type is the account of where
   * a conversion's claims came from, and the two readings it now carries are
   * exactly the two sides of that account. `source-fidelity.ts` does the
   * comparing, and the caller decides what a defect means. Converting and
   * judging are different jobs.
   *
   * `readable: false` where neither oracle could read the container. That
   * renders as "not verified", never as a clean bill.
   */
  sourceTruth: SourceTruth;
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
/**
 * The conformance verdict from the product's second instrument.
 *
 * `checker: 'none'` is load-bearing: a host without the checker says
 * "conformance not checked" on every surface, never "clean" — a silent clause
 * is the defect the second instrument exists to end, and a missing checker
 * must not reintroduce it. Clause identifiers only, never content.
 */
export const conformanceSchema = z.union([
  z.object({ checker: z.literal('verapdf-ua1'), compliant: z.literal(true) }),
  z.object({
    checker: z.literal('verapdf-ua1'),
    compliant: z.literal(false),
    failingClauses: z.array(z.string()),
  }),
  z.object({ checker: z.literal('none'), reason: z.literal('unavailable') }),
]);
export type Conformance = z.infer<typeof conformanceSchema>;

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
  /**
   * The punch list: each item is one thing a HUMAN still has to do, precise
   * enough to act on without opening this codebase. The remediation promise
   * is that a document comes back either fully conformant or with this list —
   * never a silent gap. Absent (never empty) when nothing needs a person.
   */
  needs?: Array<{ criterion: string; item: string }>;
  /**
   * What the reference checker said about this exact file.
   *
   * Optional because readings made before the second instrument shipped are
   * stored verbatim and cannot gain it; surfaces render its absence exactly
   * as `checker: 'none'` — "conformance not checked" — never as clean.
   */
  conformance?: Conformance;
  /**
   * Whether the delivered document says what its SOURCE said.
   *
   * Absent on readings taken before this instrument shipped, and
   * `checked: false` where the source container could not be read. Both render
   * as "not verified", never as a match — the `conformance` precedent, for the
   * same reason.
   *
   * An assertion never reaches here: a document carrying one is refused rather
   * than delivered, so a stored summary with `fidelity.defects` holds omissions
   * and `unverified` findings only. That is an invariant of the pipeline, not
   * of this type.
   */
  fidelity?: Fidelity;
};

/**
 * Fold the reference checker's verdict into a summary.
 *
 * Pure, so the translation below is testable without a JVM: the verdict is
 * handed in, never fetched. Two clause families become items a person can act
 * on; everything else lands in a catch-all naming the clause ids — the
 * promise generalized, so no clause present or future fails in silence.
 * Families our own vocabulary already voices (language, figures, headings,
 * the title, annotation nesting) are left to the items that voice them,
 * or every document would say everything twice.
 */
export function withConformance(
  summary: RemediationSummary,
  conformance: Conformance,
): RemediationSummary {
  const out: RemediationSummary = { ...summary, conformance };
  if (conformance.checker !== 'verapdf-ua1' || conformance.compliant) {
    return out;
  }

  const items: Array<{ criterion: string; item: string }> = [];
  const voicedByOurInstrument = /^(7\.2-|7\.2\.|7\.3-|7\.4|7\.1-9|7\.18\.)/;
  const fonts = conformance.failingClauses.filter((clause) => clause.startsWith('7.21.4'));
  const untagged = conformance.failingClauses.filter((clause) => clause.startsWith('7.1-3'));
  const rest = conformance.failingClauses.filter(
    (clause) =>
      !clause.startsWith('7.21.4') &&
      !clause.startsWith('7.1-3') &&
      !voicedByOurInstrument.test(clause),
  );

  if (fonts.length > 0) {
    items.push({
      criterion: 'PDF/UA 7.21.4',
      item: 'the fonts were never embedded by whatever produced this PDF — supply the Word source it was exported from, or re-export it with fonts embedded',
    });
  }
  if (untagged.length > 0) {
    items.push({
      criterion: 'PDF/UA 7.1-3',
      item: 'page content is neither tagged nor marked as decoration — tagging it needs the source document or a person, because guessing the structure would be inventing it',
    });
  }
  if (rest.length > 0) {
    items.push({
      criterion: 'PDF/UA',
      item: `${rest.length} further PDF/UA check${rest.length === 1 ? ' fails' : 's fail'} (${rest.join(', ')}) — a person must review`,
    });
  }

  if (items.length === 0) {
    return out;
  }
  return { ...out, needs: [...(summary.needs ?? []), ...items] };
}

/**
 * Fold the fidelity verdict into a summary.
 *
 * Pure, and the same shape as `withConformance` above: the verdict is handed
 * in, never computed here. Omissions become punch-list items, because an
 * omission is by definition something a person still has to supply.
 *
 * Assertions are deliberately NOT translated into items. A document carrying
 * one is refused rather than delivered, so an assertion reaching this function
 * would mean the gate upstream failed — and quietly rendering it as a work item
 * is exactly how a hard gate decays into a suggestion. It is passed through on
 * `fidelity.defects` where a test can see it, and nowhere else.
 */
export function withFidelity(
  summary: RemediationSummary,
  fidelity: Fidelity,
): RemediationSummary {
  const out: RemediationSummary = { ...summary, fidelity };
  if (!fidelity.checked) return out;

  const caveat =
    fidelity.oracle === 'engine-derived'
      ? ' (read via the document converter, because a legacy .doc carries no readable source)'
      : '';
  // Omissions AND unverified findings both become items. An `unverified`
  // finding is real work — "the delivered document carries more of this than
  // the source reading accounts for, check it" — and the scorer's property is
  // that every finding is voiced somewhere a promise covers. `summary.fidelity`
  // alone is a field no promise covers, which is how a suppressed-but-quiet
  // defect happens. Only assertions stay out, because a document carrying one
  // is refused rather than delivered.
  const items = fidelity.defects
    .filter((defect) => defect.kind !== 'assertion')
    .map((defect) => ({ criterion: defect.criterion, item: `${defect.detail}${caveat}` }));

  if (items.length === 0) return out;

  // A fidelity heading-level item REPLACES the one `needsIn` wrote, rather than
  // sitting beside it. The same problem `withConformance` solves with
  // `voicedByOurInstrument` above — "or every document would say everything
  // twice" — one level up, and here the duplicate is worse than noise.
  //
  // `[V]` On r21 the client got both "Heading levels skip from H1 to H6 —
  // decide whether the author meant an H2" and "heading levels differ from the
  // source". The first is **wrong advice**: the author decided already, writing
  // a Word outline level 7, and PDF has no heading type below H6 to carry it.
  // `needsIn` reads only the delivered document and cannot know that; fidelity
  // read the source and can. The instrument that knows more wins.
  //
  // Scoped to 2.4.10 alone, deliberately. The two vocabularies also share
  // `1.3.1` — annotations outside the structure tree versus lost tables and
  // list items — and those are different subjects that must both survive. A
  // blanket criterion filter would silently swallow one of them.
  //
  // Nothing is dropped when fidelity has no level item to offer: a faithfully
  // transcribed document that genuinely starts at H2 keeps `needsIn`'s
  // question, which is the right one to ask there, and an unreadable source
  // never reaches this line at all.
  const supersedesHeadingLevels = items.some((item) => item.criterion === '2.4.10');
  const kept = (summary.needs ?? []).filter(
    (need) => !(supersedesHeadingLevels && need.criterion === '2.4.10'),
  );

  return { ...out, needs: [...kept, ...items] };
}

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
/**
 * 2 — the summary gained the `needs` punch list and the `filename-derived`
 * title provenance (POLICY 2026-08-27b/c). Readings across the boundary are
 * `incomparable`, never diffed: our vocabulary change must not read as the
 * client's document changing.
 *
 * 3 — the punch list gained the starts-too-deep heading item. The re-run
 * found a real document failing UA-1 7.4.2 with an empty punch list: its
 * headings begin at H2+, which is not a *skip between* consecutive headings
 * and so slipped the version-2 check. Same decision family, new vocabulary.
 *
 * 6 — the summary gained `conformance`: the reference checker's own verdict
 * (veraPDF UA-1), with clause-translated punch items and a catch-all so no
 * clause can fail silently. Absence of the field reads as "not checked",
 * never as clean — older stored readings cannot gain it.
 */
/**
 * 5 — the punch list gained the unnested-annotation item (1.3.1). Found by
 * the corpus check that asserts no document is delivered non-conformant in
 * silence: three real PDFs were, all of them on annotations our reading could
 * see and our vocabulary could not say.
 */
/**
 * 4 — the punch list gained the undeclared-language item. A document that
 * declares no language was already reported as a 3.1.1 gap; it is now also
 * work somebody can do, which is a different sentence and a new one in the
 * vocabulary.
 */
/**
 * 7 — the summary gained `fidelity`: the delivered document compared against
 * what its own SOURCE declared, in the assertion/omission vocabulary. The
 * punch list gains omission items in criteria it could already emit, but from
 * a NEW instrument — a stored reading made before this cannot gain them, and
 * diffing across the boundary would report our new eyes as the client's
 * document changing. Absence reads as "not verified", never as a match.
 */
export const INSTRUMENT_VERSION = 7;

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
    ...needsIn(provenance),
  };
}

/**
 * The punch list, from the same structure the gaps read.
 *
 * Two shapes today, both places automation has honestly run out: a figure
 * with no description (and no caption to transcribe one from — captioned
 * figures never reach this), and a heading hierarchy whose LEVELS skip —
 * renumbering an author's structure would be invention, so the skip is
 * reported where a person can decide what the author meant.
 */
function needsIn(provenance: ConversionProvenance): Pick<RemediationSummary, 'needs'> {
  const { structure } = provenance;
  const needs: Array<{ criterion: string; item: string }> = [];

  // First, because it is one fact about the whole document and the cheapest
  // thing on the list to supply.
  //
  // `[V]` It is also worth more than it looks. On a real municipal PDF this
  // single missing declaration failed three UA-1 clauses at once — text in
  // page content (7.2-34), the metadata title (7.2-33), and, once repair
  // transcribed a link's destination into its Contents entry, that
  // annotation too (7.2-24). The gap string beside this states the fact; the
  // item asks for the work, because nobody can act on "so none is claimed".
  if (provenance.sourceLanguage === null) {
    needs.push({
      criterion: '3.1.1',
      item: 'The document declares no language — name the one it is written in, because a language is never guessed',
    });
  }

  if (structure.annotationsNotInStructure > 0) {
    // 1.3.1 rather than a PDF/UA clause: an annotation outside the structure
    // tree is a relationship that is not programmatically determinable, which
    // the existing vocabulary already covers. Inventing a second criterion
    // scheme to look precise would be worse than reusing the one that fits.
    //
    // Named, never repaired. Nesting an annotation means creating a structure
    // element and choosing where it belongs, which is the inference the
    // PDF-repair STOP forbids.
    const n = structure.annotationsNotInStructure;
    needs.push({
      criterion: '1.3.1',
      item: `${n} form field${n === 1 ? '' : 's'} or link${n === 1 ? '' : 's'} sit outside the document's structure — a screen reader cannot reach ${n === 1 ? 'it' : 'them'} in reading order, and tagging ${n === 1 ? 'it' : 'them'} into place is a person's decision`,
    });
  }

  structure.figures.forEach((figure, index) => {
    if (figure.alt === null) {
      needs.push({
        criterion: '1.1.1',
        item: `Figure ${index + 1} needs a human-written description — no alt text, and no caption to transcribe one from`,
      });
    }
  });

  let previous = 0;
  for (const heading of structure.headings) {
    const level = Number(/^H(\d)/.exec(heading)?.[1] ?? NaN);
    if (Number.isFinite(level)) {
      if (previous === 0 && level > 1) {
        // The first heading is already deep. Not a skip *between* headings,
        // but the same authorship decision — starting at H1 is theirs to
        // make, not ours to renumber.
        needs.push({
          criterion: '2.4.10',
          item: `Heading levels start at H${level} — decide whether the document should begin at an H1`,
        });
      } else if (previous > 0 && level > previous + 1) {
        needs.push({
          criterion: '2.4.10',
          item: `Heading levels skip from H${previous} to H${level} — decide whether the author meant an H${previous + 1}`,
        });
      }
      previous = level;
    }
  }

  return needs.length > 0 ? { needs } : {};
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
