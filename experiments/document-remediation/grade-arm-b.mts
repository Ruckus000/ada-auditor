// Arm B's grader: the SAME dual bar as Arm A — the product's Inspect reading
// summarised with the product's own vocabulary, plus veraPDF UA-1 — so the
// two arms answer one question with one pair of instruments and the numbers
// are directly comparable. The spike's compare.mjs grades against generated
// ground truth only; this grades the deliverable question for every document,
// real ones included.
//
// The pipeline under test (ODL tagging + Finish) SUPPLIES a language rather
// than reading one — a documented limitation of that arm, so Arm A's
// invented-claims hard-zero deliberately does not apply here; the write-up
// carries the caveat instead.
//
// Usage: npx tsx grade-arm-b.mts <pdfDir> <outDir>
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectDocument } from '../../src/integrations/documents/inspect';
import { summarise } from '../../src/domain/document-remediation';

const SPIKE_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SPIKE_ROOT, '..', '..');
const VERAPDF = join(SPIKE_ROOT, 'vendor/verapdf/verapdf');
const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17';

const [pdfDir, outDir] = process.argv.slice(2);
if (!pdfDir || !outDir || !existsSync(VERAPDF)) {
  console.error('usage: npx tsx grade-arm-b.mts <pdfDir> <outDir>  (veraPDF must be fetched)');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

function verapdfUa1(pdf: string): { pass: boolean; failedRules: string[] } {
  const env = { ...process.env, JAVA_HOME, PATH: `${JAVA_HOME}/bin:${process.env.PATH}` };
  let stdout = '';
  try {
    stdout = execFileSync(VERAPDF, ['-f', 'ua1', '--format', 'text', pdf], { maxBuffer: 32 * 1024 * 1024, env }).toString('utf8');
  } catch (error) {
    stdout = (error as { stdout?: Buffer }).stdout?.toString('utf8') ?? '';
  }
  return {
    pass: /^PASS /m.test(stdout),
    failedRules: [...stdout.matchAll(/^\s+FAIL\s+\S*?((?:\d+\.)+\d+(?:-\d+)?)/gm)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i),
  };
}

const files = readdirSync(pdfDir).filter((f) => f.endsWith('.pdf')).sort();
let green = 0;
const byCriterion = new Map<string, number>();
const byPopulation = { generated: { n: 0, green: 0 }, real: { n: 0, green: 0 } };

for (const file of files) {
  const id = basename(file, '.pdf');
  const population = id.startsWith('real') ? 'real' : 'generated';
  byPopulation[population].n += 1;

  const read = await inspectDocument(join(pdfDir, file), { root: REPO_ROOT });
  const evidence: Record<string, unknown> = { document: id, population };
  if (!read.ok) {
    evidence.outcome = 'unreadable';
    evidence.failure = read.failure;
  } else {
    // The provenance is fabricated only where its fields are provenance-only
    // facts a post-hoc reading cannot know; the fields summarise() actually
    // gaps on must mirror what Inspect READ, or the grader manufactures gaps.
    // `[V]` The first grading pass passed sourceLanguage: null and every one
    // of 59 documents came back blocked by 3.1.1 — the finished files carry
    // /Lang=en, and the uniform verdict was the grader talking to itself.
    const summary = summarise({
      title: { kind: read.value.title ? 'already-titled' : 'no-heading-to-copy', title: read.value.title ?? '' },
      sourceLanguage: read.value.lang ?? null,
      structure: read.value,
    });
    const vera = verapdfUa1(join(pdfDir, file));
    const pass = summary.gaps.length === 0 && vera.pass;
    if (pass) { green += 1; byPopulation[population].green += 1; }
    for (const gap of summary.gaps) {
      const c = gap.split(':')[0];
      byCriterion.set(c, (byCriterion.get(c) ?? 0) + 1);
    }
    evidence.outcome = 'graded';
    evidence.summary = summary;
    evidence.verapdf = vera;
    evidence.deliverable = pass;
  }
  writeFileSync(join(outDir, `${id}.json`), JSON.stringify(evidence, null, 2) + '\n');
  console.log(`${id.padEnd(36)} ${evidence.outcome === 'graded' ? ((evidence as { deliverable?: boolean }).deliverable ? 'DELIVERABLE' : 'blocked: ' + ((evidence as { summary?: { gaps: string[] } }).summary?.gaps.map((g) => g.split(':')[0]).join(',') || 'ua1')) : 'UNREADABLE'}`);
}

console.log('\n== arm B summary ==');
console.log(`documents: ${files.length} · deliverable: ${green}`);
console.log(`generated: ${byPopulation.generated.green}/${byPopulation.generated.n} · real: ${byPopulation.real.green}/${byPopulation.real.n}`);
console.log('blocking criteria (documents carrying each):', JSON.stringify([...byCriterion.entries()].sort((a, b) => b[1] - a[1])));
