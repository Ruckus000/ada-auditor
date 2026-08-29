/**
 * Drives the document blind corpus through the product's own front door.
 *
 * Two subcommands, deliberately separate:
 *
 *   npx tsx scripts/doc-blind-test/run.ts run     # posts every document, prints progress only
 *   npx tsx scripts/doc-blind-test/run.ts score   # grades what the run recorded
 *
 * The split is the no-peeking rule made structural. Reading results while a
 * run is still going invites stopping at the first disappointment and calling
 * the rest unaffected, and the whole corpus takes minutes.
 *
 * Documents go through `POST /api/documents/remediate` on a real `next start`,
 * not through the library. A route that accepts what it should refuse is a
 * defect the library can never show, and the door is half of what this
 * campaign measures.
 */
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  type Correction,
  type DocKey,
  type RunResult,
  exitCode,
  renderScore,
  scoreRun,
} from './score';

const execFileAsync = promisify(execFile);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORPUS = join(ROOT, 'experiments', 'document-remediation', 'blind-corpus');
const KEYS = join(CORPUS, 'keys');
const RESULTS = join(ROOT, '.doc-blind-test');
const VERAPDF = join(ROOT, 'vendor', 'verapdf', 'cli.jar');

const PORT = 3419;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'doc-blind-test-token-0123456789';

// --------------------------------------------------------------- the corpus

function loadKeys(): DocKey[] {
  return readdirSync(KEYS)
    .filter((f) => f.endsWith('.key.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(KEYS, f), 'utf8')) as DocKey);
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function documentPath(key: DocKey): string {
  const planted = join(CORPUS, 'docs', key.file);
  return existsSync(planted) ? planted : join(CORPUS, 'real', key.file);
}

/**
 * Nothing runs until the corpus is the corpus the keys were written against.
 *
 * A key edited after a disappointing run is the one failure mode a blind test
 * cannot survive, and a document quietly regenerated is the same failure
 * wearing different clothes.
 */
function verifyHashes(keys: DocKey[]): void {
  const wrong: string[] = [];
  for (const key of keys) {
    const path = documentPath(key);
    if (!existsSync(path)) {
      wrong.push(`${key.id}: ${key.file} is missing`);
      continue;
    }
    const actual = sha256(readFileSync(path));
    if (actual !== key.sha256) wrong.push(`${key.id}: ${key.file} does not match its key`);
  }
  if (wrong.length > 0) {
    console.error('the corpus does not match the keys:');
    for (const line of wrong) console.error(`  ${line}`);
    process.exit(2);
  }
}

// ----------------------------------------------------------------- the app

async function waitForServer(instance: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) {
        const health = (await response.json()) as { instance?: string };
        // The port could be somebody else's server, and driving a foreign one
        // would produce a run that looks fine and measures another tree.
        if (health.instance === instance) return;
        throw new Error(`another server answers on ${PORT}`);
      }
    } catch (error) {
      if (String(error).includes('another server')) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`no server on ${PORT} after two minutes`);
}

function startServer(instance: string) {
  if (!existsSync(join(ROOT, '.next'))) {
    console.error('no .next — run `npm run build` first; this drives the built app, not the dev server');
    process.exit(2);
  }
  return spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AUDITOR_RUN_TOKEN: TOKEN,
      AUDITOR_INSTANCE_ID: instance,
      AUDITOR_STORE: 'memory',
      AUDITOR_OPERATOR_NAME: 'Blind Test',
      DATABASE_URL: '',
      AUDITOR_CREDENTIAL_KEY: 'ab'.repeat(32),
      AUDITOR_RP_ID: 'localhost',
      AUDITOR_RP_ORIGIN: BASE,
    },
  });
}

// ------------------------------------------------------------- one document

