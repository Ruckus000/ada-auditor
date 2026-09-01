// Does a structure tree that EXISTS actually cover the document?
//
// `isTagged` is a floor of one: a PDF with a non-empty structure tree is
// repairable, and one with an empty tree is refused. `[V]` Nineteen delivered
// documents fail `7.1-3` — "content shall be marked as Artifact or tagged as
// real content" — and the failure counts split into two populations that the
// clause number hides: 90 and 121 untagged runs on some documents, and 2,407
// and 7,928 on others, the largest against 32,399 untagged text runs in the
// same file. The second shape is a document whose tree is decorative. We accept
// it as tagged, repair it, and deliver something that can never conform, and
// the client cannot see that the tree covers almost none of the words.
//
// This measures the share of a document's text that the structure tree reaches.
// It changes nothing. It answers whether `isTagged` is a floor of one by
// oversight or by design.
//
// ## The instrument, and its limit stated up front
//
// Coverage = the summed length of `order[].text` — the block-level elements in
// structure order, which is what the tree reaches — over `textChars`, the whole
// extracted text. Both come from `Inspect`, so nothing new reads a PDF.
//
// It is a PROXY and cannot be otherwise: `order` is block-level, its text is
// whitespace-normalised, and nested elements can double-count. A ratio near 1
// means the tree reaches the document; a ratio near 0 means it does not. No
// reading finer than that is supported, and none is taken below.
//
// ## Criteria, registered BEFORE the first run
//
//   1. CALIBRATION FIRST. Documents that do NOT fail `7.1-3` are the negative
//      control — their trees do cover their content. If their median coverage
//      is below 0.80, the proxy is measuring its own normalisation rather than
//      the tree, and the whole result is discarded rather than explained.
//   2. `isTagged` is judged WRONG only if at least three documents pass the
//      gate with coverage below 0.25. One or two is a rare shape: recorded,
//      not acted on. This is the same bar the prose-heading work failed.
//   3. Any change to `isTagged` REFUSES documents we currently deliver. That is
//      a product regression from the client's side — they get nothing instead
//      of something — so it is a decision to put to a person, never a
//      conclusion this script reaches on its own.
//   4. The geometry-and-repetition question — whether a furniture-only
//      `/Artifact` pass is buildable — is NOT measured here. It needs
//      per-run bounding boxes, and it is worth one document. It gets built
//      only if this measurement says the population is there.
//
// Output is counts and ratios. No document text, no filenames beyond the
// corpus ids, which are generated.
//
// Usage: npx tsx experiments/document-remediation/tree-coverage.mts

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { inspectDocument } from '../../src/integrations/documents/inspect';
import { isTagged } from '../../src/domain/document-structure';

const ROOT = join(import.meta.dirname, '..', '..');
const REAL = join(ROOT, 'experiments', 'document-remediation', 'blind-corpus', 'real');
const RESULTS = join(ROOT, '.doc-blind-test', 'latest.json');

if (!existsSync(RESULTS)) {
  console.error(`no blind run to read at ${RESULTS} — run \`npm run blind:documents -- run\` first`);
  process.exit(2);
}

const { results } = JSON.parse(readFileSync(RESULTS, 'utf8')) as {
  results: Record<string, { independent?: { checked?: boolean; clauses?: string[] } }>;
};

const untagged = new Set(
  Object.entries(results)
    .filter(([, r]) => (r.independent?.clauses ?? []).includes('7.1-3'))
    .map(([id]) => id),
);

type Row = { id: string; coverage: number; tagged: boolean; fails713: boolean };
const rows: Row[] = [];

// Source PDFs, because `isTagged` gates on what the CLIENT sent, not on what we
// wrote back. For the repair lane the two carry the same tree anyway.
for (const file of readdirSync(REAL).filter((f) => f.endsWith('.pdf')).sort()) {
  const id = file.replace(/\.pdf$/, '');
  const read = await inspectDocument(join(REAL, file), { root: ROOT });
  if (!read.ok) {
    console.log(`  ${id.padEnd(6)} UNREADABLE ${read.failure.kind}`);
    continue;
  }
  const s = read.value;
  const inTree = s.order.reduce((n, el) => n + (el.text ?? '').length, 0);
  rows.push({
    id,
    // A document with no extracted text at all is a scan, not a coverage
    // question: reported as 0 and excluded from the medians below.
    coverage: s.textChars > 0 ? inTree / s.textChars : Number.NaN,
    tagged: isTagged(s),
    fails713: untagged.has(id),
  });
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? Number.NaN : s[Math.floor(s.length / 2)];
};
const usable = rows.filter((r) => Number.isFinite(r.coverage));
const control = usable.filter((r) => !r.fails713);
const suspect = usable.filter((r) => r.fails713);

for (const r of rows.sort((a, b) => a.coverage - b.coverage)) {
  const c = Number.isFinite(r.coverage) ? r.coverage.toFixed(2) : ' n/a';
  console.log(`  ${r.id.padEnd(6)} coverage=${c}  tagged=${r.tagged ? 'yes' : 'no '}  7.1-3=${r.fails713 ? 'fails' : 'ok'}`);
}

console.log();
console.log(`source PDFs read                    : ${rows.length} (${usable.length} with extractable text)`);
console.log(`CALIBRATION — median coverage, 7.1-3 ok  : ${median(control.map((r) => r.coverage)).toFixed(2)} over ${control.length}`);
console.log(`              median coverage, 7.1-3 fails: ${median(suspect.map((r) => r.coverage)).toFixed(2)} over ${suspect.length}`);
console.log();
const decorative = usable.filter((r) => r.tagged && r.coverage < 0.25);
console.log(`documents PASSING isTagged with coverage < 0.25: ${decorative.length}`);
for (const r of decorative) console.log(`    ${r.id} ${r.coverage.toFixed(2)}`);
console.log(
  control.length > 0 && median(control.map((r) => r.coverage)) < 0.8
    ? '\nCRITERION 1 FAILED — the proxy does not separate. Result discarded.'
    : decorative.length >= 3
      ? '\nCriterion 2 met: the population exists. Criterion 3 says the decision is a person’s.'
      : '\nCriterion 2 not met: recorded, not acted on.',
);
