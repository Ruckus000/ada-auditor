// Arm A of the remediation test: every Word document through the real
// conversion pipeline, graded by two instruments and, where truth exists, by
// fidelity to the source's own structure.
//
// Per document this writes one evidence JSON to <outDir>/evidence — outcome,
// provenance, the pipeline's own Inspect reading (summarised with the
// product's `summarise`, so gap vocabulary cannot drift from what a client
// sees), the veraPDF UA-1 verdict, fidelity vs the truth file, wall time and
// hashes. Aggregation is a separate read of that directory, per the spike's
// report pattern.
//
// The pass bar is BOTH instruments: zero machine gaps from Inspect AND a
// veraPDF UA-1 pass. `instrument-correction.md` records why one is not
// enough.
//
// Usage: npx tsx run-conversion-arm.mts <docxDir> <outDir> [--keys <keysDir>] [--truth <truthDir>]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { convertSourceToPdf } from '../../src/integrations/documents/convert';
import { summarise } from '../../src/domain/document-remediation';

// cwd-independent: the JVM stages resolve their classpath from `root`, and
// the first full run refused all 30 documents because the runner's cwd was
// the spike directory rather than the repo. Paths are anchored to this file.
const SPIKE_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SPIKE_ROOT, '..', '..');
const VERAPDF = join(SPIKE_ROOT, 'vendor/verapdf/verapdf');
if (!existsSync(VERAPDF)) {
  console.error('veraPDF is not fetched — run fetch-tools.sh first. The pass bar needs both instruments.');
  process.exit(2);
}

const args = process.argv.slice(2);
const [docxDir, outDir] = args;
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};
if (!docxDir || !outDir) {
  console.error('usage: npx tsx run-conversion-arm.mts <docxDir> <outDir> [--keys d] [--truth d]');
  process.exit(2);
}
const keysDir = opt('keys');
const truthDir = opt('truth');

const pdfDir = join(outDir, 'pdf');
const evidenceDir = join(outDir, 'evidence');
mkdirSync(pdfDir, { recursive: true });
mkdirSync(evidenceDir, { recursive: true });

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** veraPDF UA-1: pass/fail plus the failed-rule clauses, compact. */
function verapdfUa1(pdf: string): { pass: boolean; failedRules: string[] } {
  // The launcher shells out to `java` from its environment, and on this
  // machine that intermittently resolved to the macOS stub that only prints
  // an install prompt. Pinned to the same JDK the build scripts use.
  const JAVA_HOME = process.env.JAVA_HOME ?? '/opt/homebrew/opt/openjdk@17';
  const env = { ...process.env, JAVA_HOME, PATH: `${JAVA_HOME}/bin:${process.env.PATH}` };
  let stdout = '';
  try {
    stdout = execFileSync(VERAPDF, ['-f', 'ua1', '--format', 'text', pdf], {
      maxBuffer: 32 * 1024 * 1024,
      env,
    }).toString('utf8');
  } catch (error) {
    // veraPDF exits non-zero on a failed validation; the report is on stdout.
    stdout = (error as { stdout?: Buffer }).stdout?.toString('utf8') ?? '';
  }
  const pass = /^PASS /m.test(stdout);
  const failedRules = [...stdout.matchAll(/^\s+FAIL\s+\S*?((?:\d+\.)+\d+(?:-\d+)?)/gm)]
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i);
  return { pass, failedRules };
}

const gapCriterion = (gap: string) => gap.split(':')[0];

const files = readdirSync(docxDir)
  .filter((f) => f.endsWith('.docx') || f.endsWith('.doc'))
  .sort();
console.log(`${files.length} documents from ${docxDir}`);

let delivered = 0;
let bothGreen = 0;
let refused = 0;
let keyViolations = 0;
let inventedClaims = 0;

