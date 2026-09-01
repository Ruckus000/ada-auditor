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
  const headings = read.headingTexts ?? [];
  if (headings.length === 0) continue;

  const lengths = headings.map((h) => WORDS(h.text ?? ''));
  const levels = new Set(headings.map((h) => h.level));
  docs.push({
    id: file.replace(/\.pdf$/, ''),
    headings: headings.length,
    blocks: (read.order ?? []).length,
    levels: levels.size,
    long: lengths.filter((n) => n >= 12).length,
    veryLong: lengths.filter((n) => n >= 20).length,
    sentences: headings.filter((h) => ENDS_SENTENCE(h.text ?? '')).length,
    longAndSentence: headings.filter(
      (h) => WORDS(h.text ?? '') >= 12 && ENDS_SENTENCE(h.text ?? ''),
    ).length,
    maxWords: Math.max(...lengths),
  });
}

const fires = (predicate) => docs.filter(predicate);
const pct = (n) => `${((n / docs.length) * 100).toFixed(0)}%`;

console.log(`documents with at least one heading: ${docs.length}`);
console.log(`headings in total                  : ${docs.reduce((a, d) => a + d.headings, 0)}`);
console.log();
console.log('| narrowing                                              | documents firing |');
console.log('|---|---:|');
const rows = [
  ['any heading of 12+ words', (d) => d.long > 0],
  ['any heading of 20+ words', (d) => d.veryLong > 0],
  ['any heading ending in sentence punctuation', (d) => d.sentences > 0],
  ['12+ words AND ends a sentence', (d) => d.longAndSentence > 0],
  ['...and more than 5 such headings', (d) => d.longAndSentence > 5],
  ['...and the document has ONE heading level only', (d) => d.longAndSentence > 5 && d.levels === 1],
  ['...and headings are over a third of all blocks', (d) => d.longAndSentence > 5 && d.levels === 1 && d.blocks > 0 && d.headings / d.blocks > 1 / 3],
];
for (const [label, predicate] of rows) {
  const n = fires(predicate).length;
  console.log(`| ${label.padEnd(54)} | ${String(n).padStart(3)} (${pct(n)}) |`);
}

console.log();
console.log('documents firing the narrowest rule, with their numbers:');
for (const d of fires(rows[rows.length - 1][1])) {
  console.log(`  ${d.id.padEnd(24)} headings=${d.headings} blocks=${d.blocks} levels=${d.levels} long+sentence=${d.longAndSentence} maxWords=${d.maxWords}`);
}

console.log();
console.log('documents firing "12+ words AND ends a sentence" but NOT the narrowest:');
for (const d of fires((x) => x.longAndSentence > 0 && !(x.longAndSentence > 5 && x.levels === 1 && x.blocks > 0 && x.headings / x.blocks > 1 / 3))) {
  console.log(`  ${d.id.padEnd(24)} headings=${d.headings} blocks=${d.blocks} levels=${d.levels} long+sentence=${d.longAndSentence} maxWords=${d.maxWords}`);
}
