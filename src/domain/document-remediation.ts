import { z } from 'zod';

import type { Ask, FigurePrior } from './document-answers';
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
   * The punch list's identities: `asks[i]` is what a program needs to attach
   * an answer to `needs[i]`. POSITIONAL — the two are emitted from one loop
   * through one helper, and present or absent together. Stripped from the
   * response header (`transportSummary`) because a bounded punch list can no
   * longer be indexed, and from the public report because a pinned snapshot
   * cannot keep answer state current.
   */
  asks?: Ask[];
  /**
   * The document's own words around each open figure, so a person can write
   * a description from context. CONTENT, and treated as `titleText` is:
   * stored, never logged, never on the public page, never in the header.
   */
  excerpt?: DocumentExcerpt;
  /**
   * What this run wrote from a person's declaration, as counts — provenance
   * of the pipeline's own claims, on the same footing as `title:
   * 'filename-derived'`. Absent when nothing was declared.
   */
  declared?: { language?: true; figures: number };
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

export type DocumentExcerpt = {
  figures: Array<{
    ordinal: number;
    context: { heading?: string; before?: string; after?: string; caption?: string };
  }>;
};

/**
 * The one way a punch item is emitted. The sentence and its identity go in
 * together, so neither array can gain an entry the other lacks and the
 * criterion is typed once.
 */
type Punch = { needs: Array<{ criterion: string; item: string }>; asks: Ask[] };

function punch(out: Punch, ask: Ask, item: string): void {
  out.needs.push({ criterion: ask.criterion, item });
  out.asks.push(ask);
}

function punchedOnto(summary: RemediationSummary, work: Punch): RemediationSummary {
  if (work.needs.length === 0) return summary;
  return {
    ...summary,
    needs: [...(summary.needs ?? []), ...work.needs],
    asks: [...(summary.asks ?? []), ...work.asks],
  };
}

/**
 * The most the summary may occupy in the response header, in encoded bytes.
 *
 * The whole summary rides in `x-remediation-summary` because the body is the
 * PDF, and Node's default `--max-http-header-size` is 16,384 bytes for the
 * ENTIRE header block. A real municipal document carrying 101 undescribed
 * figures once produced a 22,743-byte value, and every client on that default
 * rejected the whole response with `Headers Overflow Error` — the client got
 * the file and no punch list at all, which is worse than a blunt one.
 *
 * That was patched by shortening two item strings, which bought headroom and
 * not a bound: the worst document sat at 13,212 bytes with roughly 23 items of
 * margin, and every criterion added since has spent some of it.
 *
 * 14,000 leaves 2,384 of the 16,384 for the rest of the header block — an order
 * of magnitude more than the four headers this response sets, with the balance
 * for whatever a proxy adds. The worst real document (13,212) still fits whole,
 * which is the point: this is a safety net for a punch list that grows without
 * limit, not a routine trim.
 *
 * It was 12,000 first, chosen so the corpus's worst document would cross it on
 * the reasoning that a bound nothing reaches is a bound nothing has verified.
 * That was wrong twice over. The property is verified by tests that drive 400
 * and 5,000 items, so the corpus does not need to exercise it — and at 12,000
 * the blind test showed the real cost: 12 of r05's 101 figure items dropped
 * from a client's punch list to make room for nothing.
 */
export const SUMMARY_HEADER_BUDGET = 14_000;

/**
 * Fit a summary into the header budget without ever dropping anything quietly.
 *
 * `measure` is injected because the encoding is a transport detail — the header
 * value is ASCII-escaped JSON, where one CJK character costs six bytes — and
 * the vocabulary should not know that. It also lets the test drive the boundary
 * with a trivial measure instead of reconstructing the escaping.
 *
 * Three rules, in order:
 *
 * 1. **Every criterion keeps at least one item.** The items that matter most on
 *    the worst real document sit at the END of its list — the fonts item, the
 *    identifier item, the PDF/UA catch-all — behind 101 figure items that
 *    differ only by their number. Truncating the tail would keep a hundred
 *    near-identical lines and drop the three that say something. It also means
 *    a criterion can never vanish from the punch list, so the blind corpus's
 *    `punch-missing` can never fire because of a size limit.
 * 2. **Then as many of the rest as fit**, in their original order.
 * 3. **Then one item saying how many are not shown.** Never a silent cap. The
 *    gaps carry the counts, so what is lost is which figure, not how many.
 *
 * Returns the summary unchanged when it already fits, which is every document
 * in the corpus but one.
 *
 * **It bounds the punch list, not the whole summary.** The list is the part
 * that grows without limit — one item per undescribed figure, per unnamed form
 * field — and it is the part that broke a delivery. The rest is counts, a
 * title and the failing-clause list, and trimming those would change facts
 * rather than shorten a list. If a document ever arrives whose title and gaps
 * alone exceed the budget, this returns the smallest summary it can build and
 * the header is still too large; that is a different bug from the one here and
 * should be fixed where those fields are produced.
 */
