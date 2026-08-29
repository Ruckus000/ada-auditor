import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The blind test's one structural guarantee, enforced rather than promised.
 *
 * The same person authored the pipeline and the answer keys, so true
 * double-blindness is not available. What IS available is this: the keys are
 * derived by instruments with no stake in the answer — qpdf, unzip, xmllint
 * and the veraPDF CLI — and never by the product's own `Inspect` stage. A key
 * authored by the thing it grades measures only that the product agrees with
 * itself.
 *
 * A rule that lives in a comment is a rule until somebody is in a hurry, so it
 * lives here too.
 */

const CORPUS = join(import.meta.dirname, '..', '..', 'experiments', 'document-remediation', 'blind-corpus');

/** The files that decide what the answers are. */
const KEY_AUTHORING = ['author-real-keys.mjs', 'spec.mjs', 'generate.mjs', 'verify.mjs', 'harvest.mjs'];

describe('the blind corpus authors its keys independently', () => {
  it.each(KEY_AUTHORING)('%s imports nothing from the product', (file) => {
    const source = readFileSync(join(CORPUS, file), 'utf8');
    const imports = [...source.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+'([^']+)'/g)].map((m) => m[1]);

    for (const specifier of imports) {
      // Relative imports inside the corpus directory are the corpus's own
      // builders. Anything reaching further is reaching for `src/`.
      expect(
        specifier.startsWith('node:') || /^\.\/[a-z-]+\.mjs$/.test(specifier),
        `${file} imports ${specifier}`,
      ).toBe(true);
    }
  });

  it.each(KEY_AUTHORING)('%s names no product module even in a dynamic import', (file) => {
    // Comments are stripped first: every one of these files explains the rule
    // in its header, and a check that failed on the prose stating the rule
    // would be unmaintainable and would teach people to delete the prose.
    const code = readFileSync(join(CORPUS, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');

    for (const forbidden of ['src/', 'document-structure', 'inspectDocument']) {
      expect(code.includes(forbidden), `${file} reaches for ${forbidden}`).toBe(false);
    }
  });

  it('every key records which instruments read the document', () => {
    const keys = readdirSync(join(CORPUS, 'keys')).filter((f) => f.endsWith('.key.json'));
    expect(keys.length).toBeGreaterThan(80);

    const real = keys
      .map((f) => JSON.parse(readFileSync(join(CORPUS, 'keys', f), 'utf8')))
      .filter((k) => k.origin === 'real');
    expect(real.length).toBeGreaterThan(0);

    for (const key of real) {
      expect(key.evidence?.instruments, `${key.id} names no instrument`).toBeTruthy();
      // A real document's title is its content, and content does not enter a
      // tracked file. The hash is what makes transcription checkable anyway.
      expect(key.expected.titleText, `${key.id} carries document text`).toBeUndefined();
    }
  });
});
