// WCAG 1.4.3 across a directory. Reports; changes no file.
//
// Not a pipeline stage. Contrast is a property of the rendered page, not of the
// structure tree, so it neither consumes nor produces a remediated PDF — it sits
// beside validate.mjs rather than between two transformation passes.
//
// `Contrast.java` GRADUATED to `src/integrations/documents/java/` and is no
// longer here: stages graduate by moving, not copying, and the spike compiles
// against the moved source exactly as it does for `Inspect` and `StructText`.
// The graduated stage also drops the `sample` field this runner's output shows,
// because a summary carrying 30 glyphs of the measured text renders on a
// client's public report. Use `npm run build:documents` to compile it.
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';

const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17';
const [IN, OUT] = process.argv.slice(2);
if (!IN || !OUT) {
  console.error('usage: node run-contrast.mjs <pdfDir> <outDir>');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const rows = [];
for (const f of readdirSync(IN).filter((x) => x.endsWith('.pdf')).sort()) {
  const name = basename(f, '.pdf');
  let report = null, error = null;
  const started = Date.now();
  try {
    const out = execFileSync(`${JAVA_HOME}/bin/java`,
      ['-cp', 'vendor/pdfbox-app-3.0.8.jar:out/classes', 'Contrast', join(IN, f)],
      { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 }).toString().trim();
    report = JSON.parse(out.split('\n').at(-1));
  } catch (e) { error = (e.stderr?.toString() || String(e)).split('\n')[0]; }
  rows.push({ document: name, ms: Date.now() - started, error, ...report });
  const r = rows.at(-1);
  console.log(name.padEnd(30), error ? `ERROR ${error}`
    : `pairs=${String(r.pairs).padStart(3)} failing=${String(r.failing).padStart(2)} glyphs=${String(r.failingGlyphs).padStart(5)} undet=${String(r.undetermined).padStart(2)} ${r.failing ? '<-- 1.4.3' : ''}`);
  for (const d of r.findings ?? []) {
    console.log(`     ${d.fg} on ${d.bg}  ${d.ratio.toFixed(2)}:1 needs ${d.required}  ${d.glyphs} glyphs  "${d.sample.slice(0, 24)}"`);
  }
}

writeFileSync(join(OUT, 'run.json'), JSON.stringify(rows, null, 2));
const docs = rows.filter((r) => r.failing > 0).length;
console.log(`\n${docs}/${rows.length} documents fail 1.4.3; ${rows.reduce((a, r) => a + (r.failingGlyphs ?? 0), 0)} glyphs below threshold`);
