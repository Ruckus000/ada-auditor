import { z } from 'zod';

import { figurePrior } from './document-remediation';
import { languageTagSchema, languageToCarry, type DocumentStructure } from './document-structure';

/**
 * What a person may say about a document, and how what they said becomes the
 * exact structure the pipeline is then allowed to produce.
 *
 * The product's charter is that nothing is ever invented: a PDF is repaired by
 * transcription or refused, and a fact the document does not state is a
 * punch-list item. This module is the channel through which a punch-list item
 * gets its answer — from a named person, attributed and keyed to the bytes it
 * was given for — so that writing the answer into the file is transcription
 * of what THEY said, never inference of what the document might mean.
 *
 * Lives in `domain` because three layers speak it and none may import the
 * others: the summary that emits asks, the route that accepts answers, and the
 * pipeline that applies them.
 */

/** The shapes of question the punch list can raise. */
export type AskKind =
  | 'language'
  | 'figure'
  | 'heading'
  | 'annotations'
  | 'form-fields'
  | 'attachments'
  | 'contrast'
  | 'fonts'
  | 'untagged'
  | 'identifier'
  | 'pdfua'
  | 'repair';

/**
 * What a figure's description looked like when the ask was raised — the
 * preimage a later declaration is checked against, so an answer given for "a
 * figure with no alt" is never written over a description the author since
 * supplied.
 */
export type FigurePrior = 'absent' | 'decorative' | 'placeholder';

export type AskTarget =
  | {
      ordinal: number;
      type: string;
      page: number | null;
      prior: FigurePrior;
      /**
       * What the figure draws, when the reading could say. Repeats of one
       * image — a logo on every page — share it, so the workbench can ask
       * for one description and land it on every repeat; and it is the
       * tightest preimage a declaration is checked against.
       */
      imageDigest?: string;
    }
  | { index: number; from: number; to: number };

/**
 * One punch item's identity.
 *
 * `id` is stable for the same bytes: the figure's ordinal in the structure
 * walk, the heading's index in the ladder, or simply the kind for the
 * singletons. `criterion` repeats the punch item's, so a reader can check the
 * two arrays line up. `target` exists only where a re-run needs it — the id
 * already says everything about `fonts:not-embedded` or `repair:signed`.
 */
export type Ask = {
  id: string;
  kind: AskKind;
  criterion: string;
  /**
   * Who can close it. An operator answers a description or a language; only
   * the client can supply a Word source or re-sign a document; and the
   * identifier item is the one that is not work at all.
   */
  answerable: 'operator' | 'client' | 'none';
  target?: AskTarget;
};

/**
 * What a person said, in three shapes that must never be confused: a value to
 * WRITE into the file, a judgement that changes no bytes, or something asked
 * of the client. Reporting a `decided` item as progress toward conformance is
 * the silent gap this vocabulary exists to prevent.
 */
export type AnswerDisposition = 'declared' | 'decided' | 'requested';

/** Which dispositions each kind of ask accepts. Total over `AskKind` by construction. */
export const ACCEPTS: Record<AskKind, ReadonlyArray<AnswerDisposition>> = {
  language: ['declared'],
  // A description is written; "decorative" is a decision recorded and NOT
  // applied, because artifacting is a structural delete this pipeline does
  // not perform, and an empty `/Alt` is not the treatment (it passes the
  // checker while saying nothing — the r34 shape).
  figure: ['declared', 'decided'],
  heading: ['declared', 'decided'],
  contrast: ['decided', 'requested'],
  pdfua: ['decided', 'requested'],
  annotations: ['requested', 'decided'],
  'form-fields': ['requested', 'decided'],
  attachments: ['requested', 'decided'],
  fonts: ['requested', 'decided'],
  untagged: ['requested', 'decided'],
  repair: ['requested', 'decided'],
  identifier: [],
};

/**
 * Open figure asks, repeats of one image together.
 *
 * Page furniture — a logo on every page — is one image drawn many times, and
 * `[V]` accounted for 25 of the 35 figures shared across the blind corpus's
 * documents. A group is answered once and saved as one row per member: one
 * act, N attributed claims. Figures whose image the reading could not
 * identify are never grouped, because a guess about sameness is a guess.
 * Within one document only — cross-document reuse was measured under 3 % and
 * declined.
 */
export function figureGroups(asks: ReadonlyArray<Ask>): Ask[][] {
  const groups: Ask[][] = [];
  const byDigest = new Map<string, Ask[]>();
  for (const ask of asks) {
    const digest = ask.target && 'ordinal' in ask.target ? ask.target.imageDigest : undefined;
    if (digest === undefined) {
      groups.push([ask]);
      continue;
    }
    const held = byDigest.get(digest);
    if (held) {
      held.push(ask);
    } else {
      const group = [ask];
      byDigest.set(digest, group);
      groups.push(group);
    }
  }
  return groups;
}

