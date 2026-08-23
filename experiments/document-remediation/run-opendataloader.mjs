// Phase 3: the free OpenDataLoader tagged-PDF path, and nothing else.
//
// Defaults only. `tableMethod: cluster` and the hybrid backends exist and might
// improve the numbers, but tuning options until the result looks good is the
// failure mode this spike is built to avoid. Defaults are what an integration
// would ship on day one, so defaults are what gets measured.
//
// Timing is per convert() call and therefore includes JVM startup: the package
// spawns a JVM per call, which is a per-document cost the research review
// flagged as unmeasured.
import { convert } from '@opendataloader/pdf';
import { readdirSync, mkdirSync, writeFileSync, statSync, renameSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';

const IN = 'out/corpus';
const OUT = 'out/phase3-tagged';
mkdirSync(OUT, { recursive: true });

const files = readdirSync(IN).filter((f) => f.endsWith('.pdf')).sort();
const rows = [];

for (const f of files) {
  const name = basename(f, '.pdf');
  const started = Date.now();
  let error = null;
  try {
    await convert([join(IN, f)], { outputDir: OUT, format: 'tagged-pdf', quiet: true });
  } catch (e) {
    error = String(e?.message ?? e);
  }
  const ms = Date.now() - started;

  // Normalise whatever it named the output to <name>.pdf so later phases do
  // not have to know the tool's naming convention.
  const produced = readdirSync(OUT).filter((o) => o.startsWith(name) && o.endsWith('.pdf'));
  let outPath = null;
  if (produced.length) {
    const chosen = join(OUT, produced[0]);
    outPath = join(OUT, `${name}.pdf`);
    if (chosen !== outPath) renameSync(chosen, outPath);
  }

  rows.push({
    document: name,
    ms,
    error,
    produced: Boolean(outPath && existsSync(outPath)),
    inBytes: statSync(join(IN, f)).size,
    outBytes: outPath && existsSync(outPath) ? statSync(outPath).size : null,
  });
  console.log(
    name.padEnd(30),
    `${String(ms).padStart(6)}ms`,
    rows.at(-1).produced ? `out=${rows.at(-1).outBytes}` : `NO OUTPUT ${error ?? ''}`,
  );
}

writeFileSync(join(OUT, 'run.json'), JSON.stringify(rows, null, 2));
const ok = rows.filter((r) => r.produced).length;
console.log(`\n${ok}/${rows.length} produced output`);
