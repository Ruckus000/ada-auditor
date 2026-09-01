// Is the `7.1-9` title gap a product gap, or is it the corpus?
//
// The blind corpus renames every real document to `n02.pdf` / `r23.docx` so
// that a filename cannot leak a hint to the product or to a reader of the
// results. `JUNK_FILENAMES` in `src/domain/document-remediation.ts` refuses
// `^[a-z]{0,3}[\d .]*$`, which every one of those ids matches — so the
// FILENAME rung of the title chain has never fired on a real document in any
// campaign. Twenty-three delivered documents fail `7.1-9` (XMP `dc:title`),
// and we do not know how many of them would have carried a title in
// production.
//
// This answers that and nothing else. It builds nothing, and the outcome it is
// most likely to reach is "no product change is owed".
//
// No pre-registered decline criteria, deliberately: this decides nothing by a
// threshold. It counts, and the count is reported whichever way it falls.
//
// The product's own policy is the instrument — `titleFromFilename` is
// imported, never reimplemented, so "would a title be derived" is answered by
// the code that would derive it. Note what that does NOT establish: a derived
// title can still be a poor one. `titleFromFilename` is a provenance rule, not
// a quality judgement, and this measurement inherits exactly that limit.
//
// OUTPUT IS STRUCTURE ONLY. Per document it prints an outcome word and nothing
// else — never the filename, the URL, or the derived title. These are real
// documents from named public bodies and this output gets pasted into notes.
//
// Usage: npx tsx experiments/document-remediation/title-from-real-filenames.mts

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { titleFromFilename } from '../../src/domain/document-remediation';

const ROOT = join(import.meta.dirname, '..', '..');
const CORPUS = join(ROOT, 'experiments', 'document-remediation', 'blind-corpus');
const RESULTS = join(ROOT, '.doc-blind-test', 'latest.json');

/**
 * The client-facing name each document would have arrived under.
 *
 * The last path segment of the harvest URL, percent-decoded and stripped of a
 * query, which is what a browser download and an operator upload both produce.
 */
function clientNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const file of ['real-names.txt', 'new-names.txt']) {
    const path = join(CORPUS, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (line.startsWith('#')) continue;
      const [local, url] = line.trim().split(/\s+/, 2);
      if (local === undefined || url === undefined) continue;
      const segment = decodeURIComponent(url.split('?')[0].split('/').filter(Boolean).pop() ?? '');
      // Keyed by the id WITHOUT its extension, which is how a run records its
      // results. `measure-pdf-population.mts:34-39` keys the same map by the id
      // WITH the extension and reads it back without one, so its filename
      // column has always fallen through to the local id.
      names.set(local.replace(/\.[a-z0-9]+$/i, ''), segment);
    }
  }
  return names;
}

if (!existsSync(RESULTS)) {
  console.error(`no blind run to read at ${RESULTS} — run \`npm run blind:documents -- run\` first`);
  process.exit(2);
}

const { results } = JSON.parse(readFileSync(RESULTS, 'utf8')) as {
  results: Record<string, { independent?: { checked?: boolean; clauses?: string[] } }>;
};

const names = clientNames();
const rows: Array<{ id: string; derives: boolean; known: boolean }> = [];

for (const [id, result] of Object.entries(results).sort(([a], [b]) => a.localeCompare(b))) {
  // Real documents only. A planted fixture's name is one we wrote.
  if (!/^[nr]\d/.test(id)) continue;
  if (result.independent?.checked !== true) continue;
  if (!(result.independent.clauses ?? []).includes('7.1-9')) continue;

  const name = names.get(id);
  rows.push({
    id,
    known: name !== undefined,
    derives: name !== undefined && titleFromFilename(name) !== null,
  });
}

const derived = rows.filter((r) => r.derives).length;
const unknown = rows.filter((r) => !r.known).length;

for (const row of rows) {
  const outcome = !row.known ? 'NO HARVEST URL' : row.derives ? 'derives' : 'no title';
  console.log(`  ${row.id.padEnd(6)} ${outcome}`);
}
console.log();
console.log(`documents failing 7.1-9            : ${rows.length}`);
console.log(`  a real filename would have titled : ${derived}`);
console.log(`  no title from any rung of the chain: ${rows.length - derived - unknown}`);
if (unknown > 0) console.log(`  no harvest URL recorded           : ${unknown}`);
