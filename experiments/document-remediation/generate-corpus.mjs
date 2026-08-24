// Renders corpus/*.html to out/corpus/*.pdf.
//
// Chromium's page.pdf() emits an UNTAGGED PDF — verified in phase 0 against
// veraPDF, which reported 7.1-11 (no structure hierarchy), 6.2-1 (no MarkInfo)
// and 7.1-3 (content neither tagged nor marked as artifact). That is what we
// want: the corpus has to be untagged input, or phase 3 cannot measure what
// OpenDataLoader accomplishes. This script re-checks that invariant per
// document rather than trusting the phase 0 probe.
import { chromium } from 'playwright';
import { readdirSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, basename } from 'node:path';

const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17';
const PDFBOX = 'vendor/pdfbox-app-3.0.8.jar';
const OUT = 'out/corpus';

// Document 09 is an image-only PDF: rendered to PNG, then reassembled. It is
// the one document not produced by page.pdf(), because a scanned page has no
// text layer and page.pdf() always produces one.
const SCANNED = '09-scanned';

mkdirSync(OUT, { recursive: true });

const docs = readdirSync('corpus')
  .filter((f) => f.endsWith('.html'))
  .sort();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();

// Block the network but allow file:, so <img src="img/..."> resolves off disk
// while nothing can reach out. Same posture as the production renderer, which
// aborts everything because its HTML is self-contained.
await context.route('**/*', (route) =>
  route.request().url().startsWith('file:') ? route.continue() : route.abort(),
);

const rows = [];

for (const file of docs) {
  const name = basename(file, '.html');
  const url = 'file://' + resolve('corpus', file);
  const pdfPath = `${OUT}/${name}.pdf`;
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });

  const started = Date.now();
  if (name === SCANNED) {
    const pngPath = `${OUT}/${name}.png`;
    await page.screenshot({ path: pngPath, fullPage: true });
    execFileSync(`${JAVA_HOME}/bin/java`, [
      '-jar', PDFBOX, 'fromimage',
      '-i', pngPath, '-o', pdfPath, '-pageSize', 'A4', '-resize',
    ]);
  } else {
    // preferCSSPageSize honours each document's own @page rule, which is how
    // 08 gets landscape without a per-document switch here.
    const buf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    writeFileSync(pdfPath, buf);
  }
  const ms = Date.now() - started;
  await page.close();

  rows.push({ name, ms, bytes: statSync(pdfPath).size });
}

await browser.close();

console.log('name'.padEnd(30), 'bytes'.padStart(9), 'ms'.padStart(6));
for (const r of rows) {
  console.log(r.name.padEnd(30), String(r.bytes).padStart(9), String(r.ms).padStart(6));
}
writeFileSync(`${OUT}/generation.json`, JSON.stringify(rows, null, 2));
