/**
 * Can a heading that reads as PROSE be detected without judging intent?
 *
 * A township's minutes (n50) declared its whole outline with direct
 * `w:outlineLvl`, on 84 paragraphs of ordinary body text. Our converter carried
 * all 49 non-empty ones faithfully, so the delivered PDF has 49 headings that
 * are sentences. That is a real barrier — a screen-reader user navigating by
 * heading gets the document read to them twice — and it is in the SOURCE, made
 * by the author, not by us.
 *
 * This measures whether we could name it. It builds no detector.
 *
 * ## Decline criteria, registered BEFORE the first run
 *
 * The prior is bad and stated up front: `heading-promotion-options.md` measured
 * six typographic signals for the INVERSE problem (promoting unmarked text to
 * headings), scored 5/6 on one document, promoted an address and a table column
 * header on the next two, and concluded "every one of those signals measures
 * visual prominence. What makes something a heading is semantic." That file
 * ends "Do not build the typographic scorer."
 *
 * So this ships a detector ONLY if all four hold:
 *
 *   1. A single threshold, with no stack of exemptions. Getting a rule from
 *      seven false positives to two by adding conditions is the danger, not the
 *      achievement — the `/Artifact` contrast lesson, recorded twice already.
 *   2. False positives no worse than 1 in 10 documents that fire. `1.4.1` was
 *      refused at ~76%.
 *   3. At least three true positives across the corpus. `1.3.2` was refused for
 *      having zero.
 *   4. The rule states a FACT about the document, not a judgement about the
 *      author. "This heading is 40 words long" is a fact. "This heading reads
 *      like prose" is a judgement, and 1.4.1 is where that wall was hit.
 *
 * Anything short of all four and the answer is a third `NOT_CHECKED_CRITERIA`
 * entry for 2.4.6 Headings and Labels, which is disclosure rather than silence.
 *
 * ## What it reads
 *
 * The DELIVERED documents from the blind run — what a client actually receives.
 * `Inspect` gives `headingTexts` untruncated; `order` text is capped at 90
 * characters by `Inspect.java`, so body length is a floor, never a mean, and no
 * comparison here relies on it.
 *
 * Counts only leave this machine. No heading text is printed, written to a file
 * or quoted in the results — the corpus is real municipal documents.
 *
 * Usage: node experiments/document-remediation/prose-headings.mjs
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const DELIVERED = join(ROOT, '.doc-blind-test', 'delivered');
const CP = `${join(ROOT, 'vendor', 'pdfbox-app-3.0.8.jar')}:${join(ROOT, 'dist', 'documents', 'classes')}`;

const WORDS = (t) => t.trim().split(/\s+/).filter(Boolean).length;
/** A sentence ends. A label does not. */
const ENDS_SENTENCE = (t) => /[.!?;]\s*$/.test(t.trim());

function inspect(path) {
  try {
    return JSON.parse(execFileSync('java', ['-cp', CP, 'Inspect', path], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    }));
  } catch {
    return null;
  }
}

const docs = [];
for (const file of readdirSync(DELIVERED).filter((f) => f.endsWith('.pdf')).sort()) {
  const read = inspect(join(DELIVERED, file));
  if (read === null) continue;
  const texts = (read.headingTexts ?? []).map((h) => (h.text ?? '').trim()).filter(Boolean);
  // Under three headings there is no "share" worth the name.
  if (texts.length < 3) continue;

  const lengths = texts.map(WORDS).sort((a, b) => a - b);
  docs.push({
    id: file.replace(/\.pdf$/, ''),
    headings: texts.length,
    levels: new Set((read.headingTexts ?? []).map((h) => h.level)).size,
    medianWords: lengths[Math.floor(lengths.length / 2)],
    maxWords: lengths[lengths.length - 1],
    sentences: texts.filter(ENDS_SENTENCE).length,
    share: texts.filter(ENDS_SENTENCE).length / texts.length,
  });
}

const table = (label, hits) =>
  console.log(`| ${label.padEnd(50)} | ${String(hits.length).padStart(2)} | ${hits.map((d) => d.id).join(' ') || '—'} |`);

console.log(`documents with 3+ headings: ${docs.length}`);
console.log(`headings in total         : ${docs.reduce((a, d) => a + d.headings, 0)}`);

// ---------------------------------------------------------------- length
//
// The obvious signal, and the weaker one. It cannot separate a VERBOSE heading
// from a sentence: n29 carries 83 headings with a median of 11 words and a
// maximum of 34, and not one of them ends a sentence. They are long section
// titles, correctly marked up. A length rule calls that document broken.
console.log('\n## Length alone\n');
console.log('| narrowing | documents | which |');
console.log('|---|---:|---|');
table('median heading of 8+ words', docs.filter((d) => d.medianWords >= 8));
table('median heading of 12+ words', docs.filter((d) => d.medianWords >= 12));
table('any heading of 20+ words', docs.filter((d) => d.maxWords >= 20));

// ------------------------------------------------------------ punctuation
//
// The better signal, and a FACT rather than a judgement: a heading ending in a
// full stop is a sentence somebody marked as a heading. Measured as a SHARE,
// because one such heading in ninety is a typo and thirty in forty-nine is how
// the document was written.
console.log('\n## Sentence punctuation, as a share of the document\'s headings\n');
console.log('| threshold | documents | which |');
console.log('|---|---:|---|');
for (const t of [0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.1]) {
  table(`>= ${(t * 100).toFixed(0)}% of headings end a sentence`, docs.filter((d) => d.share >= t));
}

console.log('\n## Every document above zero\n');
console.log('| document | headings ending a sentence | of | share |');
console.log('|---|---:|---:|---:|');
for (const d of docs.filter((x) => x.share > 0).sort((a, b) => b.share - a.share)) {
  console.log(`| ${d.id} | ${d.sentences} | ${d.headings} | ${(d.share * 100).toFixed(0)}% |`);
}
