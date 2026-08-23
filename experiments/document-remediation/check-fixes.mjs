// Regression check for the category-A finishing pass.
//
// One assertion per implemented fix: the veraPDF rule that motivated it must be
// absent from every document afterwards. Plus one assertion that the pass did
// not introduce anything unaccounted for.
//
// Deliberately not a vitest suite. The root fast suite is contractually
// browser-free and socket-free, this needs a JVM, and a second test-runner
// config to assert seven things would be more scaffolding than spike.
import { readFileSync } from 'node:fs';

const load = (p) => Object.fromEntries(JSON.parse(readFileSync(p)).map((r) => [r.document, r]));
// The finishing pass's input is phase-3 output, so phase 3 is the baseline it
// must be judged against — not phase 2. Getting this wrong matters: 7.2-22 and
// 7.2-24 do not exist in the phase-2 baseline at all. OpenDataLoader introduces
// them by adding Alt attributes and annotation Contents without a language, and
// judging against phase 2 reported the fixes for them as unmotivated.
const before = load('out/phase3-validated/summary.json');
const after = load('out/phase5-final/summary.json');
const original = load('out/phase2-baseline/summary.json');

// rule -> the catalog write in Finish.java that closes it
const FIXES = {
  '6.2-1':  '/MarkInfo << /Marked true >>',
  '7.1-8':  'XMP metadata stream on the catalog',
  '7.1-10': '/ViewerPreferences << /DisplayDocTitle true >>',
  '7.2-34': '/Lang on the catalog (page content)',
  '7.2-22': '/Lang on the catalog (Alt attributes)',
  '7.2-24': '/Lang on the catalog (annotation Contents)',
};

// Accepted new failure. 7.1-9 requires dc:title INSIDE a metadata stream, so it
// cannot fire until 7.1-8 is fixed and a stream exists. Our fix surfaces it on
// the three documents authored without a title. That is category B, declined in
// advance, and is recorded rather than hidden.
const ACCEPTED_NEW = { '7.1-9': ['09-scanned', '10-metadata-problems', '11-deliberately-inaccessible'] };

const failures = [];

for (const [rule, fix] of Object.entries(FIXES)) {
  const stillFailing = Object.entries(after)
    .filter(([, row]) => row.ua1.rules.some((r) => r.id === rule))
    .map(([name]) => name);
  const wasFailing = Object.entries(before)
    .filter(([, row]) => row.ua1.rules.some((r) => r.id === rule))
    .map(([name]) => name);

  if (!wasFailing.length) {
    failures.push(`${rule}: nothing failed this rule in the baseline — the fix for "${fix}" is unmotivated`);
  } else if (stillFailing.length) {
    failures.push(`${rule}: still failing on ${stillFailing.join(', ')} after "${fix}"`);
  } else {
    console.log(`ok   ${rule.padEnd(8)} cleared on ${wasFailing.length} document(s) — ${fix}`);
  }
}

for (const [name, row] of Object.entries(after)) {
  const beforeIds = new Set(before[name].ua1.rules.map((r) => r.id));
  for (const r of row.ua1.rules) {
    if (beforeIds.has(r.id)) continue;
    const accepted = ACCEPTED_NEW[r.id];
    if (accepted?.includes(name)) continue;
    failures.push(`${name}: unaccounted new failure ${r.id} — ${r.description}`);
  }
}
if (!failures.length) console.log(`ok   no unaccounted new failures (7.1-9 on 3 title-less documents is declared)`);

if (failures.length) {
  console.error('\nFAIL');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log('\nall checks passed');
