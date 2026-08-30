/**
 * Fetches the fresh real documents and proves they are fresh.
 *
 * The planted corpus covers the edge cases somebody thought of. These cover
 * the ones nobody did, which is the only guard this campaign has against its
 * own imagination — and it is a thin one, so the disjointness from the
 * training set has to be real rather than assumed.
 *
 * Two guards, because one is not enough:
 *  - sha256 against `prior-hashes.txt`, every document the pipeline was ever
 *    tuned on. Catches the same file arriving twice.
 *  - the source domain must not appear in the training manifests. Catches the
 *    same document re-exported, which a hash never will.
 *
 * Bytes land in `real/`, which was gitignored before this file was written.
 * The names map is tracked: URLs and ids, never content.
 *
 * Usage: node harvest.mjs real-names.txt
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dirname;
const REAL = join(HERE, 'real');
const SPIKE = join(HERE, '..');

const mapFile = process.argv[2];
if (!mapFile) {
  console.error('usage: node harvest.mjs <names-map>');
  process.exit(2);
}

const prior = new Set(
  readFileSync(join(HERE, 'prior-hashes.txt'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean),
);

/** Every domain the training corpora were drawn from. */
const trainedDomains = new Set();
for (const file of ['pdf-harvest.txt', 'real-word-names.txt']) {
  const path = join(SPIKE, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const url = line.trim().split(/\s+/)[1];
    if (url) trainedDomains.add(new URL(url).hostname.replace(/^www\./, ''));
  }
}

const rows = readFileSync(mapFile, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.length > 0 && !l.startsWith('#'))
  .map((l) => {
    const [id, url] = l.split(/\s+/);
    return { id, url };
  });

mkdirSync(REAL, { recursive: true });

const kept = [];
const rejected = [];

for (const { id, url } of rows) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  if (trainedDomains.has(host)) {
    rejected.push(`${id}: ${host} is a training-set domain`);
    continue;
  }

  const target = join(REAL, id);
  try {
    // curl rather than fetch: these are third-party hosts that redirect,
    // rate-limit and occasionally answer HTML with a PDF content type, and
    // curl reports all of that in one exit code.
    execFileSync('curl', [
      '-sSL', '--max-time', '90', '--retry', '2', '--fail',
      '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      '-o', target, url,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (error) {
    rejected.push(`${id}: download failed (${String(error.stderr ?? '').trim().split('\n').pop() || 'no response'})`);
    continue;
  }

  const bytes = readFileSync(target);
  const hash = createHash('sha256').update(bytes).digest('hex');

  if (prior.has(hash)) {
    rejected.push(`${id}: byte-identical to a training-set document`);
    continue;
  }

  // What arrived has to be the kind of thing that was asked for. A login
  // page saved as a .pdf would otherwise enter the corpus and be scored as
  // a document the product mishandled.
  const head = bytes.subarray(0, 1024);
  const isPdf = head.includes('%PDF-');
  const isZip = bytes.subarray(0, 4).toString('hex') === '504b0304';
  const isOle = bytes.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1';
  if (!isPdf && !isZip && !isOle) {
    rejected.push(`${id}: the response is not a document (${bytes.length} bytes)`);
    continue;
  }

  kept.push({ id, url, host, hash, bytes: bytes.length, kind: isPdf ? 'pdf' : isZip ? 'ooxml' : 'ole' });
}

for (const row of kept) {
  console.log(`${row.id.padEnd(14)} ${row.kind.padEnd(6)} ${String(row.bytes).padStart(9)} bytes  ${row.host}`);
}
if (rejected.length > 0) {
  console.log('\nnot kept:');
  for (const line of rejected) console.log(`  ${line}`);
}

const hosts = new Set(kept.map((r) => r.host));
console.log(`\nkept ${kept.length} of ${rows.length}, from ${hosts.size} hosts, none shared with the training set`);
writeFileSync(join(HERE, 'real-manifest.json'), `${JSON.stringify(
  { documents: Object.fromEntries(kept.map((r) => [r.id, r.hash])) }, null, 2,
)}\n`, 'utf8');
