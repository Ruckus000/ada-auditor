// Global abstention, list half. Runs after figures and before the finishing pass.
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';

const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17';
const [IN = 'out/e2-figures', OUT = 'out/e2-lists'] = process.argv.slice(2);

mkdirSync(OUT, { recursive: true });
const rows = [];
for (const f of readdirSync(IN).filter((x) => x.endsWith('.pdf')).sort()) {
  const name = basename(f, '.pdf');
  let report = null, error = null;
  try {
    const out = execFileSync(`${JAVA_HOME}/bin/java`,
      ['-cp', 'vendor/pdfbox-app-3.0.8.jar:out/classes', 'Lists', join(IN, f), join(OUT, f)],
      { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
    report = JSON.parse(out.split('\n').at(-1));
  } catch (e) { error = (e.stderr?.toString() || String(e)).split('\n')[0]; }
  rows.push({ document: name, error, ...report });
  const r = rows.at(-1);
  console.log(name.padEnd(30), error ? `ERROR ${error}`
    : `lists=${String(r.lists).padStart(2)} untagged=${r.untagged} kept=${r.kept}`);
}
writeFileSync(join(OUT, 'run.json'), JSON.stringify(rows, null, 2));
console.log(`\nuntagged: ${rows.reduce((a, r) => a + (r.untagged ?? 0), 0)}`);
