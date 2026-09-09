import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One word for the screen that lists clients.
 *
 * It was "Portfolio" — on the tab, the heading, the logo's accessible name and
 * two back links. The word is agency jargon for a book of accounts, and the
 * screen is a list of clients, so it now says Clients everywhere a person can
 * perceive it.
 *
 * **A rename is complete or it is not attempted**, which is the whole reason
 * this file exists. A tab reading "Clients" above a heading reading "Portfolio"
 * is worse than either word used consistently: it reads as two places. The
 * check is a grep over what is rendered, because nothing else can hold a
 * rename in place — the compiler is indifferent to the contents of a string.
 *
 * **The code keeps the old name on purpose, and that is a seam rather than an
 * oversight.** `services/portfolio.ts`, `PortfolioRow`, `buildPortfolio`,
 * `PortfolioScreen` and the `'portfolio'` member of `WorkspaceScreen` are
 * unchanged, along with the comments sitting beside them, so every one of
 * those still describes the code it names accurately. What a person reads is a
 * product word; what a module is called is the code's own. The guard below
 * matches `Portfolio` only on a word boundary, so identifiers pass and a
 * rendered label cannot.
 */

const ROOTS = [join('src', 'app'), join('src', 'services', 'presentation')];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) out.push(path);
  }
  return out;
}

/**
 * What is left after removing everything that is allowed to say the old word.
 *
 * Three removals, each for a different reason.
 *
 * **Comments**, for the reason `capability-banner-copy.test.ts` records: a
 * comment explaining what the old word was reads to a plain grep as the old
 * word still being there, and this repo's comments do explain such things.
 *
 * **Module paths**, because the files are still named for the code —
 * `services/portfolio`, `portfolio-route` — and an import is not copy.
 *
 * **The sentinel literal `'portfolio'`**, which is the code's name for the
 * root screen (`WorkspaceScreen`). Removing exactly that spelling, rather
 * than matching case, is what lets the check below be case-INSENSITIVE — and
 * that matters more than it looks. The first version of this guard matched
 * `/\bPortfolio\b/`, and the one lowercase person-perceivable occurrence in
 * the change that introduced it — "a portfolio of client sites", the page
 * description a browser tab and a search snippet show — sat inside these
 * roots and passed. A person caught it. Sentence-case prose is where jargon
 * comes back: a lede, a toast, an empty state, an `aria-label`.
 */
function strippedOfWhatMayKeepTheWord(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/from\s+'[^']*'/g, '')
    .replace(/import\([^)]*\)/g, '')
    .replace(/'portfolio'/g, '');
}

describe('the screen that lists clients', () => {
  const files = ROOTS.flatMap(sourceFiles).map((file) => ({
    file,
    source: strippedOfWhatMayKeepTheWord(readFileSync(file, 'utf8')),
  }));

  it('is looked at by this test at all', () => {
    // Non-vacuity, the shape `document-verdict-copy.test.ts` established: a
    // negative assertion over a walker that found nothing passes loudly.
    expect(files.length).toBeGreaterThan(40);
  });

  it('never renders the old word, in any case', () => {
    // Word-boundary, so `PortfolioRow` and `buildPortfolio` — the code's own
    // name for this screen, deliberately unchanged — do not trip it, while
    // `title="Portfolio"` and `← Portfolio` do.
    //
    // Case-insensitive, because the occurrence this guard failed to catch on
    // its first outing was lowercase and mid-sentence. Everything entitled to
    // keep the word has been removed above, so what reaches here is copy.
    for (const { file, source } of files) {
      expect(source, `${file} still renders the old name`).not.toMatch(/\bportfolio\b/i);
    }
  });

  it('says Clients on the tab, the heading and the way back', () => {
    // The implication half. Without it the negative above is satisfied by
    // deleting the label rather than renaming it.
    const rendered = files.map(({ source }) => source).join('\n');

    expect(rendered).toContain("'Clients'");
    expect(rendered).toContain('title="Clients"');
    expect(rendered).toContain('← Clients');
  });
});