export function boundSummary(
  summary: RemediationSummary,
  measure: (value: RemediationSummary) => number,
  budget: number = SUMMARY_HEADER_BUDGET,
): RemediationSummary {
  if (measure(summary) <= budget) return summary;

  // The title goes before any punch item does.
  //
  // Everything in a summary is either computed by us and small — counts, gaps
  // (one string per criterion), a clause list bounded by what UA-1 defines —
  // or it is `titleText`, which is the document's OWN title: content we
  // transcribed, of no bounded length. The corpus's longest is 159 characters;
  // a `/Title` holding a paragraph is a document we have not met yet.
  //
  // Order is the whole point. The punch list is the deliverable and the title
  // is decoration beside it, so an oversized title must never cost a client a
  // single item — which is exactly what happened when this trimmed last. And
  // the failure it prevents is total: a header over the client's limit is
  // rejected whole, and they get the FILE with no summary at all — no counts,
  // no verdict, no punch list.
  //
  // The marker means nobody mistakes the result for what the document says.
  if (typeof summary.titleText === 'string') {
    let title = summary.titleText;
    while (title.length > 0 && measure({ ...summary, titleText: `${title}…` }) > budget) {
      title = title.slice(0, Math.floor(title.length * 0.8));
    }
    if (title.length !== summary.titleText.length) {
      // Dropped entirely if not even a marker fits. `title` still states the
      // KIND — already-titled, transcribed — so no provenance is lost; only the
      // text goes, and the text is in the document.
      const { titleText: _too_long, ...withoutTitle } = summary;
      const trimmed: RemediationSummary =
        title.length === 0 ? withoutTitle : { ...summary, titleText: `${title}…` };
      if (measure(trimmed) <= budget) return trimmed;
      summary = trimmed;
    }
  }

  const all = summary.needs ?? [];
  const omittedItem = (n: number, anyShown: boolean) => ({
    // No criterion of its own: this is a statement about the list, not a
    // finding about the document, and giving it one would put a criterion in
    // the summary that no emitter produced.
    criterion: 'summary',
    // Self-contained, because the public report renders items without their
    // criterion label — and careful to say what is missing and what is not.
    // The "listed above" clause is dropped when nothing is listed above, which
    // happens when a single item is larger than the whole budget.
    item: `${n} item${n === 1 ? '' : 's'}${anyShown ? ' of the kinds listed above' : ''} ${n === 1 ? 'is' : 'are'} not shown here, because the summary has a size limit this response must respect — nothing is missing from the counts, only from this list`,
  });

  // Which items to keep is decided here; the ORDER they go out in is always the
  // order they arrived in. Selecting and ordering separately matters: the
  // per-criterion picks below are drawn from all over the list, and emitting
  // them in selection order would silently reshuffle a client's punch list.
  const chosen = new Set<number>();
  const rest: number[] = [];
  const seen = new Set<string>();
  all.forEach((need, index) => {
    // Rule 1: the first item of each criterion, wherever it appears.
    if (seen.has(need.criterion)) rest.push(index);
    else {
      seen.add(need.criterion);
      chosen.add(index);
    }
  });

  const emit = (indices: Set<number>) =>
    all.filter((_, index) => indices.has(index));

  const fits = (indices: Set<number>) => {
    const needs = emit(indices);
    const omitted = all.length - needs.length;
    return measure({
      ...summary,
      needs: omitted > 0 ? [...needs, omittedItem(omitted, needs.length > 0)] : needs,
    }) <= budget;
  };

  // Rule 2: add what fits, in the order the items arrived.
  for (const index of rest) {
    chosen.add(index);
    if (!fits(chosen)) {
      chosen.delete(index);
      break;
    }
  }

  // Rule 1 is a preference, not a guarantee, and saying otherwise would be the
  // kind of bound that is really headroom. A document with very many criteria,
  // or one item larger than the entire budget, overflows on the per-criterion
  // set alone. Drop the LAST-appearing of them in that case, and go all the way
  // to zero if that is what it takes — an over-budget header delivers NO punch
  // list at all, so a short one always beats it.
  while (chosen.size > 0 && !fits(chosen)) {
    chosen.delete(Math.max(...chosen));
  }

  const needs = emit(chosen);
  const omitted = all.length - needs.length;
  if (omitted <= 0) return { ...summary, needs };
  return { ...summary, needs: [...needs, omittedItem(omitted, needs.length > 0)] };
}

/**
 * Fold the reference checker's verdict into a summary.
 *
 * Pure, so the translation below is testable without a JVM: the verdict is
 * handed in, never fetched. Two clause families become items a person can act
 * on; everything else lands in a catch-all naming the clause ids — the
 * promise generalized, so no clause present or future fails in silence.
 * Clauses our own vocabulary already voices (language, figures, headings, the
 * title, a form field's name) are left to the items that voice them, or every
 * document would say everything twice. Note CLAUSES, not families — see the
 * table below for the four that reached nobody when 7.18 was routed whole.
 */
