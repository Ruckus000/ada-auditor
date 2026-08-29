// Phase 4: what transcription-only repair actually does to real municipal
// PDFs, on both instruments, per document.
//
// Runs the product's own path — `repairPdfBytes` — so what is measured is
// what ships, not a reimplementation of it. veraPDF before and after gives
// the clause-level delta, which is the honest unit here: most documents will
// not reach conformance, and "five failing clauses removed, one named" is a
// real result that a pass/fail count would hide.
//
// Usage: npx tsx run-pdf-repair-arm.mts <pdfDir> <harvestMap> <outDir>

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { repairPdfBytes } from '../../src/app/api/_lib/document-conversion';

const [pdfDir, harvestMap, outDir] = process.argv.slice(2);
if (!pdfDir || !harvestMap || !outDir) {
  console.error('usage: npx tsx run-pdf-repair-arm.mts <pdfDir> <harvestMap> <outDir>');
  process.exit(2);
}

// The repo root, not the cwd: `resolveJavaRuntime` anchors the compiled
// classes on it, and a runner started from this directory otherwise reports
// every document unreadable — a uniform verdict, which is always the
// instrument rather than the population.
const ROOT = join(import.meta.dirname, '..', '..');
const VERAPDF = join(import.meta.dirname, 'vendor', 'verapdf', 'verapdf');
const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17';

mkdirSync(join(outDir, 'pdf'), { recursive: true });

const nameOf = new Map<string, string>();
for (const line of readFileSync(harvestMap, 'utf8').split('\n')) {
  const [local, url] = line.trim().split(/\s+/, 2);
  if (local && url) {
    nameOf.set(local, decodeURIComponent(url.split('?')[0].split('/').filter(Boolean).pop() ?? ''));
  }
}

function ua1(pdf: string): { pass: boolean; clauses: string[] } | null {
  if (!existsSync(VERAPDF)) return null;
  const env = { ...process.env, JAVA_HOME, PATH: `${JAVA_HOME}/bin:${process.env.PATH}` };
  let raw = '';
  try {
    raw = execFileSync(VERAPDF, ['-f', 'ua1', '--format', 'json', pdf], {
      maxBuffer: 64 * 1024 * 1024,
      env,
    }).toString('utf8');
  } catch (error) {
    const e = error as { status?: number; stdout?: Buffer };
    if (e.status !== 1 || !e.stdout?.length) return null;
    raw = e.stdout.toString('utf8');
  }
  const result = JSON.parse(raw).report.jobs[0]?.validationResult?.[0];
  const summaries = (result?.details?.ruleSummaries ?? []) as Array<{
    clause: string;
    testNumber: number;
    failedChecks: number;
  }>;
  return {
    pass: result?.compliant === true,
    clauses: summaries.filter((r) => r.failedChecks > 0).map((r) => `${r.clause}-${r.testNumber}`),
  };
}

const rows = [];
let repaired = 0;
let refused = 0;
let greenAfter = 0;
let clausesRemoved = 0;

for (const file of readdirSync(pdfDir).filter((f) => f.endsWith('.pdf')).sort()) {
  const path = join(pdfDir, file);
  const id = basename(file, '.pdf');
  const before = ua1(path);

  const outcome = await repairPdfBytes(new Uint8Array(readFileSync(path)), `arm-${id}`, {
    sourceName: nameOf.get(id) ?? file,
    root: ROOT,
  });

  if (!outcome.ok) {
    refused += 1;
    rows.push({
      id,
      outcome: 'refused',
      why: outcome.refusal.detail ?? outcome.refusal.error,
      ua1Before: before?.clauses ?? [],
    });
    console.log(`${id.padEnd(24)} refused  ${outcome.refusal.detail ?? outcome.refusal.error}`);
    continue;
  }

  const outPath = join(outDir, 'pdf', `${id}.pdf`);
  writeFileSync(outPath, outcome.pdf);
  const after = ua1(outPath);

  const removed = (before?.clauses ?? []).filter((c) => !(after?.clauses ?? []).includes(c));
  const added = (after?.clauses ?? []).filter((c) => !(before?.clauses ?? []).includes(c));
  repaired += 1;
  clausesRemoved += removed.length;
  const green = after?.pass === true && outcome.summary.gaps.length === 0;
  if (green) greenAfter += 1;

  rows.push({
    id,
    outcome: 'repaired',
    title: outcome.summary.title,
    green,
    ua1Before: before?.clauses ?? [],
    ua1After: after?.clauses ?? [],
    removed,
    added,
    gaps: outcome.summary.gaps.map((g) => g.split(':')[0]),
    needs: outcome.summary.needs?.length ?? 0,
  });

  console.log(
    `${id.padEnd(24)} repaired title=${outcome.summary.title.padEnd(18)} ` +
      `ua1 ${String(before?.clauses.length ?? 0).padStart(2)}→${String(after?.clauses.length ?? 0).padStart(2)} ` +
      `${green ? 'GREEN' : ''}${added.length > 0 ? ` ADDED:${added.join(',')}` : ''}`,
  );
}

console.log(`\n== repair arm ==`);
console.log(`documents: ${rows.length} · repaired: ${repaired} · refused (untagged): ${refused}`);
console.log(`green on both instruments after repair: ${greenAfter}`);
console.log(`failing UA-1 clauses removed in total: ${clausesRemoved}`);
const regressions = rows.filter((r) => 'added' in r && (r.added as string[]).length > 0);
console.log(`documents where repair ADDED a failing clause: ${regressions.length}`);

// The promise, checked rather than asserted: a document that is not
// conformant must say why. This found three documents that said nothing —
// their only remaining failures were ones our reading could see and our
// punch-list vocabulary could not name. It stays because the next such gap
// will be found the same way, and silence is the one failure that looks
// identical to success.
const silent = rows.filter(
  (r) => r.outcome === 'repaired' && !r.green && (r.gaps as string[]).length === 0 && r.needs === 0,
);
console.log(
  `delivered non-conformant WITHOUT a gap or punch item (must be 0): ${silent.length}` +
    (silent.length > 0 ? ` — ${silent.map((r) => r.id).join(', ')}` : ''),
);

writeFileSync(join(outDir, 'rows.json'), JSON.stringify(rows, null, 2));