async function post(key: DocKey, bytes: Buffer): Promise<RunResult> {
  const started = Date.now();
  const request = (key as DocKey & { request?: Record<string, string> }).request ?? {};

  const headers: Record<string, string> = {};
  if (request.auth === 'wrong') headers.authorization = 'Bearer not-the-token-at-all-0123456789';
  else if (request.auth !== 'none') headers.authorization = `Bearer ${TOKEN}`;

  let body: BodyInit;
  if (request.body === 'json') {
    headers['content-type'] = 'application/json';
    body = JSON.stringify({ file: 'a document, but not a form' });
  } else {
    const form = new FormData();
    const file = new File([new Uint8Array(bytes)], key.file, { type: 'application/octet-stream' });
    if (request.field === 'document') form.set('document', file);
    else if (request.field === 'duplicate') {
      form.append('file', file);
      form.append('file', new File([new Uint8Array(bytes)], `second-${key.file}`));
    } else form.set('file', file);
    body = form;
  }

  try {
    const response = await fetch(`${BASE}/api/documents/remediate`, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(300_000),
    });
    const wallMs = Date.now() - started;

    if (response.status !== 200) {
      const text = await response.text();
      let refusal: RunResult['refusal'];
      try {
        refusal = JSON.parse(text) as RunResult['refusal'];
      } catch {
        refusal = { error: 'unparseable', detail: text.slice(0, 200) };
      }
      return { id: key.id, status: response.status, refusal, wallMs };
    }

    const header = response.headers.get('x-remediation-summary');
    const delivered = Buffer.from(await response.arrayBuffer());
    const outPath = join(RESULTS, 'delivered', `${key.id}.pdf`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, delivered);

    return {
      id: key.id,
      status: 200,
      summary: header === null ? undefined : JSON.parse(header),
      outputSha256: sha256(delivered),
      independent: await independentUa1(outPath),
      wallMs,
    };
  } catch (error) {
    return {
      id: key.id,
      status: 0,
      wallMs: Date.now() - started,
      transportError: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * A second reading of the delivered bytes, by a veraPDF this process spawns.
 *
 * The drift guard. The product runs the same checker inside itself, so the
 * only thing that can disagree is the wiring between them — and wiring is
 * exactly what a unit test cannot see.
 */
async function independentUa1(path: string): Promise<RunResult['independent']> {
  if (!existsSync(VERAPDF)) return { checked: false };
  let raw: string;
  try {
    const { stdout } = await execFileAsync(
      'java',
      ['-Xmx1024m', '-jar', VERAPDF, '-f', 'ua1', '--format', 'json', path],
      { maxBuffer: 128 * 1024 * 1024, timeout: 300_000 },
    );
    raw = stdout;
  } catch (error) {
    const e = error as { code?: number; stdout?: string };
    if (e.code === 1 && e.stdout && e.stdout.length > 0) raw = e.stdout;
    else return { checked: false };
  }
  try {
    const result = JSON.parse(raw).report.jobs[0].validationResult[0];
    const clauses = (result.details?.ruleSummaries ?? [])
      .filter((r: { failedChecks?: number }) => (r.failedChecks ?? 0) > 0)
      .map((r: { clause: string; testNumber: number }) => `${r.clause}-${r.testNumber}`);
    return { checked: true, compliant: result.compliant === true, clauses: [...new Set<string>(clauses)].sort() };
  } catch {
    return { checked: false };
  }
}

// ------------------------------------------------------------------ the run

async function runAll(): Promise<void> {
  const keys = loadKeys();
  verifyHashes(keys);

  const instance = randomUUID();
  const server = startServer(instance);
  const results: Record<string, RunResult> = {};

  try {
    await waitForServer(instance);

    // A run where the checker is absent measures nothing about conformance
    // and would read as a clean sweep. A uniform verdict is always the
    // instrument, so the instrument is proven before the corpus starts.
    const gate = await fetch(`${BASE}/api/documents/remediate`, { headers: { authorization: `Bearer ${TOKEN}` } });
    const toolchain = (await gate.json()) as { available?: boolean; reason?: string };
    if (toolchain.available !== true) {
      throw new Error(`the host cannot remediate: ${toolchain.reason ?? 'no reason given'}`);
    }
    const canaryKey = keys.find((k) => k.id === 'p01-tagged-titled');
    if (!canaryKey) throw new Error('no canary document in the corpus');
    const canary = await post(canaryKey, readFileSync(documentPath(canaryKey)));
    if (canary.summary?.conformance?.checker !== 'verapdf-ua1') {
      throw new Error('the canary came back without a conformance verdict — the checker is not wired up');
    }
    console.log(`preflight: toolchain available, checker answering, ${keys.length} documents to run`);

    let done = 0;
    for (const key of keys) {
      const bytes = readFileSync(documentPath(key));
      results[key.id] = await post(key, bytes);
      done += 1;
      // Progress only. What any of it means is the scorer's business.
      process.stdout.write(`\r  ${done}/${keys.length} ${key.id.padEnd(32)}`);
    }
    process.stdout.write('\n');
  } finally {
    if (server.pid !== undefined) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        // Already gone.
      }
    }
  }

  mkdirSync(RESULTS, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(RESULTS, 'latest.json'), `${JSON.stringify({ runId, results }, null, 2)}\n`, 'utf8');
  writeFileSync(join(RESULTS, `run-${runId}.json`), `${JSON.stringify({ runId, results }, null, 2)}\n`, 'utf8');
  console.log(`\nrecorded ${Object.keys(results).length} results — score them with:\n  npx tsx scripts/doc-blind-test/run.ts score`);
}