/**
 * Which of our own items is supposed to be saying what a clause says.
 *
 * The UA-1 clause a family belongs to, paired with the criterion our own
 * vocabulary voices it under: 7.2 Text with the language item, 7.3 Graphics
 * with the figure descriptions, 7.4 Headings with the heading-level item,
 * 7.1-9 with the title, and 7.18.1-3 with the form-field name.
 *
 * ## Route a CLAUSE, never a family
 *
 * `7.18` used to be routed whole, to 1.3.1, on the reading that our
 * unreachable-annotation item speaks for annotations. It does not. `7.18` holds
 * unrelated questions — a form field's name (7.18.1-3), a page's `/Tabs`
 * (7.18.3-1), a widget's `Form` nesting (7.18.4-1), a link's `Link` nesting
 * (7.18.5-1) — and our item answers only the last two, approximately. Because
 * suppression is earned per CRITERION rather than per clause, any document
 * carrying the 1.3.1 item suppressed the whole family with it.
 *
 * `[V]` Measured across the corpus: r13 (a real document) reached the client
 * with `7.18.3-1` and `7.18.4-1` named nowhere, p15 with `7.18.4-1`, p30 with
 * `7.18.5-1` — four instances, in no gap, no need and no catch-all. Documents
 * where the 1.3.1 item was absent voiced their 7.18 clauses correctly, which is
 * what showed the mechanism was sound and the route was not.
 *
 * Only `7.18.1-3` stays, because 4.1.2's item genuinely says what that clause
 * says: this many form fields have no accessible name. The rest of 7.18 now
 * falls to the catch-all and is named by id. That costs mild duplication on a
 * document where the 1.3.1 item also fires, which is a far smaller thing than a
 * clause reaching nobody.
 */
const VOICED_BY_OUR_INSTRUMENT: ReadonlyArray<{ clause: RegExp; criterion: string }> = [
  { clause: /^7\.2[-.]/, criterion: '3.1.1' },
  { clause: /^7\.3-/, criterion: '1.1.1' },
  { clause: /^7\.4/, criterion: '2.4.10' },
  { clause: /^7\.18\.1-3/, criterion: '4.1.2' },
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
  const out: RemediationSummary = {
    ...summary,
    contrast,
    // The pass ran, so `1.4.3` joins what this reading claims to have looked at.
    // Absent scope stays absent: a reading stored before the field existed
    // cannot say what it looked for, and inventing one here would render as
    // full coverage on every surface.
    ...(summary.scope === undefined
      ? {}
      : { scope: scopeOf(new Set([...summary.scope.criteria, MEASURED_BY_A_SEPARATE_STAGE])) }),
  };
  const work: Punch = { needs: [], asks: [] };
  const gapParts: string[] = [];
  const contrastAsk = (facet: 'failing' | 'undetermined' | 'decorative'): Ask => ({
    id: `contrast:${facet}`, kind: 'contrast', criterion: '1.4.3', answerable: 'operator',
  });

  if (contrast.failing > 0) {
    const worst = Math.min(...contrast.findings.map((f) => f.ratio));
    const pages = pageList(contrast.findings.map((f) => f.page));
    gapParts.push(
      `${contrast.failingGlyphs} character${contrast.failingGlyphs === 1 ? '' : 's'}`
      + ` below the minimum contrast ratio, the lowest at ${worst.toFixed(2)}:1`,
    );
    punch(work, contrastAsk('failing'),
      `Contrast: ${contrast.failing} colour combination${contrast.failing === 1 ? '' : 's'}`
        + ` on ${pages} fall below the minimum ratio, the lowest at ${worst.toFixed(2)}:1`
        + ' — a person must decide whether to change the colours, because changing them is a design decision',
    );
  }

  if (contrast.undetermined > 0) {
    gapParts.push(
      `${contrast.undeterminedGlyphs} character${contrast.undeterminedGlyphs === 1 ? '' : 's'}`
      + ' whose contrast could not be measured',
    );
    punch(work, contrastAsk('undetermined'),
      `Contrast: ${contrast.undeterminedGlyphs} character`
        + `${contrast.undeterminedGlyphs === 1 ? '' : 's'} sit on an image, a gradient or a`
        + ' mixed background, so no single background colour could be read and no ratio is'
        + ' claimed — a person must check these by eye',
    );
  }

  if (contrast.decorative > 0) {
    punch(work, contrastAsk('decorative'),
      `Contrast: ${contrast.decorativeGlyphs} character`
        + `${contrast.decorativeGlyphs === 1 ? '' : 's'} below the minimum ratio are marked as`
        + ' decoration or as part of a figure by the document itself. WCAG exempts decoration'
        + ' but not running heads or page numbers, which carry the same marking — a person must'
        + ' confirm which these are',
    );
  }

  if (gapParts.length > 0) {
    out.gaps = [...summary.gaps, `1.4.3: ${gapParts.join(', and ')}`];
  }
  return punchedOnto(out, work);
}

