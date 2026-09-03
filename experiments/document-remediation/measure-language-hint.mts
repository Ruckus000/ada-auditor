// The language hint, measured over the real PDFs of the blind corpus —
// `docs/research/document-remediation/language-hint-predictions.md` names
// the calls this script decides.
//
// Reads only. Every document is inspected once; the hint is scored from the
// structure the product already emits; the declared `/Lang` is the proxy for
// the written language where it is usable. Prints tags and counts and never
// a word of any document: these are municipal records naming real people.
//
// Usage: JAVA_HOME=/opt/homebrew/opt/openjdk@17 npx tsx measure-language-hint.mts <pdfDir> [outJson]

import { readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { languageToCarry } from '../../src/domain/document-structure';
import { HINT_FLOOR, HINT_MARGIN, languageHint, scoreLanguages } from '../../src/domain/language-hint';
import { inspectDocument } from '../../src/integrations/documents/inspect';

const [pdfDir, outJson] = process.argv.slice(2);
if (!pdfDir) {
  console.error('usage: npx tsx measure-language-hint.mts <pdfDir> [outJson]');
  process.exit(2);
}

// The repo root, not the cwd: `resolveJavaRuntime` anchors the compiled
// classes on it, and a runner started from this directory otherwise reports
// every document `unavailable` — a uniform verdict, always the instrument.
const ROOT = join(import.meta.dirname, '..', '..');

/** The documents the predictions name as raising the ask. */
const FLOOR_DOCUMENTS = ['n05', 'n22', 'n23', 'n30', 'r06', 'r10', 'r14'];

const primary = (tag: string) => tag.split('-')[0].toLowerCase();

type Row = {
  id: string;
  unreadable?: string;
  declared?: string | null;
  asks?: boolean;
  hint?: { suggested: string; evidence: number } | null;
  top?: Array<{ tag: string; count: number }>;
  agrees?: boolean | null;
  headings?: number;
  orderEntries?: number;
};

const rows: Row[] = [];
const started = Date.now();
for (const file of readdirSync(pdfDir).filter((f) => /^[rn]\d+\.pdf$/.test(f)).sort()) {
  const id = basename(file, '.pdf');
  const read = await inspectDocument(join(pdfDir, file), { root: ROOT });
  if (!read.ok) {
    rows.push({ id, unreadable: read.failure.kind });
    console.log(`${id.padEnd(6)} UNREADABLE ${read.failure.kind}`);
    continue;
  }
  const s = read.value;
  const declared = languageToCarry(s.lang);
  const hint = languageHint(s);
  const top = scoreLanguages(s).slice(0, 2);
  const agrees = declared === null || hint === null ? null : primary(declared) === hint.suggested;
  rows.push({
    id,
    declared,
    asks: declared === null,
    hint,
    top,
    agrees,
    headings: s.headings.length,
    orderEntries: s.order.length,
  });
  const scores = top.map((t) => `${t.tag}=${t.count}`).join(' ');
  console.log(
    `${id.padEnd(6)} declared=${String(declared ?? 'none').padEnd(6)} ` +
      `${hint === null ? 'abstained' : `hint=${hint.suggested} (${hint.evidence})`}`.padEnd(22) +
      ` ${agrees === null ? '' : agrees ? 'agrees' : 'DISAGREES'}`.padEnd(11) +
      ` top: ${scores} · h=${s.headings.length} order=${s.order.length}`,
  );
}
const wallMs = Date.now() - started;

const readable = rows.filter((r) => r.unreadable === undefined);
const usable = readable.filter((r) => r.declared !== null);
const fired = usable.filter((r) => r.hint !== null);
const agreeing = fired.filter((r) => r.agrees === true);
const floor = readable.filter((r) => r.asks);
const floorFired = floor.filter((r) => r.hint !== null);
const named = FLOOR_DOCUMENTS.map((id) => rows.find((r) => r.id === id));
const namedFired = named.filter((r) => r !== undefined && r.hint !== null);

// Prediction 3: a null hint is always explained by the numbers.
const unexplainedAbstentions = readable.filter((r) => {
  if (r.hint !== null || r.top === undefined) return false;
  const [winner, runnerUp] = r.top;
  if (winner === undefined || winner.count < HINT_FLOOR) return false;
  if (runnerUp !== undefined && winner.count < HINT_MARGIN * runnerUp.count) return false;
  return winner.tag !== 'ja';
});

const pct = (n: number, d: number) => (d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`);
console.log(`\n== ${rows.length} documents, ${readable.length} readable, ${wallMs} ms ==`);
console.log(`usable /Lang: ${usable.length} · hint fired on ${fired.length} · agreed ${agreeing.length} (${pct(agreeing.length, fired.length)}) · abstained ${usable.length - fired.length}`);
console.log(`raise the ask: ${floor.length} of ${readable.length} (${pct(floor.length, readable.length)}) · hint fired on ${floorFired.length}`);
console.log(`the seven named: fired on ${namedFired.length} of ${named.filter((r) => r !== undefined).length} present`);
console.log(`abstentions the floor and margin do not explain: ${unexplainedAbstentions.length}`);
for (const r of floor) {
  console.log(`  ${r.id} ${r.hint === null ? 'abstained' : `${r.hint.suggested} (${r.hint.evidence})`} · top ${r.top!.map((t) => `${t.tag}=${t.count}`).join(' ')} · h=${r.headings} order=${r.orderEntries}`);
}

if (outJson) {
  writeFileSync(outJson, JSON.stringify({ wallMs, rows }, null, 2));
  console.log(`\nrows -> ${outJson}`);
}