// ---------------------------------------------------------------- the score

function scoreLatest(): void {
  const keys = loadKeys();
  const latest = join(RESULTS, 'latest.json');
  if (!existsSync(latest)) {
    console.error('no run to score');
    process.exit(2);
  }
  const { results } = JSON.parse(readFileSync(latest, 'utf8')) as { results: Record<string, RunResult> };

  const correctionsPath = join(CORPUS, 'corrections.json');
  const corrections: Correction[] = existsSync(correctionsPath)
    ? (JSON.parse(readFileSync(correctionsPath, 'utf8')) as Correction[])
    : [];

  const previousPath = join(RESULTS, 'previous-score.json');
  const previous = existsSync(previousPath)
    ? (JSON.parse(readFileSync(previousPath, 'utf8')) as ReturnType<typeof scoreRun>)
    : undefined;

  const score = scoreRun(keys, results, corrections);

  const byDocument = new Map<string, typeof score.findings>();
  for (const finding of score.findings) {
    if (!byDocument.has(finding.id)) byDocument.set(finding.id, []);
    byDocument.get(finding.id)!.push(finding);
  }

  console.log('# Document blind test\n');
  for (const key of keys) {
    const found = (byDocument.get(key.id) ?? []).filter((f) => f.outcome !== 'hit' && f.outcome !== 'door-hit');
    if (found.length === 0) continue;
    const worst = found.some((f) => f.fatal) ? 'FAIL' : 'note';
    console.log(`  ${worst}  ${key.id.padEnd(30)} ${key.weight}`);
    for (const finding of found) {
      console.log(`        ${finding.fatal ? '!' : '·'} ${finding.facet}/${finding.outcome}: ${finding.detail}`);
    }
  }

  console.log('\n# Scorecard');
  for (const line of renderScore(score, keys, previous)) console.log(line);

  writeFileSync(join(RESULTS, 'score.json'), `${JSON.stringify(score, null, 2)}\n`, 'utf8');
  const code = exitCode(score);
  console.log(`\n${code === 0 ? 'every promise held' : `${score.findings.filter((f) => f.fatal).length} findings must be answered`}`);
  process.exit(code);
}

const command = process.argv[2];
if (command === 'run') {
  runAll().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
} else if (command === 'score') {
  scoreLatest();
} else {
  console.error('usage: run.ts run | score');
  process.exit(2);
}