export function withConformance(
  summary: RemediationSummary,
  conformance: Conformance,
): RemediationSummary {
  const out: RemediationSummary = { ...summary, conformance };
  if (conformance.checker !== 'verapdf-ua1' || conformance.compliant) {
    return out;
  }

  const work: Punch = { needs: [], asks: [] };
  const client = (id: string, kind: Ask['kind'], criterion: string): Ask => ({
    id, kind, criterion, answerable: 'client',
  });
  // `7.21.4` is a FAMILY, and its two members say opposite things about the
  // document. `7.21.4.1` is a font that was never embedded — there is no font
  // data, and the fix is the source. `7.21.4.2` is an embedded font whose
  // CIDSet does not list every character used — the font IS there.
  //
  // Matching the family prefix and printing the embedding sentence told 13
  // documents in the blind corpus, whose only font failure is `7.21.4.2-2`,
  // that "the fonts were never embedded by whatever produced this PDF" and
  // sent them to re-export a source to fix a problem they do not have. A false
  // statement about a client's document, and work that would not have helped.
  //
  // The CRITERION label stays `PDF/UA 7.21.4` for both. It names the family
  // the clause belongs to, `score.ts` accounts for the clause by that family,
  // and the keys carry `mustVoice: ["7.21.4"]` — splitting the label would
  // turn every one of these clauses silent and buy nothing a reader can see.
  // What a reader sees is the item text, and that is what was wrong.
  const notEmbedded = conformance.failingClauses.filter((clause) => clause.startsWith('7.21.4.1'));
  const cidSet = conformance.failingClauses.filter((clause) => clause.startsWith('7.21.4.2'));
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

  if (notEmbedded.length > 0) {
    punch(work, client('fonts:not-embedded', 'fonts', 'PDF/UA 7.21.4'),
      'the fonts were never embedded by whatever produced this PDF — supply the Word source it was exported from, or re-export it with fonts embedded',
    );
  }
  if (cidSet.length > 0) {
    punch(work, client('fonts:cidset', 'fonts', 'PDF/UA 7.21.4'),
      "an embedded font's character-set table (CIDSet) does not list every character the document uses — the fonts themselves ARE embedded, so re-exporting from the source with fonts fully embedded is what resolves this",
    );
  }
  // A member of the family that is neither: voiced by id rather than described,
  // so a clause this vocabulary has never seen cannot reach a client in
  // silence just because its family is known.
  const otherFonts = fonts.filter(
    (clause) => !clause.startsWith('7.21.4.1') && !clause.startsWith('7.21.4.2'),
  );
  if (otherFonts.length > 0) {
    punch(work, client('fonts:other', 'fonts', 'PDF/UA 7.21.4'),
      `${otherFonts.length} further font check${otherFonts.length === 1 ? '' : 's'} fail (${otherFonts.join(', ')}) — a person must review`,
    );
  }
  if (untagged.length > 0) {
    punch(work, client('untagged', 'untagged', 'PDF/UA 7.1-3'),
      'page content is neither tagged nor marked as decoration — tagging it needs the source document or a person, because guessing the structure would be inventing it',
    );
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
    punch(work, { id: 'identifier', kind: 'identifier', criterion: 'PDF/UA 5-1', answerable: 'none' },
      // Self-contained on purpose. The public report renders punch items
      // WITHOUT their criterion label, so an item written to lean on "PDF/UA
      // 5-1:" trails off mid-sentence there — and this one has to carry the
      // word "correct" itself, because it is the only item in the list that is
      // not work.
      'No PDF/UA-1 conformance identifier is written on this file, and that is correct while it does not conform — adding one would assert a conformance it does not have. This line needs no action; the other items listed are the work.',
    );
  }
  if (rest.length > 0) {
    punch(work, { id: 'pdfua', kind: 'pdfua', criterion: 'PDF/UA', answerable: 'operator' },
      `${rest.length} further PDF/UA check${rest.length === 1 ? ' fails' : 's fail'} (${rest.join(', ')}) — a person must review`,
    );
  }

  return punchedOnto(out, work);
}

/**
 * Fold the repair decision into an inspection's summary.
 *
 * A refusal used to be an HTTP answer and nothing else: an inspected signed
 * PDF said nothing about its signature until somebody clicked Repair, and
 * then forgot on navigation. As a punch item it is on the record from the
 * first reading, and as a `client` ask it lands where the work is — with the
 * client, who holds the Word source or the signer. Pure, like `withConformance`:
 * the decision is handed in, never made here.
 */
export function withRepairability(
  summary: RemediationSummary,
  // The shape of `services/document-repair`'s `RepairDecision`, stated here
  // rather than imported: domain does not depend on services, even for a type.
  decision:
    | { repairable: true }
    | { repairable: false; refusal: { kind: 'not-tagged' | 'signed' | 'encrypted'; reason: string } },
): RemediationSummary {
  if (decision.repairable) return summary;
  const work: Punch = { needs: [], asks: [] };
  punch(
    work,
    { id: `repair:${decision.refusal.kind}`, kind: 'repair', criterion: 'repair', answerable: 'client' },
    decision.refusal.reason,
  );
  return punchedOnto(summary, work);
}

