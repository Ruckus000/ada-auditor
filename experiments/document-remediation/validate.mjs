// Runs veraPDF over a directory of PDFs and writes raw output plus a summary.
//
// Used by phases 2, 3 and 5 — three real repeats with the same meaning, which
// is why this is a shared script rather than three copies.
//
// Both flavours are run on every file. wt1a is the PDF Association's
// Well-Tagged PDF profile, which is what OpenDataLoader's free tier targets;
// ua1 is what the product promise needs. The delta between them IS the
// open-core gap, measured rather than inferred.
//
// Usage: node validate.mjs <pdfDir> <outDir>
import { readdirSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';

const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17';
const VERAPDF = 'vendor/verapdf/verapdf';
const PDFBOX = 'vendor/pdfbox-app-3.0.8.jar';
const FLAVOURS = ['ua1', 'wt1a'];

const [pdfDir, outDir] = process.argv.slice(2);
if (!pdfDir || !outDir) {
  console.error('usage: node validate.mjs <pdfDir> <outDir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

// The page tree's /Count. veraPDF's feature extractor collapses multi-page
// reports into a single entry, and PDFBox has no page-count subcommand, so
// read it out of the file.
//
// Reading the raw bytes is not enough: PDFBox writes its own output with
// object streams, so document 09's catalogue is compressed and no /Count is
// visible. Decoding first costs a subprocess and makes the count work on every
// file rather than eleven of twelve.
function pageCount(file) {
  const decoded = `${file}.decoded`;
  try {
    execFileSync(`${JAVA_HOME}/bin/java`, ['-jar', PDFBOX, 'decode', '-skipImages', file, decoded], {
      stdio: 'ignore',
    });
    const text = readFileSync(decoded).toString('latin1');
    // Count page objects rather than trusting /Count, which also appears on
    // outline trees and would win a naive maximum.
    const pages = text.match(/\/Type\s*\/Page[^s]/g);
    return pages ? pages.length : null;
  } catch {
    return null;
  } finally {
    rmSync(decoded, { force: true });
  }
}

function validate(file, flavour) {
  const started = Date.now();
  let raw;
  try {
    raw = execFileSync(VERAPDF, ['-f', flavour, '--format', 'json', file], {
      env: { ...process.env, JAVA_HOME },
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
  } catch (e) {
    // veraPDF exits 1 when a file is non-compliant. That is the answer we are
    // here for, not a failure to get one, and the report is on stdout either
    // way. Anything above 1 is a genuine error — a parse failure, an
    // out-of-memory, a bad flavour — and must not be swallowed into a row that
    // reads like a clean validation.
    if (e.status !== 1 || !e.stdout?.length) {
      throw new Error(`veraPDF ${flavour} on ${file} exited ${e.status}`, { cause: e });
    }
    raw = e.stdout.toString();
  }
  const wallMs = Date.now() - started;

  const job = JSON.parse(raw).report.jobs[0];
  const result = job.validationResult?.[0];
  const details = result?.details ?? {};

  return {
    raw,
    wallMs,
    compliant: result?.compliant ?? false,
    passedChecks: details.passedChecks ?? 0,
    failedChecks: details.failedChecks ?? 0,
    rules: (details.ruleSummaries ?? []).map((r) => ({
      id: `${r.clause}-${r.testNumber}`,
      failed: r.failedChecks,
      description: r.description,
    })),
  };
}

const files = readdirSync(pdfDir).filter((f) => f.endsWith('.pdf')).sort();
const summary = [];

for (const f of files) {
  const path = join(pdfDir, f);
  const name = basename(f, '.pdf');
  const row = { document: name, pages: pageCount(path), bytes: statSync(path).size };

  for (const flavour of FLAVOURS) {
    const r = validate(path, flavour);
    writeFileSync(join(outDir, `${name}.${flavour}.json`), r.raw);
    row[flavour] = {
      compliant: r.compliant,
      passedChecks: r.passedChecks,
      failedChecks: r.failedChecks,
      wallMs: r.wallMs,
      rules: r.rules,
    };
  }
  summary.push(row);
  console.log(
    name.padEnd(30),
    `pages=${String(row.pages).padStart(2)}`,
    `ua1 ${row.ua1.compliant ? 'PASS' : 'FAIL'} failed=${String(row.ua1.failedChecks).padStart(3)}`,
    `wt1a ${row.wt1a.compliant ? 'PASS' : 'FAIL'} failed=${String(row.wt1a.failedChecks).padStart(3)}`,
  );
}

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\nsummary -> ${join(outDir, 'summary.json')}`);
