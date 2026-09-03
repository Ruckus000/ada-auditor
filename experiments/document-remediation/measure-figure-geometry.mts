// How many of the figures a person would be asked to describe can be shown
// to them: located (a `box`), identified (an `imageDigest`), and collapsed
// (a repeat of an earlier image in the same document). The numbers behind
// `figure-geometry-results.md` were produced by a script that was never
// committed; this is that script, so the next reading is comparable to the
// last one instead of re-derived.
//
// Reads only. Counts and geometry only — never a document's words.
//
// Usage: npx tsx measure-figure-geometry.mts [pdfDir] [outJson] [baselineJson]
//
//   pdfDir        defaults to blind-corpus/real; only `^[rn]\d+\.pdf$` is read
//   outJson       per-document rows with every open figure's box and digest
//   baselineJson  an earlier outJson; every box it located must be unchanged
//                 to the float, and the script says so or names the drift

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { inspectDocument } from '../../src/integrations/documents/inspect';
import { figurePrior } from '../../src/domain/document-remediation';
import type { DocumentFigure } from '../../src/domain/document-structure';

const [pdfDirArg, outJson, baselineJson] = process.argv.slice(2);
const pdfDir = pdfDirArg ?? join(import.meta.dirname, 'blind-corpus', 'real');
if (!existsSync(pdfDir)) {
  console.error(`no such directory: ${pdfDir}`);
  process.exit(2);
}

// The repo root, not the cwd — `resolveJavaRuntime` anchors the compiled
// classes on it (see `measure-pdf-population.mts`).
const ROOT = join(import.meta.dirname, '..', '..');
process.env.JAVA_HOME ??= '/opt/homebrew/opt/openjdk@17';

type Row = {
  id: string;
  open: number;
  located: number;
  identified: number;
  collapsed: number;
  images: number;
  ms: number;
  figures: Array<{ ordinal: number; box: DocumentFigure['box']; imageDigest: string | null }>;
};

const rows: Row[] = [];
const failed: string[] = [];
const files = readdirSync(pdfDir)
  .filter((f) => /^[rn]\d+\.pdf$/.test(f))
  .sort();
const wallStart = performance.now();

for (const file of files) {
  const id = basename(file, '.pdf');
  const t0 = performance.now();
  const read = await inspectDocument(join(pdfDir, file), { root: ROOT });
  const ms = Math.round(performance.now() - t0);
  if (!read.ok) {
    failed.push(id);
    console.log(`${id.padEnd(6)} UNREADABLE ${read.failure.kind}`);
    continue;
  }
  const s = read.value;

  // "Open" is the product's own definition: a figure the punch list asks a
  // person about — no description, a placeholder, or decorative-only.
  const open = s.figures
    .map((figure, ordinal) => ({ figure, ordinal }))
    .filter(({ figure }) => figurePrior(figure.alt) !== null);
  const located = open.filter(({ figure }) => figure.box != null);
  const identified = open.filter(({ figure }) => figure.imageDigest != null);
  const groups = new Map<string, number>();
  for (const { figure } of identified) {
    groups.set(figure.imageDigest!, (groups.get(figure.imageDigest!) ?? 0) + 1);
  }
  let collapsed = 0;
  for (const count of groups.values()) collapsed += count - 1;

  rows.push({
    id,
    open: open.length,
    located: located.length,
    identified: identified.length,
    collapsed,
    images: s.images,
    ms,
    figures: open.map(({ figure, ordinal }) => ({
      ordinal,
      box: figure.box ?? null,
      imageDigest: figure.imageDigest ?? null,
    })),
  });
  console.log(
    `${id.padEnd(6)} open=${String(open.length).padStart(3)} located=${String(located.length).padStart(3)}` +
      ` identified=${String(identified.length).padStart(3)} collapsed=${String(collapsed).padStart(3)}` +
      ` images=${String(s.images).padStart(3)} ${String(ms).padStart(5)}ms`,
  );
}
const wallMs = Math.round(performance.now() - wallStart);

const sum = (key: 'open' | 'located' | 'identified' | 'collapsed') =>
  rows.reduce((total, row) => total + row[key], 0);
const open = sum('open');
const share = (n: number) => (open === 0 ? '—' : `${((100 * n) / open).toFixed(1)} %`);
const halved = rows.filter((row) => row.open > 0 && row.collapsed * 2 >= row.open).map((row) => row.id);

console.log(`\n== ${files.length} documents, ${rows.length} read, ${failed.length} failed ==`);
console.log(`open figures: ${open}`);
console.log(`located:      ${sum('located')} (${share(sum('located'))})`);
console.log(`identified:   ${sum('identified')} (${share(sum('identified'))})`);
console.log(`collapsed:    ${sum('collapsed')} (${share(sum('collapsed'))})`);
console.log(`halved by grouping: ${halved.length}${halved.length > 0 ? ` (${halved.join(', ')})` : ''}`);
console.log(`wall: ${(wallMs / 1000).toFixed(1)} s`);
if (failed.length > 0) console.log(`failed: ${failed.join(', ')}`);

if (baselineJson) {
  // A box the earlier reading located is a fact about the same bytes; a change
  // to it is drift in the instrument, not in the document.
  const baseline = new Map((JSON.parse(readFileSync(baselineJson, 'utf8')) as Row[]).map((r) => [r.id, r]));
  let compared = 0;
  const drifted: string[] = [];
  for (const row of rows) {
    const before = baseline.get(row.id);
    if (!before) continue;
    for (const figure of before.figures) {
      if (figure.box === null || figure.box === undefined) continue;
      compared += 1;
      const now = row.figures.find((f) => f.ordinal === figure.ordinal);
      if (JSON.stringify(now?.box ?? null) !== JSON.stringify(figure.box)) {
        drifted.push(`${row.id}#${figure.ordinal}`);
      }
    }
  }
  console.log(`\nboxes located in the baseline: ${compared}, changed: ${drifted.length}`);
  if (drifted.length > 0) console.log(`drifted: ${drifted.join(', ')}`);
}

if (outJson) {
  writeFileSync(outJson, JSON.stringify(rows, null, 2));
  console.log(`\nrows -> ${outJson}`);
}
