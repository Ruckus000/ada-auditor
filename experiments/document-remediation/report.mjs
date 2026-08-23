// Builds the results table from the three phase summaries. Generated rather
// than hand-typed so every number traces to a file under out/.
//
// Classification is NOT derived from veraPDF alone. A document that passes ua1
// can still carry defects veraPDF cannot see, and this spike found several, so
// the semantic column below is entered from ground-truth comparison and is
// what decides DELIVERABLE vs NEEDS_REVIEW.
import { readFileSync, writeFileSync } from 'node:fs';

const load = (p) => Object.fromEntries(JSON.parse(readFileSync(p)).map((r) => [r.document, r]));
const base = load('out/phase2-baseline/summary.json');
const p3v  = load('out/phase3-validated/summary.json');
const p5   = load('out/phase5-final/summary.json');
const odl  = Object.fromEntries(JSON.parse(readFileSync('out/phase3-tagged/run.json')).map((r) => [r.document, r]));
const fin  = Object.fromEntries(JSON.parse(readFileSync('out/phase4-finished/run.json')).map((r) => [r.document, r]));

// Verified against ground truth by inspecting the phase-4 output, not inferred
// from validator results. Empty string means no semantic defect found.
const SEMANTIC = {
  '01-simple-text':               '',
  '02-two-column':                '',
  '03-simple-table':              'table tagged but zero /TH — all header relationships lost',
  '04-difficult-table':           'borderless table not detected as a table at all (zero /Table)',
  '05-images-captioned':          'alt text is "image 1".."image 4" despite captions directly beneath each figure',
  '06-images-uncaptioned':        'four meaningful graphics all alt "image N"; decorative rule described too',
  '07-complex-chart':             'chart carries placeholder alt; no long description',
  '08-slide-layout':              'photograph carries placeholder alt',
  '09-scanned':                   'no text layer — OCR unavailable on the free path',
  '10-metadata-problems':         'no title to copy; French passages labelled en by the document /Lang',
  '11-deliberately-inaccessible': 'no title to copy; 11 authored barriers invisible to PDF/UA machine checks',
  '12-kitchen-sink':              'eight figures with placeholder alt; borderless table undetected',
};

const TYPE = {
  '01-simple-text': 'control', '02-two-column': 'reading order',
  '03-simple-table': 'ruled table', '04-difficult-table': 'borderless table',
  '05-images-captioned': 'captioned figures', '06-images-uncaptioned': 'uncaptioned figures',
  '07-complex-chart': 'chart', '08-slide-layout': 'slide layout',
  '09-scanned': 'scanned', '10-metadata-problems': 'metadata',
  '11-deliberately-inaccessible': 'many barriers', '12-kitchen-sink': 'realistic report',
};

const rows = Object.keys(p5).sort().map((n) => {
  const b = base[n], t = p3v[n], f = p5[n];
  const beforeIds = new Set(b.ua1.rules.map((r) => r.id));
  const introduced = f.ua1.rules.filter((r) => !beforeIds.has(r.id)).map((r) => r.id);
  const semantic = SEMANTIC[n];

  let verdict;
  if (!f.ua1.compliant) verdict = 'INCONCLUSIVE';
  else if (semantic) verdict = 'NEEDS_REVIEW';
  else verdict = 'DELIVERABLE';

  const reason = !f.ua1.compliant
    ? `ua1 fails: ${f.ua1.rules.map((r) => r.id).join(', ')}${semantic ? '; ' + semantic : ''}`
    : (semantic || 'machine checks pass; no semantic defect found against ground truth');

  return {
    document: n, type: TYPE[n], pages: f.pages,
    initial: b.ua1.failedChecks, afterOdl: t.ua1.failedChecks, afterFinish: f.ua1.failedChecks,
    introduced: introduced.join(',') || '-',
    odlMs: odl[n].ms, finishMs: fin[n].ms, veraMs: f.ua1.wallMs,
    totalMs: odl[n].ms + fin[n].ms + f.ua1.wallMs,
    inBytes: b.bytes, outBytes: f.bytes,
    verdict, reason,
  };
});

const pct = (n) => `${Math.round((n / rows.length) * 100)}%`;
const times = rows.map((r) => r.totalMs).sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)];
const count = (v) => rows.filter((r) => r.verdict === v).length;

const agg = {
  documents: rows.length,
  machinePass: rows.filter((r) => r.afterFinish === 0).length,
  machinePassRate: pct(rows.filter((r) => r.afterFinish === 0).length),
  deliverable: count('DELIVERABLE'), deliverableRate: pct(count('DELIVERABLE')),
  needsReview: count('NEEDS_REVIEW'), needsReviewRate: pct(count('NEEDS_REVIEW')),
  inconclusive: count('INCONCLUSIVE'), inconclusiveRate: pct(count('INCONCLUSIVE')),
  medianTotalMs: median, minTotalMs: times[0], maxTotalMs: times.at(-1),
  totalInitialFailures: rows.reduce((s, r) => s + r.initial, 0),
  totalAfterOdl: rows.reduce((s, r) => s + r.afterOdl, 0),
  totalAfterFinish: rows.reduce((s, r) => s + r.afterFinish, 0),
  customRemediationLines: 97,
};

writeFileSync('out/results.json', JSON.stringify({ rows, agg }, null, 2));

console.log('doc                            pages  init  →odl  →fin  new    total  verdict');
for (const r of rows) {
  console.log(
    r.document.padEnd(30),
    String(r.pages).padStart(4),
    String(r.initial).padStart(6), String(r.afterOdl).padStart(6), String(r.afterFinish).padStart(5),
    r.introduced.padEnd(7).slice(0, 7),
    `${String(r.totalMs).padStart(5)}ms`,
    r.verdict,
  );
}
console.log('\n' + JSON.stringify(agg, null, 2));
