import { z } from 'zod';

import type { ContrastReading, DocumentStructure } from './document-structure';

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
   * Which WCAG success criteria this reading was able to evaluate at all.
   *
   * OPTIONAL, and its absence means "not recorded" — never "everything". Every
   * reading stored before this field existed lacks it, and a surface rendering
   * that absence as full coverage would reintroduce the exact overstatement the
   * field was added to end. The same rule `checker: 'none'` already carries.
   */
  scope?: { criteria: string[] };
  /**
   * What the contrast pass measured on these bytes.
   *
   * Optional, and absence means the pass did not run — "not checked", never
   * clean. Readings taken before `Contrast` graduated cannot gain it.
   */
  contrast?: ContrastReading;
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
/**
 * Which of our own items is supposed to be saying what a clause says.
 *
 * The UA-1 clause a family belongs to, paired with the criterion our own
 * vocabulary voices it under: 7.2 Text with the language item, 7.3 Graphics
 * with the figure descriptions, 7.4 Headings with the heading-level item, 7.18
 * Annotations with the unreachable-annotation item, and 7.1-9 with the title.
 */
const VOICED_BY_OUR_INSTRUMENT: ReadonlyArray<{ clause: RegExp; criterion: string }> = [
  { clause: /^7\.2[-.]/, criterion: '3.1.1' },
  { clause: /^7\.3-/, criterion: '1.1.1' },
  { clause: /^7\.4/, criterion: '2.4.10' },
  { clause: /^7\.18\./, criterion: '1.3.1' },
  { clause: /^7\.1-9/, criterion: '2.4.2' },
];

/**
 * Is one of our own items actually saying this?
 *
 * Suppression has to be EARNED. It used to be unconditional: any clause in a
 * family our vocabulary can speak for was dropped from the catch-all on the
 * assumption that the matching item would be there — and when the item was not
 * there, the clause reached the client as silence.
 *
 * `[V]` The blind corpus found two documents delivered with `needs: []`,
 * `gaps: []` and `compliant: false` naming 7.18.1-2 and 7.18.5-2: not
 * conformant, and not punch-listed either, which is the one outcome this
 * product promises never to produce. Our annotation item counts annotations
 * with no `/StructParent`; veraPDF fails 7.18 for reasons that counter does
 * not see, so it stayed quiet while the suppression spoke for it.
 *
 * Deduplication is still worth having — a document should not say everything
 * twice — so the rule is now: suppress only where the item that covers this
 * clause is present. Otherwise the catch-all names it, and the promise holds.
 */
function alreadyVoiced(clause: string, summary: RemediationSummary): boolean {
  const rule = VOICED_BY_OUR_INSTRUMENT.find((entry) => entry.clause.test(clause));
  if (rule === undefined) return false;
  return (
    (summary.needs ?? []).some((need) => need.criterion === rule.criterion) ||
    summary.gaps.some((gap) => gap.startsWith(`${rule.criterion}:`))
  );
}

/**
 * At most five page numbers, then a count. A page list is not document content,
 * but an unbounded one is a header-size problem: the summary travels in
 * `x-remediation-summary`, which a 101-figure document already took to within
 * 3KB of Node's 16KB default.
 */
function pageList(pages: number[]): string {
  const unique = [...new Set(pages)].sort((a, b) => a - b);
  const noun = unique.length === 1 ? 'page' : 'pages';
  if (unique.length <= 5) return `${noun} ${unique.join(', ')}`;
  return `${noun} ${unique.slice(0, 5).join(', ')} and ${unique.length - 5} more`;
}

/**
 * Fold a contrast reading into a summary.
 *
 * Three buckets, never merged, and the two that are not failures are still
 * VOICED. A ratio nobody could measure and a low-contrast run the document
 * calls decoration are both things this instrument did not decide, and the
 * promise is that what we did not decide is named rather than passed over.
 *
 * One `1.4.3:` gap string, because `documentGapKey` identifies a gap by the
 * criterion before its colon and a second would read as two failures where
 * there is one. The punch items may be several — they are keyed by nothing.
 *
 * Absence of a reading means the pass did not run, and renders as "not
 * checked", never as clean. Same rule `conformance` carries.
 */
