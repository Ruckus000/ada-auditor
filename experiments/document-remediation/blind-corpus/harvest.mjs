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
 * Both guards stop at the TRAINING corpora. Neither sees a previous blind
 * cohort: `prior-hashes.txt` holds no `r*` or `n*` hash, and `trainedDomains`
 * is built from `pdf-harvest.txt` and `real-word-names.txt` — not from the
 * cohort name-maps. So a cohort-2 document reused from cohort 1 passes both.
 *
 * Cohort-to-cohort disjointness is therefore CURATED, not enforced: it is
 * checked by whoever assembles the names-map. It has held so far — cohorts 1
 * and 2 share no hash and no host — and #221 records why enforcing it was left
 * alone, the short version being that appending a cohort's own hashes makes
 * re-harvesting that cohort reject every document as a duplicate of itself.
 * Adding a third cohort means checking it against the others by hand.
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
import { failureLine } from './failure-line.mjs';

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
      // `--remove-on-error` because `-o` truncates the output file before curl
      // knows the request will succeed: without it a failed RE-download destroys
      // the good document already on disk, and the same run drops its hash.
      '-sSL', '--max-time', '90', '--retry', '2', '--fail', '--remove-on-error',
      '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      '-o', target, url,
    ], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    rejected.push(`${id}: download failed (${failureLine(error, { prefer: 'last' })})`);
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
/**
 * Merged, never rewritten from a partial pass.
 *
 * The names-map is ONE COHORT — `real-names.txt` is 34 `r*` ids, `new-names.txt`
 * is 50 `n*` — so a write built from `kept` alone erases every cohort this run
 * did not look at. `[V]` That is how 28 `r*` hashes were lost while all 28
 * documents sat in `real/`, unverifiable, and why the second cohort had to be
 * merged into this file by hand. `author-real-keys.mjs` states the rule and
 * guards `corrections.json` with it; this is the file that taught it.
 *
 * Spread order is load-bearing: `recorded` first holds the existing ids in
 * place, this run's hashes second refresh those it re-harvested and append
 * genuinely new ones — a record whose diff is mostly relocation hides the one
 * line that changed. (`prior` above is the prior-HASHES set; different thing,
 * hence the name.)
 *
 * The manifest is therefore everything ever successfully harvested, which is
 * the useful reading — `real/` is gitignored, so nothing else records what the
 * corpus is supposed to contain. A stale id can only leave by being harvested
 * again and rejected, or by hand.
 */
const manifestPath = join(HERE, 'real-manifest.json');
const recorded = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, 'utf8')).documents
  : {};
writeFileSync(manifestPath, `${JSON.stringify(
  { documents: { ...recorded, ...Object.fromEntries(kept.map((r) => [r.id, r.hash])) } }, null, 2,
)}\n`, 'utf8');
