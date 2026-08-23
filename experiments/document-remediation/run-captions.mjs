// Experiment 2 technique 1. Runs between OpenDataLoader and the finishing pass:
// the tagged PDF is where Figure elements exist, and the finishing pass only
// touches the catalog.
import { readdirSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';

const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17';
const [IN = 'out/phase3-tagged', OUT = 'out/e2-captioned'] = process.argv.slice(2);

mkdirSync(OUT, { recursive: true });
const rows = [];

for (const f of readdirSync(IN).filter((x) => x.endsWith('.pdf')).sort()) {
  const name = basename(f, '.pdf');
  const started = Date.now();
  let report = null, error = null;
  try {
    const out = execFileSync(`${JAVA_HOME}/bin/java`,
      ['-cp', 'vendor/pdfbox-app-3.0.8.jar:out/classes', 'Captions', join(IN, f), join(OUT, f)],
      { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
    report = JSON.parse(out.split('\n').at(-1));
  } catch (e) {
    error = (e.stderr?.toString() || String(e)).split('\n')[0];
  }
  rows.push({ document: name, ms: Date.now() - started, error, ...report,
              bytes: error ? null : statSync(join(OUT, f)).size });

  const r = rows.at(-1);
  console.log(
    name.padEnd(30),
    error ? `ERROR ${error}` :
    `${String(r.ms).padStart(4)}ms  images=${String(r.images).padStart(2)} figures=${String(r.figures).padStart(2)} ` +
    `located=${String(r.located).padStart(2)} unlocated=${String(r.unlocated).padStart(2)} applied=${r.applied} noCaption=${r.noCaption}`,
  );
}

writeFileSync(join(OUT, 'run.json'), JSON.stringify(rows, null, 2));
const applied = rows.reduce((a, r) => a + (r.applied ?? 0), 0);
const unlocated = rows.reduce((a, r) => a + (r.unlocated ?? 0), 0);
console.log(`\ncaptions applied: ${applied}   figures not locatable via MCID (left untouched): ${unlocated}`);