export function withContrast(
  summary: RemediationSummary,
  contrast: ContrastReading,
): RemediationSummary {
  const out: RemediationSummary = { ...summary, contrast };
  const items: Array<{ criterion: string; item: string }> = [];
  const gapParts: string[] = [];

  if (contrast.failing > 0) {
    const worst = Math.min(...contrast.findings.map((f) => f.ratio));
    const pages = pageList(contrast.findings.map((f) => f.page));
    gapParts.push(
      `${contrast.failingGlyphs} character${contrast.failingGlyphs === 1 ? '' : 's'}`
      + ` below the minimum contrast ratio, the lowest at ${worst.toFixed(2)}:1`,
    );
    items.push({
      criterion: '1.4.3',
      item: `Contrast: ${contrast.failing} colour combination${contrast.failing === 1 ? '' : 's'}`
        + ` on ${pages} fall below the minimum ratio, the lowest at ${worst.toFixed(2)}:1`
        + ' — a person must decide whether to change the colours, because changing them is a design decision',
    });
  }

  if (contrast.undetermined > 0) {
    gapParts.push(
      `${contrast.undeterminedGlyphs} character${contrast.undeterminedGlyphs === 1 ? '' : 's'}`
      + ' whose contrast could not be measured',
    );
    items.push({
      criterion: '1.4.3',
      item: `Contrast: ${contrast.undeterminedGlyphs} character`
        + `${contrast.undeterminedGlyphs === 1 ? '' : 's'} sit on an image, a gradient or a`
        + ' mixed background, so no single background colour could be read and no ratio is'
        + ' claimed — a person must check these by eye',
    });
  }

  if (contrast.decorative > 0) {
    items.push({
      criterion: '1.4.3',
      item: `Contrast: ${contrast.decorativeGlyphs} character`
        + `${contrast.decorativeGlyphs === 1 ? '' : 's'} below the minimum ratio are marked as`
        + ' decoration or as part of a figure by the document itself. WCAG exempts decoration'
        + ' but not running heads or page numbers, which carry the same marking — a person must'
        + ' confirm which these are',
    });
  }

  if (gapParts.length > 0) {
    out.gaps = [...summary.gaps, `1.4.3: ${gapParts.join(', and ')}`];
  }
  return items.length === 0 ? out : { ...out, needs: [...(summary.needs ?? []), ...items] };
}