for (const file of files) {
  const id = basename(file).replace(/\.docx?$/, '');
  const source = join(docxDir, file);
  const output = join(pdfDir, `${id}.pdf`);

  const t0 = Date.now();
  const result = await convertSourceToPdf(source, output, { root: REPO_ROOT });
  const wallMs = Date.now() - t0;

  const evidence: Record<string, unknown> = {
    document: id,
    inputSha256: sha256(source),
    wallMs,
  };

  const key = keysDir && existsSync(join(keysDir, `${id}.key.json`))
    ? JSON.parse(readFileSync(join(keysDir, `${id}.key.json`), 'utf8'))
    : null;
  const truth = truthDir && existsSync(join(truthDir, `${id}.truth.json`))
    ? JSON.parse(readFileSync(join(truthDir, `${id}.truth.json`), 'utf8'))
    : null;
  const violations: string[] = [];

  if (!result.ok) {
    refused += 1;
    evidence.outcome = 'refused';
    evidence.refusal = result.failure;
    if (key) {
      if (key.expected.outcome !== 'refused') violations.push(`expected ${key.expected.outcome}, was refused: ${JSON.stringify(result.failure)}`);
      else if (key.expected.refusal && result.failure.kind !== key.expected.refusal) violations.push(`expected refusal ${key.expected.refusal}, got ${result.failure.kind}`);
      else if (key.expected.refusalOneOf && !key.expected.refusalOneOf.includes(result.failure.kind)) violations.push(`refusal ${result.failure.kind} not in ${key.expected.refusalOneOf}`);
    }
  } else {
    delivered += 1;
    const summary = summarise(result.provenance);
    const vera = verapdfUa1(output);
    const pass = summary.gaps.length === 0 && vera.pass;
    if (pass) bothGreen += 1;

    evidence.outcome = 'delivered';
    evidence.outputSha256 = sha256(output);
    evidence.summary = summary;
    evidence.verapdf = vera;
    evidence.bothInstrumentsGreen = pass;

    // The non-negotiables, checked on EVERY delivery whether or not a key
    // exists: an invented claim is a hard fail of the whole test.
    const srcLang = key ? key.planted?.language ?? null : truth ? truth.language : undefined;
    if (srcLang !== undefined && summary.sourceLanguage !== srcLang) {
      violations.push(`INVENTED language: source declares ${JSON.stringify(srcLang)}, output claims ${JSON.stringify(summary.sourceLanguage)}`);
      inventedClaims += 1;
    }
    const srcTitle = key ? (key.planted?.title?.trim() || null) : truth ? truth.title : undefined;
    if (srcTitle !== undefined) {
      const expectProvenance = srcTitle !== null ? 'already-titled' : (key?.expected.title ?? (truth && truth.headingLevels?.[0] === 1 ? 'transcribed' : 'no-heading-to-copy'));
      if (summary.title !== expectProvenance) {
        violations.push(`title provenance: expected ${expectProvenance}, got ${summary.title}`);
        if (summary.title === 'already-titled' && srcTitle === null) inventedClaims += 1;
      }
    }

    if (key?.expected.outcome === 'delivered') {
      for (const k of ['headings', 'tables', 'lists', 'figures'] as const) {
        if (summary[k] !== key.expected[k]) violations.push(`${k}: expected ${key.expected[k]}, got ${summary[k]}`);
      }
      const got = summary.gaps.map(gapCriterion).sort();
      const want = [...(key.expected.gaps ?? [])].sort();
      if (JSON.stringify(got) !== JSON.stringify(want)) violations.push(`gaps: expected [${want}], got [${got}]`);
      if (key.expected.titleText && result.provenance.title.kind === 'transcribed' && result.provenance.title.title !== key.expected.titleText) {
        violations.push(`transcribed title text drifted`);
      }
    } else if (key) {
      violations.push(`expected ${key.expected.outcome}, was delivered`);
    }

    // Fidelity vs source truth (real documents especially): structure must
    // survive, not merely something plausible.
    if (truth?.readable) {
      const fidelity: Record<string, unknown> = {};
      for (const k of ['headings', 'tables', 'lists', 'figures'] as const) {
        fidelity[k] = { source: truth[k], delivered: summary[k], preserved: truth[k] === summary[k] };
      }
      evidence.fidelity = fidelity;
    }
  }

  if (violations.length > 0) keyViolations += 1;
  evidence.violations = violations;
  writeFileSync(join(evidenceDir, `${id}.json`), JSON.stringify(evidence, null, 2) + '\n');
  const mark = violations.length > 0 ? 'VIOLATION' : (evidence.outcome === 'refused' ? 'refused ok' : (evidence as { bothInstrumentsGreen?: boolean }).bothInstrumentsGreen ? 'green' : 'gapped');
  console.log(`${id.padEnd(28)} ${String(evidence.outcome).padEnd(9)} ${String(wallMs).padStart(6)}ms  ${mark}${violations.length ? ' — ' + violations[0] : ''}`);
}

console.log('\n== arm A summary ==');
console.log(`documents: ${files.length} · delivered: ${delivered} · refused: ${refused}`);
console.log(`both instruments green: ${bothGreen}/${delivered}`);
console.log(`documents with violations: ${keyViolations}`);
console.log(`INVENTED CLAIMS (hard fail if > 0): ${inventedClaims}`);
process.exit(inventedClaims > 0 ? 1 : 0);
