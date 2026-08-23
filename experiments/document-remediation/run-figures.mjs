// Experiment 2 technique 6. Runs after headings and before the finishing pass.
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';

const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17';
const [IN = 'out/e2-headings', OUT = 'out/e2-figures'] = process.argv.slice(2);

mkdirSync(OUT, { recursive: true });
const rows = [];
for (const f of readdirSync(IN).filter((x) => x.endsWith('.pdf')).sort()) {
  const name = basename(f, '.pdf');
  let report = null, error = null;
  try {
    const out = execFileSync(`${JAVA_HOME}/bin/java`,
      ['-cp', 'vendor/pdfbox-app-3.0.8.jar:out/classes', 'Figures', join(IN, f), join(OUT, f)],
      { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
    report = JSON.parse(out.split('\n').at(-1));
  } catch (e) { error = (e.stderr?.toString() || String(e)).split('\n')[0]; }
  rows.push({ document: name, error, ...report });
  const r = rows.at(-1);
  console.log(name.padEnd(30), error ? `ERROR ${error}`
    : `figures=${String(r.figures).padStart(2)} described=${r.described} unlocated=${r.unlocated} thinBand=${r.thinBand} repeated=${r.repeated} artifacted=${r.artifacted} kept=${r.kept}`);
}
writeFileSync(join(OUT, 'run.json'), JSON.stringify(rows, null, 2));
console.log(`\nartifacted: ${rows.reduce((a, r) => a + (r.artifacted ?? 0), 0)}`);
