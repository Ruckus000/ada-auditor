// Phase 0 of the PDF repair work: what a real municipal PDF population
// actually contains, so the scope of transcription-only repair is measured
// rather than assumed.
//
// Reads only. Nothing here writes a PDF — this answers "how many documents
// could an honest repair reach", and is allowed to answer "not many".
//
// Usage: npx tsx measure-pdf-population.mts <pdfDir> <harvestMap> [outJson]

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { inspectDocument } from '../../src/integrations/documents/inspect';
import { isTagged } from '../../src/domain/document-structure';
import { summarise, titleFromFilename } from '../../src/domain/document-remediation';

const [pdfDir, harvestMap, outJson] = process.argv.slice(2);
if (!pdfDir || !harvestMap) {
  console.error('usage: npx tsx measure-pdf-population.mts <pdfDir> <harvestMap> [outJson]');
  process.exit(2);
}

// The repo root, not the cwd. `resolveJavaRuntime` anchors the compiled
// classes on it, and a runner started from this directory otherwise reports
// every document `unavailable` — a uniform verdict, which in this project is
// always the instrument rather than the population.
const ROOT = join(import.meta.dirname, '..', '..');
const VERAPDF = join(import.meta.dirname, 'vendor', 'verapdf', 'verapdf');
const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17';

/** The client-facing name for each local file — what a filename-derived title would read. */
const nameOf = new Map<string, string>();
for (const line of readFileSync(harvestMap, 'utf8').split('\n')) {
  const [local, url] = line.trim().split(/\s+/, 2);
  if (local && url) {
    nameOf.set(local, decodeURIComponent(url.split('?')[0].split('/').filter(Boolean).pop() ?? ''));
  }
}

/** veraPDF UA-1 failed clauses, via the JSON report — the text format names none. */
function ua1Clauses(pdf: string): string[] | null {
  if (!existsSync(VERAPDF)) return null;
  const env = { ...process.env, JAVA_HOME, PATH: `${JAVA_HOME}/bin:${process.env.PATH}` };
  let raw = '';
  try {
    raw = execFileSync(VERAPDF, ['-f', 'ua1', '--format', 'json', pdf], {
      maxBuffer: 64 * 1024 * 1024,
      env,
    }).toString('utf8');
  } catch (error) {
    const e = error as { status?: number; stdout?: Buffer };
    if (e.status !== 1 || !e.stdout?.length) return null;
    raw = e.stdout.toString('utf8');
  }
  const result = JSON.parse(raw).report.jobs[0]?.validationResult?.[0];
  const summaries = (result?.details?.ruleSummaries ?? []) as Array<{
    clause: string;
    testNumber: number;
    failedChecks: number;
  }>;
  return summaries
    .filter((r) => r.failedChecks > 0)
    .map((r) => `${r.clause}-${r.testNumber}`);
}

const rows = [];
for (const file of readdirSync(pdfDir).filter((f) => f.endsWith('.pdf')).sort()) {
  const path = join(pdfDir, file);
  const id = basename(file, '.pdf');
  const read = await inspectDocument(path, { root: ROOT });
  if (!read.ok) {
    rows.push({ id, unreadable: read.failure.kind });
    console.log(`${id.padEnd(24)} UNREADABLE ${read.failure.kind}`);
    continue;
  }
  const s = read.value;
  const tagged = isTagged(s);

  // The title chain exactly as Phase 2 would apply it: what the document
  // states, then what it displays, then what it is called. Never invented.
  const clientName = nameOf.get(id) ?? file;
  const fromFilename = titleFromFilename(clientName);
  const firstHeading = s.headingTexts.find((h) => (h.text ?? '').trim() !== '')?.text ?? null;
  const titleSource =
    s.title !== null && s.title.trim() !== ''
      ? 'docinfo'
      : firstHeading !== null
        ? 'first-heading'
        : fromFilename !== null
          ? 'filename'
          : 'none';

  // The punch list, from the product's own summariser — claim 3 under test.
  const summary = summarise({
    title:
      s.title === null ? { kind: 'no-heading-to-copy' } : { kind: 'already-titled', title: s.title },
    sourceLanguage: s.lang,
    structure: s,
  });

  const clauses = ua1Clauses(path) ?? [];
  const fontClauses = clauses.filter((c) => c.startsWith('7.21'));

  rows.push({
    id,
    pages: s.pages,
    tagged,
    marked: s.marked,
    claimsFalsely: s.marked && !tagged,
    structureElements: s.structureElements,
    headings: s.headings.length,
    figures: s.figures.length,
    figuresNoAlt: s.figures.filter((f) => f.alt === null).length,
    docinfoTitle: s.title !== null && s.title.trim() !== '',
    titleSource,
    lang: s.lang,
    needs: summary.needs?.length ?? 0,
    gaps: summary.gaps.map((g) => g.split(':')[0]),
    ua1Clauses: clauses,
    fontBlocked: fontClauses.length > 0,
  });

  console.log(
    `${id.padEnd(24)} ${tagged ? 'TAGGED  ' : 'untagged'} el=${String(s.structureElements).padStart(5)} ` +
      `h=${String(s.headings.length).padStart(3)} fig=${String(s.figures.length).padStart(3)} ` +
      `title=${titleSource.padEnd(13)} needs=${String(summary.needs?.length ?? 0).padStart(3)} ` +
      `${s.marked && !tagged ? 'CLAIMS-FALSELY ' : ''}${fontClauses.length > 0 ? 'font-blocked' : ''}`,
  );
}

const readable = rows.filter((r) => !('unreadable' in r)) as Array<Record<string, never>> &
  Array<{ tagged: boolean; titleSource: string; needs: number; claimsFalsely: boolean; fontBlocked: boolean; figuresNoAlt: number }>;
const taggedCount = readable.filter((r) => r.tagged).length;
console.log(`\n== population: ${rows.length} documents, ${readable.length} readable ==`);
console.log(
  `tagged: ${taggedCount}/${readable.length} (${Math.round((100 * taggedCount) / readable.length)}%)`,
);
console.log(
  `title derivable: ${readable.filter((r) => r.titleSource !== 'none').length}/${readable.length}` +
    ` — docinfo ${readable.filter((r) => r.titleSource === 'docinfo').length}` +
    `, heading ${readable.filter((r) => r.titleSource === 'first-heading').length}` +
    `, filename ${readable.filter((r) => r.titleSource === 'filename').length}` +
    `, none ${readable.filter((r) => r.titleSource === 'none').length}`,
);
console.log(
  `punch items populated: ${readable.filter((r) => r.needs > 0).length} documents` +
    ` (of ${readable.filter((r) => r.figuresNoAlt > 0).length} with undescribed figures)`,
);
console.log(`documents claiming Marked with no tree: ${readable.filter((r) => r.claimsFalsely).length}`);
console.log(`font-blocked: ${readable.filter((r) => r.fontBlocked).length}`);

if (outJson) {
  writeFileSync(outJson, JSON.stringify(rows, null, 2));
  console.log(`\nrows -> ${outJson}`);
}
