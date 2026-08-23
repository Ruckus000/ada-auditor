// Renders the holdout corpus. Same approach as generate-corpus.mjs, plus one
// assembly path: a document with a `<name>.scan.html` sibling gets that page
// rasterised and spliced in, so text-layer and image-only pages coexist in one
// file. Not shared with the corpus generator — one caller each, and merging
// them would mean a mode flag threaded through both.
import { chromium } from 'playwright';
import { readdirSync, mkdirSync, writeFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, basename } from 'node:path';

const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17';
const PDFBOX = 'vendor/pdfbox-app-3.0.8.jar';
const OUT = 'out/holdout';
const pdfbox = (...args) => execFileSync(`${JAVA_HOME}/bin/java`, ['-jar', PDFBOX, ...args], { stdio: 'ignore' });

mkdirSync(OUT, { recursive: true });

const docs = readdirSync('holdout')
  .filter((f) => f.endsWith('.html') && !f.endsWith('.scan.html'))
  .sort();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.route('**/*', (r) => (r.request().url().startsWith('file:') ? r.continue() : r.abort()));

const rows = [];

for (const file of docs) {
  const name = basename(file, '.html');
  const pdfPath = `${OUT}/${name}.pdf`;
  const started = Date.now();

  const page = await context.newPage();
  await page.goto('file://' + resolve('holdout', file), { waitUntil: 'load' });
  const native = await page.pdf({ printBackground: true, preferCSSPageSize: true });
  await page.close();

  const scanSrc = resolve('holdout', `${name}.scan.html`);
  if (!existsSync(scanSrc)) {
    writeFileSync(pdfPath, native);
  } else {
    // Rasterise the exhibit page, then splice it between the native pages so
    // page 2 has no text layer while 1 and 3 do.
    const nativePath = `${OUT}/${name}.native.pdf`;
    writeFileSync(nativePath, native);

    const sp = await context.newPage();
    await sp.goto('file://' + scanSrc, { waitUntil: 'load' });
    await sp.screenshot({ path: `${OUT}/${name}.scan.png`, fullPage: true });
    await sp.close();
    pdfbox('fromimage', '-i', `${OUT}/${name}.scan.png`, '-o', `${OUT}/${name}.scan.pdf`, '-pageSize', 'A4', '-resize');

    pdfbox('split', '-i', nativePath, '-outputPrefix', `${OUT}/${name}.part`);
    pdfbox('merge',
      '-i', `${OUT}/${name}.part-1.pdf`,
      '-i', `${OUT}/${name}.scan.pdf`,
      '-i', `${OUT}/${name}.part-2.pdf`,
      '-o', pdfPath);

    // Every intermediate goes, not just the split parts. The scan PDF is a
    // valid one-page document sitting in the output directory, so leaving it
    // behind silently added a seventeenth "document" to the corpus that later
    // phases dutifully tagged, finished and validated.
    for (const tmp of readdirSync(OUT).filter(
      (f) => f.startsWith(`${name}.`) && f !== `${name}.pdf`,
    )) {
      rmSync(`${OUT}/${tmp}`);
    }
  }

  rows.push({ name, ms: Date.now() - started, bytes: statSync(pdfPath).size });
  console.log(rows.at(-1).name.padEnd(32), String(rows.at(-1).bytes).padStart(8), `${rows.at(-1).ms}ms`);
}

await browser.close();
writeFileSync(`${OUT}/generation.json`, JSON.stringify(rows, null, 2));
console.log(`\n${rows.length} holdout documents`);
