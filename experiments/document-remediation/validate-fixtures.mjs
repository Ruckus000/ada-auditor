// Checks ground-truth fixtures against the shape the comparator relies on.
//
// Every serious measurement error in experiment 2 was a fixture shape defect,
// not a remediation defect:
//
//   h08  rowHeaders written as prose where every other fixture used an array.
//        compare.mjs only treats a list as naming cells, so 60 legitimate row
//        headers were unrecognisable and 28 correct promotions were scored as
//        invented headers. Cost: a technique wrongly judged to have failed.
//
//   12   a table with mergedCells and rowHeaders but no headerStructure, so its
//        six column headers were never named and correct promotions were again
//        scored as invented.
//
//   h14  a meaningful figure with no captionPresent key, so the reachability
//        predicate counted an OCR-dependent document as deterministically
//        reachable and the gate denominator was wrong.
//
// None of these was visible by reading the fixture. All three surfaced only
// when a result looked wrong and someone went digging. This makes them fail
// loudly instead.
//
// Usage: node validate-fixtures.mjs <dir> [<dir>...]
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const problems = [];
const note = (file, msg) => problems.push(`${file}: ${msg}`);

for (const dir of process.argv.slice(2)) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ground-truth.json')).sort()) {
    const file = join(dir, f);
    let gt;
    try {
      gt = JSON.parse(readFileSync(file));
    } catch (e) {
      note(file, `not valid JSON — ${e.message}`);
      continue;
    }

    if (gt.document !== basename(f, '.ground-truth.json')) {
      note(file, `"document" is ${JSON.stringify(gt.document)} but the filename says ${basename(f, '.ground-truth.json')}`);
    }
    for (const key of ['tests', 'headingHierarchy', 'readingOrder']) {
      if (gt[key] === undefined) note(file, `missing "${key}"`);
    }
    if (!('title' in gt)) note(file, 'missing "title" (use null when the document has none)');
    if (!('language' in gt)) note(file, 'missing "language"');

    for (const [i, h] of (gt.headingHierarchy ?? []).entries()) {
      if (typeof h?.level !== 'number') note(file, `headingHierarchy[${i}] has no numeric "level"`);
      if (typeof h?.text !== 'string') note(file, `headingHierarchy[${i}] has no "text"`);
    }

    for (const [i, fig] of (gt.figures ?? []).entries()) {
      if (typeof fig !== 'object' || fig === null) { note(file, `figures[${i}] is not an object`); continue; }
      // The reachability predicate keys on this, and an absent key reads as
      // "captioned" — which silently makes an undescribable figure look solvable.
      if (typeof fig.captionPresent !== 'boolean') {
        note(file, `figures[${i}] ("${fig.id ?? '?'}") has no boolean "captionPresent"`);
      }
      if (fig.captionPresent === true && typeof fig.caption !== 'string') {
        note(file, `figures[${i}] says captionPresent but carries no "caption" text to compare against`);
      }
    }

    for (const [i, t] of (gt.tables ?? []).entries()) {
      if (t.purpose === 'layout only') continue;
      const where = `tables[${i}]${t.name ? ` ("${t.name}")` : ''}`;
      const hasCols = Array.isArray(t.columnHeaders);
      const hasStruct = t.headerStructure && typeof t.headerStructure === 'object';
      if (!hasCols && !hasStruct) {
        note(file, `${where} names no column headers — needs "headerStructure" or "columnHeaders"`);
      }
      if (hasStruct) {
        for (const [k, row] of Object.entries(t.headerStructure)) {
          if (!Array.isArray(row)) note(file, `${where}.headerStructure.${k} is not an array`);
        }
      }
      // The h08 defect exactly.
      if ('rowHeaders' in t && !Array.isArray(t.rowHeaders)) {
        note(file, `${where}.rowHeaders is ${typeof t.rowHeaders}, not an array — prose cannot name cells and the comparator will score correct promotions as invented`);
      }
      if (t.spansPages === true && typeof t.expectedTableCount !== 'number') {
        note(file, `${where} spans pages but has no "expectedTableCount" — fragmentation cannot be judged`);
      }
    }
  }
}

if (problems.length) {
  console.error(`${problems.length} fixture problem(s):\n`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('all fixtures well-formed');