export function withConformance(
  summary: RemediationSummary,
  conformance: Conformance,
): RemediationSummary {
  const out: RemediationSummary = { ...summary, conformance };
  if (conformance.checker !== 'verapdf-ua1' || conformance.compliant) {
    return out;
  }

  const items: Array<{ criterion: string; item: string }> = [];
  const fonts = conformance.failingClauses.filter((clause) => clause.startsWith('7.21.4'));
  const untagged = conformance.failingClauses.filter((clause) => clause.startsWith('7.1-3'));
  const identifier = conformance.failingClauses.filter((clause) => clause.startsWith('5-1'));
  const rest = conformance.failingClauses.filter(
    (clause) =>
      !clause.startsWith('7.21.4') &&
      !clause.startsWith('7.1-3') &&
      !clause.startsWith('5-1') &&
      !alreadyVoiced(clause, summary),
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
  if (identifier.length > 0) {
    // Named rather than left to the catch-all, which would have said "a person
    // must review 5-1" — i.e. instructed the client to add back the very claim
    // this document is not entitled to make. The clause is still reported as
    // failing, because it is: what changes is that the item says the absence is
    // CORRECT and asks for no work.
    //
    // The wording states the state of the file, never who chose it. This same
    // function runs on the INSPECTION path, over a client's own source document
    // that we neither wrote nor decided anything about — 13 of 19 real
    // documents in the blind corpus fail 5-1 simply because their producer
    // never wrote an identifier. Saying we withheld it there would be a claim
    // about provenance nobody checked, on a product whose whole position is
    // that it only says what it checked.
    items.push({
      criterion: 'PDF/UA 5-1',
      // Self-contained on purpose. The public report renders punch items
      // WITHOUT their criterion label, so an item written to lean on "PDF/UA
      // 5-1:" trails off mid-sentence there — and this one has to carry the
      // word "correct" itself, because it is the only item in the list that is
      // not work.
      item: 'No PDF/UA-1 conformance identifier is written on this file, and that is correct while it does not conform — adding one would assert a conformance it does not have. This line needs no action; the other items listed are the work.',
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
 * 7 — a title that is only a placeholder stopped counting as a title. An
 * exporter's leftover ("Microsoft Word - Document1.docx") used to be delivered
 * as `already-titled`, satisfying UA-1's DisplayDocTitle while telling a
 * screen-reader user nothing, and it outranked the document's own first
 * heading. The junk policy that always governed filenames now governs the
 * metadata field too, on all three paths that decide a title, and the 2.4.2
 * gap says "no title a reader could use" so it stays true of a document that
 * carries one.
 */
/**
 * 8 — the punch list gained the attached-documents item. A portfolio is a
 * cover sheet with other documents inside it, and neither instrument looks
 * inside one: our reading walks this document's structure, veraPDF validates
 * this document's bytes, so an unremediated attachment failed no clause and
 * produced no finding. The blind corpus planted a tagged cover sheet over an
 * untagged payload and watched it deliver with an empty punch list.
 */
/**
 * 9 — alt text is read for legibility, not only for presence. `1.1.1` used to
 * mean "no alt attribute"; it now means "a reader learns nothing about this
 * figure", which also covers a description that is a filename, a path, a `cid:`
 * reference or a placeholder word. WCAG Technique F30 is the authority, so the
 * item cites a published failure condition rather than our opinion.
 *
 * `[V]` Across the blind corpus's delivered bytes, 153 of 173 `/Alt` strings
 * were one placeholder word, three were a path naming a private host, and one
 * was an embedded-mail reference — all of them counted as descriptions, and the
 * documents carrying them delivered with that work unnamed.
 *
 * This is a MEANING SHIFT, which is why it is a version bump and not a count
 * changing inside an existing string: every stored baseline reads
 * `incomparable` for one cycle, on purpose, so that our change is never
 * reported as the client's document changing.
 */
/**
 * The WCAG success criteria this instrument can reach, and the ones it cannot.
 *
 * These exist because every surface said "no machine-detectable gaps" without
 * saying which gaps it looked for. `legal-standard.md` required the correction
 * on 2026-08-24 — "any claim we make must exclude these explicitly or cover them
 * by other means" — and nothing implemented it.
 *
 * `CHECKED_CRITERIA` is what `gapsIn` and `needsIn` between them can emit; note
 * `2.4.10` comes only from `needsIn`. A test drives `summarise` over a battery
 * of fixtures and asserts the emitted set equals this one, so a criterion cannot
 * be added to the instrument without appearing in what the product claims to
 * have checked.
 *
 * `NOT_CHECKED_CRITERIA` is curated rather than derived, and deliberately short.
 * Two of the three — `1.3.2` and `4.1.2` — are what is left when you subtract
 * `CHECKED_CRITERIA` from `legal-standard.md`'s seven-criterion pass mark.
 * `1.4.1` is NOT on that pass mark and is disclosed anyway: the corpus raises it
 * (a fee schedule marks changed values in red) and we measured that we cannot
 * check it, so silence would read as a pass. Do not re-derive this list from the
 * pass mark alone — that drops `1.4.1`. And do not derive "every AA criterion
 * minus CHECKED" either: that names captions and audio description on a text
 * document, which is noise wearing the costume of disclosure.
 */
export const CHECKED_CRITERIA = ['1.1.1', '1.3.1', '1.4.3', '2.4.2', '2.4.10', '3.1.1'] as const;

export const NOT_CHECKED_CRITERIA: ReadonlyArray<{ number: string; name: string }> = [
  // 1.4.3 moved to CHECKED when `Contrast` graduated. 1.4.1 did NOT move with
  // it and must not be assumed to have: the same fee schedule that fails
  // contrast sets changed values in red, which is meaning carried by colour
  // alone, and nothing here detects that.
  { number: '1.4.1', name: 'Use of Color' },
  { number: '1.3.2', name: 'Meaningful Sequence' },
  { number: '4.1.2', name: 'Name, Role, Value' },
];

/**
 * 10 — the punch list gained contrast. `Contrast` graduated from the spike and
 * measures WCAG 1.4.3 on the delivered bytes: foreground exactly from the
 * graphics state, background sampled from the rendered page.
 *
 * This closes the first of the three blocking conditions in
 * `decision-2026-08-24.md` — "No document goes to a client until contrast is at
 * least detected and flagged" — which had stood unmet since it was written.
 *
 * `[V]` Across the blind corpus's 23 real documents: 5 fail, 3,626 failing
 * glyphs, the worst at 1.49:1. The pipeline delivered every one of them in
 * silence before this.
 *
 * A new criterion is the clearest case the bump rule covers. Without it every
 * stored baseline would report `1.4.3` as a new gap, and the comparator would
 * read our instrument growing as the client's document getting worse.
 */
export const INSTRUMENT_VERSION = 10;

function gapsIn(provenance: ConversionProvenance): string[] {
  const { structure, title, sourceLanguage } = provenance;
  const gaps: string[] = [];

  if (title.kind === 'no-heading-to-copy') {
    gaps.push(
      // "no title a reader could use" rather than "no title": since version 7
      // this also covers a document that carries a placeholder an exporter
      // wrote, and saying it has no title at all would be false about it.
      '2.4.2: the document has no title a reader could use, no heading to copy one from, and no usable filename to derive one',
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
  //
  // A PRESENT alt that describes nothing is a third case and belongs with the
  // absent one, because it is the same work for the same person. It is folded
  // into this single gap string rather than given its own: `documentGapKey`
  // identifies a gap by the criterion before its colon, so a second `1.1.1:`
  // gap would collide with this one and the regression comparator would read
  // one failure as two.
  const undescribed = undescribedFigures(structure.figures);
  if (undescribed.total > 0) {
    const noun = `figure${undescribed.total === 1 ? '' : 's'}`;
    if (undescribed.placeholder === 0) {
      // Unchanged wording when nothing new applies, so a stored baseline taken
      // before this reading does not read as a changed document.
      gaps.push(`1.1.1: ${undescribed.total} ${noun} with no alt text`);
    } else if (undescribed.absent === 0) {
      gaps.push(
        `1.1.1: ${undescribed.total} ${noun} whose description is a placeholder,`
        + ' not a description',
      );
    } else {
      // Only ever the sub-counts that are non-zero. This renders on a client's
      // report, and a breakdown reading "(0 with no alt text, ...)" spends the
      // reader's attention on a clause that says nothing.
      gaps.push(
        `1.1.1: ${undescribed.total} ${noun} a reader learns nothing about`
        + ` (${undescribed.absent} with no alt text,`
        + ` ${undescribed.placeholder} whose description is a placeholder)`,
      );
    }
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
    // What this reading looked for, travelling with the reading. A caller
    // reading the response header would otherwise get a gap list with no way to
    // know how narrow it is — the same shape of overstatement as a conformance
    // identifier written without a verdict behind it.
    scope: { criteria: [...CHECKED_CRITERIA] },
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

  if (structure.embeddedFiles > 0) {
    // `PDF/UA 7.11` rather than a WCAG criterion, and for the opposite reason
    // the item above reuses 1.3.1. There, the defect was known: an annotation
    // outside the tree IS a relationship that is not programmatically
    // determinable. Here nothing is known — an attachment was never opened, so
    // naming a success criterion would assert a failure that has not been
    // checked, which is the invention this product refuses. 7.11 is the
    // standard's own section for embedded files, and says only what is true:
    // this concerns the attachments.
    //
    // Counted, never opened. Remediating an attachment means rewriting the
    // container around it, and the honest instruction is that each attached
    // document goes through this pipeline on its own.
    const n = structure.embeddedFiles;
    needs.push({
      criterion: 'PDF/UA 7.11',
      item: `${n} document${n === 1 ? ' is' : 's are'} attached to this file and ${n === 1 ? 'was' : 'were'} not examined — nothing here reads inside an attachment, so ${n === 1 ? 'it needs' : 'each needs'} remediating on its own`,
    });
  }

  // These two items are deliberately TERSE, and that is a transport constraint
  // rather than a style choice. The summary travels in the
  // `x-remediation-summary` response header, one item per undescribed figure,
  // and a real municipal document in the blind corpus carries 101 of them. At
  // the original wording that header reached 22,743 bytes and every client on
  // Node's 16KB default rejected the whole response with "Headers Overflow
  // Error" — the client got no punch list at all, which is worse than a blunt
  // one. See the residual note in AGENTS.md: shortening buys headroom, it does
  // not bound the header, and the contract is what actually needs fixing.
  // The item never quotes the description it is refusing. One of the strings
  // this rule catches in the wild is a UNC path naming a private host and an
  // internal directory tree; echoing it here would publish that on the client's
  // own report page, which is the exact thing the counts-and-outcomes rule at
  // the top of this file exists to prevent. What the item says is WHY, by
  // shape — never the string itself.
  structure.figures.forEach((figure, index) => {
    if (figure.alt === null) {
      needs.push({
        criterion: '1.1.1',
        item: `Figure ${index + 1}: no alt text and no caption to transcribe — write a description`,
      });
    } else if (isPlaceholderAlt(figure.alt)) {
      needs.push({
        criterion: '1.1.1',
        item: `Figure ${index + 1}: its alt text is a placeholder, not a description (WCAG F30) — write one`,
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

/**
 * A producer stamping its own name onto a title it invented.
 *
 * "Microsoft Word - Fee_Schedule.docx" is not a title somebody wrote; it is an
 * exporter announcing that nobody did.
 */
const PRODUCER_STAMP = /^(microsoft\s+)?(word|excel|powerpoint|publisher|acrobat)\s*[-–—:]\s*/i;

/**
 * Is this title a placeholder rather than a title?
 *
 * The product already refuses junk when it comes from a *filename* — "doc1",
 * "untitled", "scan_0001" produce no title at all, because a bad derived title
 * is worse than a reported absence. The same junk arriving in the metadata
 * field was carried through untouched, so a document could be delivered
 * `already-titled` as "Microsoft Word - Document1.docx": satisfying UA-1's
 * DisplayDocTitle and telling a screen-reader user nothing. That asymmetry is
 * what this closes — same policy, same table, both doors.
 *
 * It is a PREDICATE, never a rewriter. A title that survives is delivered
 * exactly as the document wrote it: declining a claim we cannot stand behind
 * is the move `/Lang` established, and editing one would be a different and
 * much larger liberty.
 *
 * `[V]` Found by the blind corpus, where it was registered as an open question
 * before the run rather than discovered after it.
 */
export function isPlaceholderTitle(title: string): boolean {
  const cleaned = title
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < 3) return true;

  // A producer stamp settles it on PROVENANCE rather than on content.
  // "Microsoft Word - Fee_Schedule.docx" is what Word writes when the document
  // has no title: it fills the field with the filename. The residue may well
  // be informative, and that is exactly why declining costs nothing — the
  // chain's next rungs are the document's own heading and then the filename,
  // which recovers the same words under a provenance label that is true.
  if (PRODUCER_STAMP.test(cleaned)) return true;

  // Otherwise the same junk table the filename chain uses, so there is one
  // policy and not two to keep in step.
  return titleFromFilename(cleaned) === null;
}

/**
 * Descriptions a machine left behind, by the three shapes WCAG names.
 *
 * `PLACEHOLDER_ALT` is matched WHOLE and case-insensitively, never as a prefix:
 * "Image of the north pump house at dusk" is a real description that begins with
 * a placeholder word, and a prefix test would eat it.
 */
const PLACEHOLDER_ALT = new Set([
  'decorative', 'spacer', 'image', 'picture', 'graphic', 'photo', 'blank',
  'untitled', 'placeholder',
]);
const ALT_FILE_PATH = /^(\\\\|[A-Za-z]:\\|\/Users\/|\/home\/|file:\/\/)/;
const ALT_FILENAME = /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg|eps)$/i;
const ALT_CID_REFERENCE = /\bcid:/i;
const ALT_PROGRAMMATIC = /^(picture|image|photo|graphic|figure|img)\s*\d+$|^\d+$/i;

/**
 * Is this description one a reader can use, or one an exporter left behind?
 *
 * WCAG 2.1 **Technique F30** is the standard, not our taste: "Failure of
 * Success Criterion 1.1.1 and 1.2.1 due to using text alternatives that are not
 * alternatives (e.g., filenames or placeholder text)". Its three categories —
 * placeholder text, programming references, filenames — are what this refuses,
 * and it refuses nothing beyond them. A punch item that cites a published
 * failure condition is defensible; one that cites our opinion of a sentence is
 * not, and this product's whole position is that it only says what it checked.
 *
 * PROVENANCE, never quality — the same footing as `isPlaceholderTitle`. Every
 * rule here says "a machine put this here", and none says "this description is
 * poor". We cannot know whether a description is accurate; we can know that a
 * UNC path is not one.
 *
 * A PREDICATE, never a rewriter. Nothing in this product invents a description:
 * the VLM ban is absolute, so what a flagged figure gets is a punch item asking
 * a person for one.
 *
 * Two normalisations before testing, both provenance rather than cosmetics:
 * a TRAILING NUL is a producer's string terminator (without stripping it, three
 * legitimate descriptions in the blind corpus read as illegible, one of them on
 * the only conformant real PDF), and a leading "Description:" is an exporter
 * prefix in the shape `PRODUCER_STAMP` already refuses on titles.
 *
 * Deliberately NOT copied from `isPlaceholderTitle`: its `length < 3` refusal.
 * A legitimate CJK description can be two characters, and short is not the same
 * as absent.
 */
export function isPlaceholderAlt(alt: string): boolean {
  const cleaned = alt
    // Bounded before any pattern runs: the string comes from an untrusted
    // document and must not set the amount of work.
    .slice(0, 500)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+$/, '')
    .replace(/^description:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Empty is a positive claim that the graphic carries no meaning, which is a
  // different answer from an absent one and is not this predicate's business.
  if (cleaned === '') return false;

  return (
    ALT_FILE_PATH.test(cleaned)
    || ALT_CID_REFERENCE.test(cleaned)
    || ALT_FILENAME.test(cleaned)
    || PLACEHOLDER_ALT.has(cleaned.toLowerCase())
    || ALT_PROGRAMMATIC.test(cleaned)
  );
}

/**
 * Figures a reader learns nothing about: no description, or one that describes
 * nothing. Counted together because they are the same work for the same person.
 */
export function undescribedFigures(
  figures: ReadonlyArray<{ alt: string | null }>,
): { absent: number; placeholder: number; total: number } {
  const absent = figures.filter((figure) => figure.alt === null).length;
  const placeholder = figures.filter(
    (figure) => figure.alt !== null && isPlaceholderAlt(figure.alt),
  ).length;
  return { absent, placeholder, total: absent + placeholder };
}

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
