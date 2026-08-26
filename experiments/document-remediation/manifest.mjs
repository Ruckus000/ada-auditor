// What a human would have to supply to close each document, and how many
// documents that actually reaches.
//
// Experiment 2 found that gate 1 (zero false assertions) and gate 2 (80%
// deliverable) do not move together, because compare.mjs derives the verdict
// from the whole defect list — an omission blocks DELIVERABLE exactly as an
// assertion does. That makes "25% deliverable" the wrong number to run a
// business on by itself. The one that matters is "25% deliverable, and the rest
// need N answers each".
//
// This file MEASURES. It reads the JSON compare.mjs already writes, changes no
// verdict, and does not touch compare.mjs. Redefining the gate to make the
// number look better is the move the whole two-corpus design exists to prevent.
//
// Usage: node manifest.mjs <comparison.json> [more.json ...]
import { readFileSync, writeFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node manifest.mjs <comparison.json> [more.json ...]');
  process.exit(2);
}

// An omission is a gap a reviewer can see, so each one is a question. The only
// thing that separates them is whether a person can answer it at all: everything
// here is answerable by someone looking at the page EXCEPT a missing text layer,
// which needs OCR — a capability nobody has stood up, and one that no amount of
// review time substitutes for.
//
// Ordered; first match wins.
const QUESTIONS = [
  [/no text layer|expected text but extracted/, 'transcribe the page — it has no text layer', false],
  [/figure with no Alt and no ActualText/,      'describe this image, or confirm it is decorative', true],
  [/caption present but no figure alt reflects/, 'confirm which figure this caption belongs to', true],
  [/ground-truth table was not detected/,        'mark up this table — it was not detected as one', true],
  [/zero \/TH|still tagged TD/,                  'identify which cells are headers, and what they head', true],
  [/heading under-detection/,                    'identify the headings and their levels', true],
  [/list nesting/,                               'confirm the nesting of this list', true],
  [/list\(s\) tagged|list items tagged/,         'identify the lists and their items', true],
  [/reading order/,                              'confirm where this content belongs in the reading order', true],
  [/no document \/Lang/,                         'supply the document language', true],
  [/no document title/,                          'supply the document title', true],
];

const questionFor = (msg) => {
  for (const [re, text, answerable] of QUESTIONS) if (re.test(msg)) return { text, answerable, from: msg };
  // Unmatched is reported, not silently dropped or silently counted as easy.
  return { text: `UNCLASSIFIED: ${msg}`, answerable: false, from: msg };
};

const rows = [];
for (const f of files) {
  for (const r of JSON.parse(readFileSync(f))) {
    const questions = r.defects.filter((d) => d.kind === 'omission').map((d) => questionFor(d.msg));
    const blocked = questions.filter((q) => !q.answerable);

    // A document carrying an assertion is not reachable by review at any price.
    // That is the whole reason assertions and omissions are counted separately:
    // an omission is a gap a reviewer can see and close, an assertion is a wrong
    // claim already in the bytes with nothing to signal that it is wrong. A
    // reviewer does not know to ask about it.
    const state = r.assertions > 0 ? 'unreviewable'
      : blocked.length ? 'blocked'
      : questions.length ? 'answerable'
      : 'deliverable';

    rows.push({ document: r.document, verdict: r.verdict, state, questions: questions.length, blocked: blocked.length, asks: questions });
  }
}

const by = (s) => rows.filter((r) => r.state === s);
const answerable = by('answerable');
const asks = answerable.map((r) => r.questions).sort((a, b) => a - b);
const total = asks.reduce((a, b) => a + b, 0);

for (const r of rows) {
  console.log(`${r.document.padEnd(30)} ${r.state.padEnd(13)} questions=${r.questions}${r.blocked ? ` (${r.blocked} blocked)` : ''}`);
  for (const q of r.asks) console.log(`    ${q.answerable ? '?' : 'x'} ${q.text}`);
}

console.log(`\n${rows.length} documents`);
console.log(`  deliverable now                  ${by('deliverable').length}`);
console.log(`  deliverable after N answers      ${answerable.length}   (${total} questions total`
  + (asks.length ? `, median ${asks[Math.floor(asks.length / 2)]}, max ${asks.at(-1)}` : '') + ')');
console.log(`  blocked — needs OCR              ${by('blocked').length}`);
console.log(`  unreviewable — carries assertion ${by('unreviewable').length}`);
console.log(`\nReachable by review: ${by('deliverable').length + answerable.length}/${rows.length}`
  + ` for ${total} answers.`);

writeFileSync(process.env.MANIFEST_OUT ?? 'out/manifest.json', JSON.stringify(rows, null, 2));

// Every omission must map to exactly one question, or the counts here mean
// nothing. Cheap to assert, and silent drift would be invisible.
const omissions = files.reduce((n, f) =>
  n + JSON.parse(readFileSync(f)).reduce((m, r) => m + r.defects.filter((d) => d.kind === 'omission').length, 0), 0);
const asked = rows.reduce((n, r) => n + r.questions, 0);
if (omissions !== asked) {
  console.error(`\nBUG: ${omissions} omissions produced ${asked} questions`);
  process.exit(2);
}
const unclassified = rows.flatMap((r) => r.asks).filter((q) => q.text.startsWith('UNCLASSIFIED'));
if (unclassified.length) {
  console.error(`\n${unclassified.length} omission(s) have no question. Add them to QUESTIONS.`);
  process.exit(1);
}
