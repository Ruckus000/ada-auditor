import { isTagged, type DocumentStructure } from '../domain/document-structure';
import { titleFromFilename, type TitleOutcome } from '../domain/document-remediation';

/**
 * What an honest repair of a PDF is allowed to do to it.
 *
 * The product converts Word documents and, until now, only inspected PDFs —
 * every repair entry point is `accept: isWordDocument`. A client's PDF got a
 * diagnosis and never a fix.
 *
 * ## Why this is not the repair the spike ruled out
 *
 * Arm B of the 120-document test repaired PDFs by *inference*: auto-tag from
 * visual layout, then finish. It produced conformance and 62 false assertions
 * across 20 documents, and the STOP it earned still stands. This decides
 * something different — what the document **already states** and may
 * therefore be told back to itself:
 *
 * - a title it carries, displays, or is named
 * - the language it declares, unchanged, or none at all
 * - the destination its own links point at
 *
 * Nothing here reads pixels, guesses a heading level, or orders content. A
 * fact the document does not state is a punch-list item, never a repair.
 *
 * `[V]` Phase 0 measured why this is worth having: across twenty real
 * municipal PDFs the most common UA-1 failures are DisplayDocTitle (14
 * documents), the XMP packet and PDF/UA identifier (13 each), MarkInfo (9),
 * document title (8), and link tab order and descriptions (7 each) — every
 * one a catalog fact, none of them requiring an inference.
 */

/** Why a PDF cannot honestly be repaired, and what to do instead. */
export type RepairRefusal = {
  kind: 'not-tagged' | 'signed';
  /** Operator-facing, and true: what is in the way and what still works. */
  reason: string;
};

export type RepairPlan = {
  /** Where the delivered title comes from, in the vocabulary conversion uses. */
  title: TitleOutcome;
  /**
   * The language the document declares, passed through unchanged.
   *
   * Load-bearing, and the reason this is a field rather than an omission:
   * `Finish` REMOVES the language claim when it is given none. A repair that
   * forgot to pass this back would strip a valid `/Lang` off a client's
   * document — a regression wearing a fix's clothes. `null` here means the
   * document declares none, and none is what it keeps.
   */
  language: string | null;
};

export type RepairDecision =
  | { repairable: true; plan: RepairPlan }
  | { repairable: false; refusal: RepairRefusal };

/**
 * Decide what may be written back to a PDF, from what it already says.
 *
 * `sourceName` is the client-facing filename — the URL's last segment or the
 * upload's name, never the temp path, which is a request id and says nothing.
 */
export function planRepair(
  structure: DocumentStructure,
  sourceName: string | undefined,
): RepairDecision {
  if (structure.signed) {
    // Repair rewrites the document catalog, and that invalidates a signature.
    // An incremental save does not rescue it — incremental updates preserve
    // earlier signatures only for the additive operations DocMDP permits, not
    // for edits — so there is no version of this that keeps both.
    //
    // Refused rather than offered as a trade, because the loss is invisible:
    // the delivered file looks fine and the signature is simply gone. A
    // certified municipal record losing its signature is a worse outcome than
    // the accessibility gap it was repaired for, and the operator cannot see
    // it happen. Converting a paired Word source stays available and produces
    // a NEW document, with no signature to destroy.
    return {
      repairable: false,
      refusal: {
        kind: 'signed',
        reason:
          'this PDF carries a digital signature, and repairing it would invalidate that signature — convert the Word source it was exported from instead, or have the signer re-issue it once it is accessible',
      },
    };
  }

  if (!isTagged(structure)) {
    // The one thing repair cannot supply. Tagging an untagged PDF means
    // inferring reading order and heading levels from layout, which is the
    // measured source of the spike's false assertions. The honest routes are
    // the Word source — which `pairDocuments` already surfaces when the
    // inventory holds one — or a person retagging it.
    return {
      repairable: false,
      refusal: {
        kind: 'not-tagged',
        reason:
          'this PDF has no structure tree, so there is nothing to transcribe — supply the Word source it was exported from, or have it tagged by a person',
      },
    };
  }

  return { repairable: true, plan: { title: titleFor(structure, sourceName), language: structure.lang } };
}

/**
 * The title chain, in the order the product already uses for Word.
 *
 * States it → displays it → is named it → says so honestly. The same
 * `titleFromFilename` policy applies, junk refusals included, because a
 * filename is authored text wherever it appears.
 */
function titleFor(structure: DocumentStructure, sourceName: string | undefined): TitleOutcome {
  const carried = structure.title?.trim();
  if (carried !== undefined && carried !== '') {
    return { kind: 'already-titled', title: carried };
  }

  // The document's own first heading — the same "copy a heading" rule
  // conversion applies, reading the tree instead of the source XML. Phase 0
  // measured this firing exactly once in twenty: tagged municipal PDFs carry
  // almost no heading structure. It stays because when it does fire it is the
  // best answer available, being the document's own words.
  const heading = structure.headingTexts.find((h) => (h.text ?? '').trim() !== '')?.text?.trim();
  if (heading !== undefined && heading !== '') {
    return { kind: 'transcribed', title: heading };
  }

  const derived = sourceName === undefined ? null : titleFromFilename(sourceName);
  if (derived !== null) {
    return { kind: 'filename-derived', title: derived };
  }

  return { kind: 'no-heading-to-copy' };
}