/**
 * The most a description may be. Screen readers announce alt text in one
 * breath; a thousand characters is already a paragraph. Exported so the form
 * can share the limit without importing anything heavier, the way
 * `MAX_TRIAGE_NOTE` is.
 */
export const MAX_ANSWER_TEXT = 1000;

/**
 * Operator-typed text, made safe for a file and a screen.
 *
 * NFC so two spellings of the same word compare equal; control characters
 * out, except the newline a description may legitimately carry; runs of
 * spaces collapsed; bounded. A trust-boundary step, not a style one: the
 * result is written into a delivered PDF and rendered in the console.
 */
export function cleanOperatorText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, MAX_ANSWER_TEXT);
}

const figurePriorSchema = z.enum(['absent', 'decorative', 'placeholder']);

/**
 * The answers a run consumes, keyed to the bytes they were given for.
 *
 * A description must be at least one character: an empty string is the
 * decorative decision wearing a value's clothes, and that decision is
 * `decided`, never written.
 */
export const declaredAnswersSchema = z
  .object({
    inputSha256: z.string().regex(/^[0-9a-f]{64}$/),
    language: languageTagSchema.optional(),
    figures: z
      .array(
        z
          .object({
            ordinal: z.number().int().nonnegative(),
            type: z.string().min(1),
            page: z.number().int().positive().nullable(),
            prior: figurePriorSchema,
            imageDigest: z.string().optional(),
            alt: z.string().min(1).max(MAX_ANSWER_TEXT),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

export type DeclaredAnswers = z.infer<typeof declaredAnswersSchema>;

/**
 * The structure a run is allowed to produce, given what a person declared.
 *
 * The fidelity gate is `contentChanges(applyDeclarations(before, answers),
 * after) === []`: the pipeline may change exactly the declared deltas and
 * nothing else. So this function sets `figures[i].alt` on the named ordinal
 * and the catalog language where none was usable, and touches nothing else.
 *
 * Every target is checked against the reading it was raised from — type, page
 * and the SHAPE of the description that was there. A mismatch refuses the
 * whole set: a wrong-figure write must be impossible, and a partial apply
 * would leave the caller unable to say which answers landed. The mismatch
 * list names ask ids, never the text, because it is logged.
 */
export function applyDeclarations(
  before: DocumentStructure,
  answers: DeclaredAnswers,
): { ok: true; structure: DocumentStructure } | { ok: false; mismatches: string[] } {
  const structure: DocumentStructure = {
    ...before,
    figures: before.figures.map((figure) => ({ ...figure })),
    order: before.order.map((entry) => ({ ...entry })),
  };
  const mismatches: string[] = [];

  // `Inspect` reports a figure's reading-order text through `StructText.of`
  // — ActualText, then Alt, then glyphs, cut at 90 characters — and it lists
  // figures and reading order from one walk, so the k-th Figure|Formula
  // entry of `order` IS `figures[k]`. A declared description therefore moves
  // BOTH fields, and the expected structure has to say so or the gate would
  // refuse every declaration for moving `order`.
  const orderIndexOfFigure = before.order.flatMap((entry, i) =>
    entry.type === 'Figure' || entry.type === 'Formula' ? [i] : [],
  );

  if (answers.language !== undefined) {
    // Only where the document declares nothing usable. A declared language is
    // a transcription of what a person said about a document that says
    // nothing; it is never a correction of what the document says.
    if (languageToCarry(before.lang) !== null) mismatches.push('language');
    else structure.lang = answers.language;
  }

  for (const declared of answers.figures) {
    const figure = structure.figures[declared.ordinal];
    // Both digests known and different means the figure draws a different
    // picture than the one that was described. Either side unknown — a
    // reading or an answer from before the field — is checked on the rest.
    const sameImage =
      declared.imageDigest === undefined ||
      figure?.imageDigest === undefined ||
      figure.imageDigest === null ||
      figure.imageDigest === declared.imageDigest;
    const matches =
      figure !== undefined &&
      figure.type === declared.type &&
      figure.page === declared.page &&
      figurePrior(figure.alt) === declared.prior &&
      sameImage;
    if (!matches) {
      mismatches.push(`figure:${declared.ordinal}`);
      continue;
    }
    figure.alt = declared.alt;
    const at = orderIndexOfFigure[declared.ordinal];
    if (figure.actualText === null && at !== undefined) {
      structure.order[at] = { ...structure.order[at], text: declared.alt.trim().slice(0, 90) };
    }
  }

  return mismatches.length === 0 ? { ok: true, structure } : { ok: false, mismatches };
}
