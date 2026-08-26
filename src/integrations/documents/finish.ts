import { languageTagSchema } from '../../domain/document-structure';
import { runWritingStage, type StageOptions, type StageOutcome } from './stage';

/**
 * Writes the four document-catalog keys PDF/UA requires, and nothing else.
 *
 * The first stage to graduate that **produces a file**, which is a different
 * class of risk from `Inspect` and the reason it was chosen over the others.
 * Every remaining repair stage either deletes semantics (`Headings` demotes,
 * `Lists` removes invalid structure) or invents them (`Tables` promotes cells
 * to headers). `Finish` does neither: it sets `MarkInfo/Marked`, `/Lang`,
 * `ViewerPreferences/DisplayDocTitle` and the XMP packet, and its own header
 * states that no structure element is created, moved, re-parented or altered.
 *
 * That claim is checkable, and `contentChanges` in
 * `domain/document-structure.ts` is what checks it.
 *
 * ## The language is required, and there is no default
 *
 * This is the single most important line in the file. `/Lang` is a claim
 * written into bytes somebody receives, so defaulting it to `en` would mean
 * every Welsh, Spanish or bilingual document quietly acquires a false statement
 * about itself — an *assertion*, in this project's terms: wrong, delivered, and
 * invisible to the reader. Worse than the omission it replaced.
 *
 * The Java takes the tag as a required argument for exactly this reason
 * ("writing /Lang is deterministic; deciding what it should say is inference"),
 * and this wrapper does not soften that. A caller with no answer must not call
 * this stage. The tag is also shape-checked, because `english` and `EN_US`
 * produce a file that validates and lies.
 *
 * ## The title is copied, never invented
 *
 * `Finish` reads the title from DocInfo and omits it when absent. A document
 * with no title stays untitled and fails 7.1-9 visibly, which is the honest
 * outcome — inventing one from the first line of body text is the same mistake
 * as guessing at alt text.
 */
export type FinishRequest = {
  inputPath: string;
  outputPath: string;
  /**
   * BCP-47, supplied by whoever knows. Never inferred, never defaulted — see
   * the note above.
   */
  language: string;
};

export type FinishOutcome =
  | StageOutcome
  /** The caller's language tag was not a language tag. Nothing was written. */
  | { ok: false; failure: { kind: 'invalid-language'; detail: string } };

export async function finishDocument(
  request: FinishRequest,
  options: StageOptions = {},
): Promise<FinishOutcome> {
  const language = languageTagSchema.safeParse(request.language);
  if (!language.success) {
    // Refused before the JVM starts. A bad tag is a caller bug, and the cost of
    // letting it through is a delivered document that states the wrong natural
    // language while passing every machine check there is.
    return {
      ok: false,
      failure: {
        kind: 'invalid-language',
        detail: `${JSON.stringify(request.language)} is not a language tag: ${language.error.issues[0]?.message ?? 'invalid'}`,
      },
    };
  }

  return runWritingStage(
    'Finish',
    [request.inputPath, request.outputPath, language.data],
    options,
  );
}