/** Record what a run wrote from a person's declaration. Counts only. */
export function withDeclarations(
  summary: RemediationSummary,
  declared: { language?: true; figures: number },
): RemediationSummary {
  if (declared.figures === 0 && declared.language === undefined) return summary;
  return { ...summary, declared };
}

/**
 * The document's own words around each open figure.
 *
 * `Inspect` visits a figure in `order[]` in the same pre-order pass that adds
 * it to `figures[]`, so the k-th `Figure|Formula` entry of `order` IS
 * `figures[k]`. From there the nearest heading before it, the nearest block
 * of text on either side, and a caption beside it are what a person needs to
 * describe the figure without opening the file. Only figures with an open
 * ask get one — a described figure needs no context.
 */
export function withExcerpt(
  summary: RemediationSummary,
  structure: DocumentStructure,
): RemediationSummary {
  const open = (summary.asks ?? []).flatMap((ask) =>
    ask.kind === 'figure' && ask.target && 'ordinal' in ask.target ? [ask.target.ordinal] : [],
  );
  if (open.length === 0) return summary;

  const isFigure = (type: string) => type === 'Figure' || type === 'Formula';
  const positions = structure.order.flatMap((entry, i) => (isFigure(entry.type) ? [i] : []));
  const text = (i: number) => structure.order[i]?.text ?? undefined;
  const isText = (i: number) =>
    text(i) !== undefined && text(i) !== '' && !isFigure(structure.order[i].type);

  const figures = open.map((ordinal) => {
    const m = positions[ordinal];
    const context: DocumentExcerpt['figures'][number]['context'] = {};
    if (m !== undefined) {
      for (let i = m - 1; i >= 0; i -= 1) {
        if (/^H\d/.test(structure.order[i].type) && text(i)) { context.heading = text(i); break; }
      }
      for (let i = m - 1; i >= 0; i -= 1) {
        if (isText(i) && !/^H\d/.test(structure.order[i].type)) { context.before = text(i); break; }
      }
      for (let i = m + 1; i < structure.order.length; i += 1) {
        if (isText(i)) { context.after = text(i); break; }
      }
      const caption = [m + 1, m - 1].find((i) => structure.order[i]?.type === 'Caption' && text(i));
      if (caption !== undefined) context.caption = text(caption);
    }
    return { ordinal, context };
  });
  return { ...summary, excerpt: { figures } };
}

/**
 * The summary as it may travel in the response header: without the identities
 * a bounded punch list can no longer index, and without the excerpt, which is
 * document content. The persisted row keeps both.
 */
export function transportSummary(
  summary: RemediationSummary,
): Omit<RemediationSummary, 'asks' | 'excerpt'> {
  const { asks: _asks, excerpt: _excerpt, ...rest } = summary;
  return rest;
}

