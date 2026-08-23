// Phase 4: apply the category-A finishing pass to every phase-3 output.
//
// Language is supplied, not detected — see failure-classification.md. Every
// corpus document is primarily English, including 10, whose French passages
// are a minority of its body. That a single /Lang satisfies veraPDF for a
// document that is demonstrably bilingual is a finding, not an oversight.
import { readdirSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';

const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17';
const [IN = 'out/phase3-tagged', OUT = 'out/phase4-finished', LANG = 'en'] = process.argv.slice(2);

mkdirSync(OUT, { recursive: true });
const files = readdirSync(IN).filter((f) => f.endsWith('.pdf')).sort();
const rows = [];

for (const f of files) {
  const name = basename(f, '.pdf');
  const outPath = join(OUT, f);
  const started = Date.now();
  let error = null;
  try {
    execFileSync(`${JAVA_HOME}/bin/java`,
      ['-cp', `vendor/pdfbox-app-3.0.8.jar:out/classes`, 'Finish', join(IN, f), outPath, LANG],
      { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    error = (e.stderr?.toString() || String(e)).split('\n')[0];
  }
  const ms = Date.now() - started;
  rows.push({ document: name, ms, error, bytes: error ? null : statSync(outPath).size });
  console.log(name.padEnd(30), `${String(ms).padStart(5)}ms`, error ? `ERROR ${error}` : `ok ${rows.at(-1).bytes}`);
}

writeFileSync(join(OUT, 'run.json'), JSON.stringify(rows, null, 2));
console.log(`\n${rows.filter((r) => !r.error).length}/${rows.length} finished`);
