import { rm, writeFile } from 'node:fs/promises';

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
 * states that no structure element is created, moved, re-parented or altered
 * — with the single standing-policy exception of `renumberHeadings` below,
 * which only the conversion lane may invoke.
 *
 * That claim is checkable, and `contentChanges` in
 * `domain/document-structure.ts` is what checks it — which is also why the
 * repair lane, which runs behind that gate, can never pass the flag: a
 * renumbered ladder moves the `headings` content field, and the gate refuses
 * the file. The conversion lane has no before-PDF to compare against; its
 * discipline is this type and the tests on it.
 *
 * ## The language is required, and there is no default
 *
 * This is the single most important line in the file. `/Lang` is a claim
 * written into bytes somebody receives, so defaulting it to `en` would mean
 * every Welsh, Spanish or bilingual document quietly acquires a false statement
 * about itself — an *assertion*, in this project's terms: wrong, delivered, and
 * invisible to the reader. Worse than the omission it replaced.
 *
 * The Java takes the tag as an argument for exactly this reason ("writing
 * /Lang is deterministic; deciding what it should say is inference"), and this
 * wrapper does not soften it. The tag is shape-checked, because `english` and
 * `EN_US` produce a file that validates and lies.
 *
 * `language: null` is a *decision*, not an omission: it means the source
 * declares no language, and it **removes** any claim the file carries. That is
 * needed because `[V]` LibreOffice writes `en-US` onto documents exported from
 * a source with every language declaration stripped, and widens a declared `en`
 * to `en-US`. Carrying that forward would make our own toolchain the thing
 * asserting a language nobody chose. The field is required rather than
 * optional so that "no answer" has to be typed out and cannot be reached by
 * forgetting.
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
   * A title to write, when the caller has a TRANSCRIBED one the document does
   * not carry in DocInfo — its own first heading, or the name its author
   * saved it under. Omitted, the stage copies DocInfo and invents nothing,
   * which is what conversion has always wanted.
   *
   * The policy that chooses this lives in `services/document-repair.ts`. This
   * type deliberately cannot express "make one up": the caller supplies text
   * that already exists somewhere, or supplies nothing.
   */
  title?: string;
  /**
   * BCP-47 as the source declares it, or `null` when the source declares none.
   *
   * Never inferred and never defaulted. `null` removes any language claim in
   * the file, which fails 7.2-34 visibly — an omission a reviewer can see,
   * rather than an assertion no reader can.
   */
  language: string | null;
  /**
   * Whether the delivered file may ASSERT PDF/UA-1 conformance in its own XMP.
   *
   * `pdfuaid:part` is how conformance is machine-detected, so writing it is a
   * claim rather than a piece of metadata — and this stage cannot know whether
   * the claim is true, because the checker runs after it. The caller decides,
   * once it holds a verdict for the bytes it is about to deliver.
   *
   * Defaults to true so existing callers are unchanged; the conversion path
   * passes `false` and then earns it back.
   */
  claimUa1?: boolean;
  /**
   * Re-rank heading levels onto a gapless ladder starting at H1 — the
   * standing policy for PDF/UA 7.4.2, and the ONE structural write Finish is
   * allowed.
   *
   * Only the conversion lane may pass this: there the levels are an
   * exporter's mapping of the author's outline. The repair lane never does —
   * renumbering a client's own PDF is guessing a heading level, which
   * `document-repair.ts`'s charter forbids. Defaults to false, so a caller
   * that says nothing changes nothing.
   */
  renumberHeadings?: boolean;
};

export type FinishOutcome =
  | StageOutcome
  /** The caller's language tag was not a language tag. Nothing was written. */
  | { ok: false; failure: { kind: 'invalid-language'; detail: string } };

export async function finishDocument(
  request: FinishRequest,
  options: StageOptions = {},
): Promise<FinishOutcome> {
  // The title travels in a file, never on the command line: it is document
  // content, and a process argument list is readable by anything else on the
  // machine. Written beside the document it describes, in a directory the
  // caller already cleans up.
  let titleArgs: string[] = [];
  let titleFile: string | null = null;
  if (request.title !== undefined && request.title !== '') {
    titleFile = `${request.outputPath}.title`;
    await writeFile(titleFile, request.title, 'utf8');
    titleArgs = ['--title-file', titleFile];
  }

  const cleanup = async () => {
    if (titleFile !== null) await rm(titleFile, { force: true });
  };

  // Absence means "claim it", matching the stage's own default, so no existing
  // caller changes behaviour by not knowing about this.
  const uaArgs = request.claimUa1 === false ? ['--no-ua-identifier'] : [];

  // Off unless asked, matching the stage's own default — and only the
  // conversion path asks. See the field's comment for why.
  const renumberArgs = request.renumberHeadings === true ? ['--renumber-headings'] : [];

  // Omitting the argument is what tells the stage to remove the claim; three
  // arguments set one. There is no sentinel string, because a sentinel is a
  // value somebody eventually passes by accident.
  if (request.language === null) {
    try {
      return await runWritingStage(
        'Finish',
        [request.inputPath, request.outputPath, ...titleArgs, ...uaArgs, ...renumberArgs],
        options,
      );
    } finally {
      await cleanup();
    }
  }

  const language = languageTagSchema.safeParse(request.language);
  if (!language.success) {
    await cleanup();
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

  try {
    return await runWritingStage(
      'Finish',
      [request.inputPath, request.outputPath, language.data, ...titleArgs, ...uaArgs, ...renumberArgs],
      options,
    );
  } finally {
    await cleanup();
  }
}
