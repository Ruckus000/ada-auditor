import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The sentence a client's document screen shows when this host cannot convert.
 *
 * It said "Inspection reads PDFs", and its own probe cannot answer that.
 * `GET /api/documents/remediate` returns `available: true` only when
 * LibreOffice **and** a Java runtime both resolve, so `available: false` means
 * "one of the two is missing" and this screen cannot tell which. Where the
 * missing half is the Java runtime — `dist/documents/classes` is gitignored
 * and nothing rebuilds it — the banner promised an inspection that answers
 * `document_toolchain_unavailable` on the first click.
 *
 * **Not "on every deployment", which a first version of this said.**
 * `vercel-build` runs `prepare-jvm.ts` and `prepare-libreoffice.ts`, and
 * `next.config.mjs` traces both into `/api/documents/remediate/**`, so a
 * current deployment answers `available: true` and never renders this banner
 * at all; `libreoffice-runtime.ts` retired that exact sentence under "The
 * deployed runtime is no longer absent". Getting that wrong in a change about
 * unsupported claims is the joke telling itself, and it is written here so the
 * next reader does not inherit it.
 *
 * For the same reason the sentence attributes nothing. Saying the host "does
 * not have" LibreOffice, or "cannot run it", names one half from a flag that
 * measures the pair — and on a host with LibreOffice installed and the stages
 * uncompiled it sends someone to reinstall software they already have. The
 * screen that does know is Settings, which reports the two halves separately.
 *
 * **Read from the source, not from a render, and that is a limitation stated
 * rather than hidden.** The banner is behind two pieces of state this screen
 * fetches in an effect, so a server render reaches none of it; the fast suite
 * is node-only (`vitest.config.ts`), so there is no DOM to run the effect in;
 * and the hydration suite drives a real browser on a machine that has both
 * halves installed, where the banner correctly never appears. Adding a DOM
 * runtime for one sentence buys less than it costs. This is the same
 * grep-the-source shape `document-verdict-copy.test.ts` and `score-copy.test.ts`
 * use, and it is a negative assertion for the reason that file records: written
 * as an implication it would have no antecedent left to match.
 */

const SCREEN = 'src/app/platform/components/client/client-documents.tsx';

/**
 * The file with its comments removed.
 *
 * This matters more than it looks. The comment beside the banner quotes the
 * sentence that was wrong — which is how this repo records a defect, and which
 * a plain grep reads as the defect still being present. The guard is about
 * what a person sees on the screen, so the commentary about it is not part of
 * what is measured. Both JSX comment blocks and line comments go; the
 * assertions below are on rendered text.
 */
function withoutComments(source: string): string {
  return source.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the client documents capability banner', () => {
  const source = withoutComments(readFileSync(SCREEN, 'utf8'));

  it('is looked at by this test at all', () => {
    // Non-vacuity. If the banner moves out of this file the negatives below
    // start passing for the wrong reason, and this is what says so.
    expect(source).toContain('Word documents are recorded without a Convert button');
  });

  it('claims nothing about inspection, which its own probe cannot answer', () => {
    expect(source).not.toMatch(/Inspection reads PDFs/i);
    expect(source).not.toMatch(/can still (check|inspect|read) PDFs/i);
  });

  it('does not attribute the failure to one half of a flag that measures both', () => {
    expect(source).not.toMatch(/deployment does not have it/i);
    expect(source).not.toMatch(/has no LibreOffice/i);
    // "…and this host cannot run it" named LibreOffice by its pronoun, which
    // is the same attribution with a different verb.
    expect(source).not.toMatch(/cannot run it/i);
  });

  it('sends the reader to the screen that does know which half is missing', () => {
    // Settings reports the two capabilities separately — "PDF stages only",
    // "converter only", "not available here" — so there is a real next step,
    // and it is not a guess made on this screen.
    expect(source).toMatch(/Settings/);
  });
});