/** What a figure's description looked like — the preimage an answer is checked against. */
export function figurePrior(alt: string | null): FigurePrior | null {
  if (alt === null) return 'absent';
  if (isDeclaredDecorative(alt)) return 'decorative';
  if (isPlaceholderAlt(alt)) return 'placeholder';
  return null;
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
 * `1.3.2` is what is left when you subtract `CHECKED_CRITERIA` from
 * `legal-standard.md`'s seven-criterion pass mark — `4.1.2` left this list when
 * `Inspect` began counting form fields with no accessible name.
 * `1.4.1` is NOT on that pass mark and is disclosed anyway: the corpus raises it
 * (a fee schedule marks changed values in red) and we measured that we cannot
 * check it, so silence would read as a pass. Do not re-derive this list from the
 * pass mark alone — that drops `1.4.1`. And do not derive "every AA criterion
 * minus CHECKED" either: that names captions and audio description on a text
 * document, which is noise wearing the costume of disclosure.
 *
 * BOTH entries are measured decisions, not unexamined gaps, and the detectors
 * were built far enough to know what they would say before being refused. Read
 * `use-of-color-feasibility.md` and `meaningful-sequence-feasibility.md` before
 * proposing either — 1.4.1 fires on 17 of 23 real documents and is right about
 * roughly 4, and 1.3.2's page-order check has zero true positives in 23.
 */
export const CHECKED_CRITERIA = ['1.1.1', '1.3.1', '1.4.3', '2.4.2', '2.4.10', '3.1.1', '4.1.2'] as const;

/**
 * The one criterion in `CHECKED_CRITERIA` that no reading can claim on its own.
 *
 * Every other criterion is decided by `gapsIn`/`needsIn` from the structure
 * `Inspect` returned, so if there is a summary at all, they were evaluated.
 * `1.4.3` is different: it comes from a SEPARATE STAGE that may not run — a
 * host without the contrast jar, a JVM that dies, a page geometry the sampler
 * abstains on — and `withMeasuredContrast` deliberately never refuses over it.
 *
 * So `summarise` cannot claim it, and `withContrast` adds it when the pass
 * actually produced a reading. The bug this closes: `scope` was the whole
 * constant unconditionally, so a delivery whose contrast stage failed told the
 * client "Checked here: WCAG ... 1.4.3 ..." while the `contrast` field beside
 * it was absent and every surface rendered that absence as "not checked". The
 * inspect-only path never runs contrast at all and claimed it on every reading.
 *
 * This is the same overstatement `checker: 'none'` and the optional `contrast`
 * field already exist to prevent, reintroduced through the field that was added
 * to state the instrument's limits.
 */
const MEASURED_BY_A_SEPARATE_STAGE = '1.4.3';

/** `CHECKED_CRITERIA` order, kept canonical however a scope was assembled. */
function scopeOf(claimed: ReadonlySet<string>): { criteria: string[] } {
  return { criteria: CHECKED_CRITERIA.filter((criterion) => claimed.has(criterion)) };
}

export const NOT_CHECKED_CRITERIA: ReadonlyArray<{ number: string; name: string }> = [
  // 1.4.3 moved to CHECKED when `Contrast` graduated. 1.4.1 did NOT move with
  // it and must not be assumed to have: the same fee schedule that fails
  // contrast sets changed values in red, which is meaning carried by colour
  // alone, and nothing here detects that.
  { number: '1.4.1', name: 'Use of Color' },
  // Measured the same way and refused for a sharper reason: a page-monotonicity
  // check over the structure tree has ZERO true positives on the 23 real
  // documents. Reading order follows the STORY, not the page, so a correctly
  // tagged magazine looks broken to it — and the exemptions needed to quiet
  // that would silently pass over a real defect at a section boundary.
  { number: '1.3.2', name: 'Meaningful Sequence' },
  // Measured third, and refused for a DIFFERENT reason from the other two,
  // which is worth keeping straight because it changes what would reopen it.
  //
  // A heading that is a sentence is a real barrier — one corpus document
  // carries 49 of them, the longest 77 words, because its author outline-
  // levelled body paragraphs. The signal is clean: the share of a document's
  // headings that end in sentence punctuation, one comparison, no exemptions.
  // At >= 30% it fires on exactly that document and nothing else, with no
  // false positives anywhere in 118 delivered documents.
  //
  // It is refused because it fires ONCE. 1.4.1 was refused for imprecision (17
  // documents to be right about 4) and 1.3.2 for being wrong (zero true
  // positives); this one is refused for insufficient evidence. One document
  // cannot distinguish a rule that works from a rule fitted to the document it
  // was written against — and it was written knowing what that document looked
  // like. Shipping it would claim we check something seen to work once.
  //
  // The threshold is measured and waiting in
  // `experiments/document-remediation/prose-headings.mjs`. Two more documents
  // above 30% in a later corpus and the registered criteria are met.
  // See `docs/research/document-remediation/prose-headings-feasibility.md`.
  { number: '2.4.6', name: 'Headings and Labels' },
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
/**
 * 11 — the punch list gained form-field names. `Inspect` counts widget
 * annotations and how many carry no accessible name, and `4.1.2 Name, Role,
 * Value` moves out of `NOT_CHECKED_CRITERIA` into what we claim to check.
 *
 * The defect this closes is a SILENT one, which is why it is worth the bump on
 * a criterion only one corpus document raises. veraPDF fails 7.18.1-3 — "a form
 * field shall have a TU key present" — and `alreadyVoiced` routed the whole
 * `7.18` family to the 1.3.1 annotation-nesting item. On the corpus's one real
 * form that item is present, so it suppressed 7.18.1-3, and the clause appeared
 * in no gap, no need and no catch-all.
 *
 * `[V]` r13 delivered with 135 form fields carrying no accessible name and a
 * punch list that named none of them, while the same summary told the client
 * 4.1.2 was not checked. Three independent readings agree on 135: veraPDF's
 * 7.18.1-3, a raw-object scan, and this pass.
 *
 * Same bump reasoning as 10: without it every stored baseline reads `4.1.2` as
 * a new gap the client's document just grew.
 */
/**
 * 12 — the punch list gained the repair blocker (`repair`), and every item
 * gained an identity (`asks`). A signed, encrypted or untagged PDF used to be
 * refused at the moment somebody clicked Repair and recorded nowhere; it is
 * now an item on the inspection's own reading, addressed to the client who
 * holds the source. New vocabulary, so stored baselines read `incomparable`
 * once rather than reporting our change as the client's document changing.
 */
export const INSTRUMENT_VERSION = 12;

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

  // One `4.1.2:` gap string, because `documentGapKey` identifies a gap by the
  // criterion before its colon and a second would collide with this one.
  if (structure.formFieldsWithoutName > 0) {
    const n = structure.formFieldsWithoutName;
    gaps.push(
      `4.1.2: ${n} form field${n === 1 ? '' : 's'} with no accessible name`,
    );
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
    //
    // Everything this function's own two emitters can decide, and nothing else:
    // `1.4.3` joins only in `withContrast`, when the pass that measures it ran.
    scope: scopeOf(new Set(CHECKED_CRITERIA.filter((c) => c !== MEASURED_BY_A_SEPARATE_STAGE))),
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
function needsIn(provenance: ConversionProvenance): Pick<RemediationSummary, 'needs' | 'asks'> {
  const { structure } = provenance;
  const out: Punch = { needs: [], asks: [] };
  const client = (id: string, kind: Ask['kind'], criterion: string): Ask => ({
    id, kind, criterion, answerable: 'client',
  });

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
    punch(out, { id: 'language', kind: 'language', criterion: '3.1.1', answerable: 'operator' },
      'The document declares no language — name the one it is written in, because a language is never guessed',
    );
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
    punch(out, client('annotations', 'annotations', '1.3.1'),
      `${n} form field${n === 1 ? '' : 's'} or link${n === 1 ? '' : 's'} sit outside the document's structure — a screen reader cannot reach ${n === 1 ? 'it' : 'them'} in reading order, and tagging ${n === 1 ? 'it' : 'them'} into place is a person's decision`,
    );
  }

  if (structure.formFieldsWithoutName > 0) {
    // Named, never written. A field's label is what the field is FOR, and
    // inferring it from a nearby word is the same invention refused for alt
    // text — worse here, because a wrong label on a form is a barrier that
    // looks like a fix.
    //
    // Distinct from the 1.3.1 annotation item above even when both fire on the
    // same widgets: that one says a reader cannot REACH the field, this one
    // that the reader does not learn what it is for. Answering one leaves the
    // other standing.
    const n = structure.formFieldsWithoutName;
    const of = structure.formFields > n ? ` of ${structure.formFields}` : '';
    punch(out, client('form-fields', 'form-fields', '4.1.2'),
      // Self-contained: the public report renders items without their criterion
      // label, and says what the name has to be rather than only that it is
      // missing, because the commonest wrong fix is to treat the internal field
      // name as one.
      `${n}${of} form field${n === 1 ? '' : 's'} ${n === 1 ? 'has' : 'have'} no accessible name — label each with what it asks for, because a screen reader speaks the label and never the internal field name`,
    );
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
    punch(out, client('attachments', 'attachments', 'PDF/UA 7.11'),
      `${n} document${n === 1 ? ' is' : 's are'} attached to this file and ${n === 1 ? 'was' : 'were'} not examined — nothing here reads inside an attachment, so ${n === 1 ? 'it needs' : 'each needs'} remediating on its own`,
    );
  }

  // These two items are deliberately TERSE, and that is a transport constraint
  // rather than a style choice. The summary travels in the
  // `x-remediation-summary` response header, one item per undescribed figure,
  // and a real municipal document in the blind corpus carries 101 of them. At
  // the original wording that header reached 22,743 bytes and every client on
  // Node's 16KB default rejected the whole response with "Headers Overflow
  // Error" — the client got no punch list at all, which is worse than a blunt
  // one.
  //
  // `boundSummary` now bounds the header, so overrunning no longer breaks the
  // delivery — it trims items off the end instead, which is still a client
  // losing work they were owed. That is why the page is `(p5)` and why this
  // wording lost the words it could spare: r05 sits ~283 bytes under the budget
  // WITH the page, and would be over it with `(page 5)`.
  // The item never quotes the description it is refusing. One of the strings
  // this rule catches in the wild is a UNC path naming a private host and an
  // internal directory tree; echoing it here would publish that on the client's
  // own report page, which is the exact thing the counts-and-outcomes rule at
  // the top of this file exists to prevent. What the item says is WHY, by
  // shape — never the string itself.
  structure.figures.forEach((figure, index) => {
    // The ordinal alone is a position in `structure.figures`, which nobody can
    // find without counting tags. The page is what makes the item actionable —
    // and `(p5)` rather than `(page 5)` because those four bytes, times a
    // document with 101 undescribed figures, are the difference between fitting
    // the header budget and having items trimmed off the end of the list.
    //
    // `figure.type` rather than a literal "Figure": `Inspect` collects `Formula`
    // into the same array, and once an item names a page a client can go there
    // and find no figure.
    const where = figure.page === null ? '' : ` (p${figure.page})`;
    const at = `${figure.type} ${index + 1}${where}`;
    const prior = figurePrior(figure.alt);
    if (prior === null) return;
    const ask: Ask = {
      id: `figure:${index}`,
      kind: 'figure',
      criterion: '1.1.1',
      answerable: 'operator',
      target: { ordinal: index, type: figure.type, page: figure.page, prior },
    };
    if (prior === 'absent') {
      punch(out, ask, `${at}: no alt text, no caption to transcribe — write a description`);
    } else if (prior === 'decorative') {
      // Tested BEFORE the placeholder branch, because it is a subset of it.
      // Same criterion, same one-item-per-figure, so no count moves anywhere —
      // only the instruction, which was wrong. "Write a description" for an
      // image the source itself calls decorative asks for work the author
      // already said was unnecessary. Both readings of that word are served:
      // if it is decorative, the mechanism is the artifact, and if the word
      // was stamped on in bulk to clear a checker, a person still looks.
      //
      // `[V]` Three bytes SHORTER than the item it replaces. Measured on the
      // worst real document, with `asciiJson` — the function that actually
      // bounds the header — rather than a reimplementation of it: 101 items,
      // 13,382 -> 13,079, so headroom goes 618 -> 921. Correcting an
      // instruction is not a licence to spend the budget; see the
      // header-budget note above.
      punch(out, ask, `${at}: described only as decorative (F30) — artifact it, or describe it`);
    } else {
      punch(out, ask, `${at}: alt text is a placeholder, not a description (WCAG F30) — write one`);
    }
  });

  let previous = 0;
  structure.headings.forEach((heading, index) => {
    const level = Number(/^H(\d)/.exec(heading)?.[1] ?? NaN);
    if (!Number.isFinite(level)) return;
    // Keyed by the index in the ladder rather than the levels: two skips of
    // the same shape in one document must not collide.
    const ask: Ask = {
      id: `heading:${index}`,
      kind: 'heading',
      criterion: '2.4.10',
      answerable: 'operator',
      target: { index, from: previous, to: level },
    };
    if (previous === 0 && level > 1) {
      // The first heading is already deep. Not a skip *between* headings,
      // but the same authorship decision — starting at H1 is theirs to
      // make, not ours to renumber.
      punch(out, ask, `Heading levels start at H${level} — decide whether the document should begin at an H1`);
    } else if (previous > 0 && level > previous + 1) {
      punch(out, ask, `Heading levels skip from H${previous} to H${level} — decide whether the author meant an H${previous + 1}`);
    }
    previous = level;
  });

  return out.needs.length > 0 ? { needs: out.needs, asks: out.asks } : {};
}

/**
 * The same summary with the document's words removed.
 *
 * For logs. The title and the excerpt are the two fields that carry document
 * content; the asks go too, because they only repeat the punch list's shape
 * and would double the size of every line.
 */
export function logSafe(
  summary: RemediationSummary,
): Omit<RemediationSummary, 'titleText' | 'excerpt' | 'asks'> {
  const { titleText: _title, excerpt: _excerpt, asks: _asks, ...rest } = summary;
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
 * One reading of an `/Alt` string, shared by every predicate that judges one.
 *
 * Extracted so the two cannot disagree. Both normalisations are provenance
 * rather than cosmetics: a TRAILING NUL is a producer's string terminator
 * (without stripping it, three legitimate descriptions in the blind corpus read
 * as illegible, one of them on the only conformant real PDF), and a leading
 * "Description:" is an exporter prefix in the shape `PRODUCER_STAMP` already
 * refuses on titles.
 */
function normalisedAlt(alt: string): string {
  return alt
    // Bounded before any pattern runs: the string comes from an untrusted
    // document and must not set the amount of work.
    .slice(0, 500)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+$/, '')
    .replace(/^description:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Did the author say this graphic carries nothing, rather than leave the field
 * to an exporter?
 *
 * A SUBSET of `isPlaceholderAlt`, never a competitor to it: "Decorative" is not
 * a description, and F30 is right to refuse it. What this separates is what the
 * client should DO about it. Telling someone to write a description for an
 * image their own source calls decorative is the wrong instruction; the
 * mechanism they want is the decorative control, which artifacts the image.
 *
 * ONE word, and the other two were refused on evidence. The registered rule
 * admitted `spacer` and `blank` only if they appeared alongside `decorative` in
 * the same document — one author's family of markers rather than two more words
 * describing appearance. `[V]` Across every delivered real document, `spacer`
 * and `blank` occur ZERO times; `decorative` occurs 153 times. Widening this
 * set later needs the same evidence, not the same intuition.
 *
 * This changes what an item SAYS and never whether it exists. Nothing here
 * artifacts anything: acting on the word would be a structural write that
 * `contentChanges` refuses, and an assertion on a client's bytes made from a
 * single word. `[V]` The two documents carrying all 153 use ONE distinct string
 * each, so this is a template convention rather than 52 and 101 separate
 * judgements — which is exactly why the item stays and only its advice moves.
 */
export function isDeclaredDecorative(alt: string): boolean {
  return normalisedAlt(alt).toLowerCase() === 'decorative';
}

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
 * Two normalisations run before any pattern does, and they live in
 * `normalisedAlt` so `isDeclaredDecorative` reads the same string this does.
 * Both are provenance rather than cosmetics; the reasoning is stated there
 * once rather than in two comments that can drift apart.
 *
 * Deliberately NOT copied from `isPlaceholderTitle`: its `length < 3` refusal.
 * A legitimate CJK description can be two characters, and short is not the same
 * as absent.
 */
export function isPlaceholderAlt(alt: string): boolean {
  const cleaned = normalisedAlt(alt);

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
