/**
 * Authors the answer keys for the fresh real documents.
 *
 * ## The one rule this file exists to keep
 *
 * It reads the documents with qpdf, unzip and the veraPDF CLI, and with
 * NOTHING from `src/`. The pipeline's own `Inspect` stage must not be the
 * author of the answers it will be graded against, or the campaign measures
 * only that the product agrees with itself. `tests/scripts/blind-corpus-keys-
 * are-independent.test.ts` enforces that mechanically, because a rule that
 * lives only in a comment is a rule until somebody is in a hurry.
 *
 * ## What a real key claims
 *
 * Less than a planted one, and deliberately. Disposition and language are
 * derivable from facts a third party can see. Counts are recorded from the
 * structure tree qpdf dumps, and any facet that cannot be read that way is
 * `null` — unscored, and listed, so the cost of blindness is visible rather
 * than papered over.
 *
 * `needs` is a MUST-INCLUDE set rather than an exact one: what these documents
 * provably require is derivable, but the product may correctly voice more than
 * a third-party reading can predict, and a key that failed it for that would
 * be punishing thoroughness.
 *
 * ## Titles
 *
 * A document's title is its content, and this repo does not put content in
 * tracked files. The key stores the SHA-256 of the declared title instead, so
 * the scorer can prove the product transcribed exactly that string without the
 * string ever being written down.
 *
 * Usage: node author-real-keys.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dirname;
const REAL = join(HERE, 'real');
const KEYS = join(HERE, 'keys');
const VERAPDF = join(HERE, '..', '..', '..', 'vendor', 'verapdf', 'cli.jar');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// ------------------------------------------------------- third-party reads

/**
 * Run qpdf and accept its warnings.
 *
 * qpdf exits 3 for "succeeded with warnings", and real documents warn
 * constantly — the most common being a missing xref entry for the xref stream
 * itself, which qpdf's own message says it handles correctly. Treating that as
 * a failure silently dropped three documents from the corpus, which is how a
 * blind test quietly becomes a test of the well-formed documents.
 */
function qpdfJson(args) {
  try {
    return execFileSync('qpdf', args, {
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8');
  } catch (error) {
    if (error.status === 3 && error.stdout) return error.stdout.toString('utf8');
    throw error;
  }
}

function qpdfObjects(path) {
  return JSON.parse(qpdfJson(['--json=2', '--password=', path])).qpdf[1];
}

function qpdfSummary(path) {
  return JSON.parse(qpdfJson(['--json=2', '--json-key=pages', '--json-key=encrypt', '--password=', path]));
}

/** veraPDF's own verdict on the input. Exit 1 with a report IS the answer. */
function ua1(path) {
  let raw;
  try {
    raw = execFileSync('java', ['-Xmx1024m', '-jar', VERAPDF, '-f', 'ua1', '--format', 'json', path], {
      maxBuffer: 128 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 240_000,
    }).toString('utf8');
  } catch (error) {
    const stdout = error.stdout?.toString('utf8') ?? '';
    if (error.status === 1 && stdout.length > 0) raw = stdout;
    else return { checked: false };
  }
  try {
    const result = JSON.parse(raw).report.jobs[0].validationResult[0];
    const clauses = (result.details?.ruleSummaries ?? [])
      .filter((r) => (r.failedChecks ?? 0) > 0)
      .map((r) => `${r.clause}-${r.testNumber}`);
    return { checked: true, compliant: result.compliant === true, clauses: [...new Set(clauses)].sort() };
  } catch {
    return { checked: false };
  }
}

const HEADING_TYPES = new Set(['/H1', '/H2', '/H3', '/H4', '/H5', '/H6']);

const deref = (value) => value?.value ?? value;
const plainString = (value) => {
  if (typeof value !== 'string') return null;
  if (value.startsWith('u:')) return value.slice(2);
  if (value.startsWith('b:')) return Buffer.from(value.slice(2), 'hex').toString('utf8');
  return null;
};

function readPdf(path) {
  const objects = qpdfObjects(path);
  const summary = qpdfSummary(path);

  let catalog = null;
  let info = null;
  const structure = [];
  let annotations = 0;
  let annotationsOutside = 0;
  let signed = false;

  for (const value of Object.values(objects)) {
    const obj = deref(value);
    if (!obj || typeof obj !== 'object') continue;
    if (obj['/Type'] === '/Catalog') catalog = obj;
    if (obj['/Type'] === '/StructElem') structure.push(obj);
    if (obj['/Type'] === '/Sig' || obj['/FT'] === '/Sig') signed = obj['/V'] !== undefined || obj['/Type'] === '/Sig';
    if (obj['/Type'] === '/Annot' && (obj['/Subtype'] === '/Widget' || obj['/Subtype'] === '/Link')) {
      annotations += 1;
      if (obj['/StructParent'] === undefined) annotationsOutside += 1;
    }
    // The trailer's /Info is not typed, so it is found by shape: a dictionary
    // carrying document information keys and nothing else.
    if (obj['/Title'] !== undefined && obj['/Type'] === undefined) info = obj;
  }

  const headings = structure.filter((e) => HEADING_TYPES.has(e['/S']));
  const figures = structure.filter((e) => e['/S'] === '/Figure');
  const declaredTitle = info ? plainString(info['/Title']) : null;
  const lang = catalog ? plainString(catalog['/Lang']) : null;

  return {
    pages: summary.pages?.length ?? null,
    encrypted: summary.encrypt?.encrypted === true,
    tagged: catalog?.['/StructTreeRoot'] !== undefined && structure.length > 0,
    marked: catalog?.['/MarkInfo']?.['/Marked'] === true,
    signed,
    language: lang === null || lang === '' ? null : lang,
    declaredTitle,
    headingLevels: headings.map((e) => Number(e['/S'].slice(2))),
    counts: {
      headings: headings.length,
      tables: structure.filter((e) => e['/S'] === '/Table').length,
      lists: structure.filter((e) => e['/S'] === '/L').length,
      figures: figures.length,
    },
    figuresWithoutAlt: figures.filter((e) => e['/Alt'] === undefined).length,
    annotations,
    annotationsOutside,
  };
}

function readDocx(path) {
  const names = execFileSync('unzip', ['-Z1', path], { maxBuffer: 16 * 1024 * 1024 }).toString('utf8').split('\n');
  const part = (name) => (names.includes(name)
    ? execFileSync('unzip', ['-p', path, name], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
    : '');

  const doc = part('word/document.xml');
  const styles = part('word/styles.xml');
  const core = part('docProps/core.xml');

  const headingLevels = [...doc.matchAll(/w:val="Heading(\d)"/g)].map((m) => Number(m[1]));
  const drawings = [...doc.matchAll(/<wp:docPr\b[^>]*>/g)];

  return {
    tagged: null,
    language: /<w:lang[^>]*w:val="([^"]+)"/.exec(styles)?.[1] ?? null,
    declaredTitle: /<dc:title>([^<]*)<\/dc:title>/.exec(core)?.[1] ?? null,
    headingLevels,
    counts: {
      headings: headingLevels.length,
      tables: (doc.match(/<w:tbl>/g) ?? []).length,
      lists: null,
      figures: drawings.length,
    },
    figuresWithoutAlt: drawings.filter((m) => !/\bdescr="[^"]+"/.test(m[0])).length,
    annotations: 0,
    annotationsOutside: 0,
  };
}

// --------------------------------------------------------------- authoring

/**
 * What the evidence proves the document needs from a person.
 *
 * Derived from third-party readings only — this is the differential half of
 * the test: two independent readings of the same facts, and a disagreement is
 * a finding rather than a foregone conclusion.
 */
function needsFrom(read) {
  const needs = [];
  if (read.language === null) needs.push('3.1.1');
  if (read.annotationsOutside > 0) needs.push('1.3.1');
  for (let i = 0; i < read.figuresWithoutAlt; i += 1) needs.push('1.1.1');

  const levels = read.headingLevels;
  if (levels.length > 0) {
    if (levels[0] > 1) needs.push('2.4.10');
    for (let i = 1; i < levels.length; i += 1) {
      if (levels[i] > levels[i - 1] + 1) {
        needs.push('2.4.10');
        break;
      }
    }
  }
  return needs;
}

/**
 * Clause families transcription provably cannot fix, so the punch list must
 * name them whatever else it says. Fonts nobody embedded stay unembedded; page
 * content nobody tagged stays untagged. Every other clause is held to the
 * completeness property instead of to a guess.
 */
function mustVoiceFrom(clauses) {
  const families = [];
  if (clauses.some((c) => c.startsWith('7.21.4.1'))) families.push('7.21.4');
  if (clauses.some((c) => c.startsWith('7.1-3'))) families.push('7.1-3');
  return families;
}

mkdirSync(KEYS, { recursive: true });

const files = readdirSync(REAL).sort();
const rows = [];

for (const file of files) {
  const path = join(REAL, file);
  const bytes = readFileSync(path);
  const isPdf = bytes.subarray(0, 1024).includes('%PDF-');
  const id = file.replace(/\.[^.]+$/, '');

  let read;
  try {
    read = isPdf ? readPdf(path) : readDocx(path);
  } catch (error) {
    console.error(`${id}: could not be read by the third-party instruments — ${String(error.message).split('\n')[0]}`);
    continue;
  }

  const verdict = isPdf ? ua1(path) : { checked: false };

  const disposition = isPdf
    ? (read.signed ? 'refused-signed' : read.tagged ? 'delivered' : 'refused-not-tagged')
    : 'delivered';

  const expected = {
    disposition,
    language: read.language,
    titleDeclared: read.declaredTitle !== null,
    ...(read.declaredTitle === null ? {} : { titleTextSha256: sha256(read.declaredTitle) }),
    counts: disposition === 'delivered' ? { pages: isPdf ? read.pages : null, ...read.counts } : null,
    needs: disposition === 'delivered' ? needsFrom(read) : [],
    needsExact: false,
    conformance: verdict.checked && !verdict.compliant
      ? { compliant: false, mustVoice: mustVoiceFrom(verdict.clauses) }
      : 'any',
  };

  const key = {
    id,
    file,
    sha256: sha256(bytes),
    origin: 'real',
    kind: isPdf ? 'pdf' : 'word',
    // A real document is an open question by construction: nobody authored it
    // to test anything. Disposition and invented claims are still held to the
    // bar — those are promises, not predictions — which the scorer enforces
    // on every row regardless of weight.
    weight: 'probe',
    tests: `A document nobody wrote for this test: ${isPdf ? 'PDF' : 'Word'} from a public source, ${bytes.length} bytes.`,
    expected,
    evidence: {
      instruments: isPdf ? ['qpdf 12.4.1', 'veraPDF 1.30.2'] : ['unzip', 'xmllint'],
      ...(isPdf ? {
        pages: read.pages, tagged: read.tagged, marked: read.marked, signed: read.signed,
        encrypted: read.encrypted, annotations: read.annotations, annotationsOutside: read.annotationsOutside,
        figuresWithoutAlt: read.figuresWithoutAlt,
        ua1: verdict.checked ? { compliant: verdict.compliant, failingClauses: verdict.clauses } : 'unchecked',
      } : {
        headingLevels: read.headingLevels, figuresWithoutAlt: read.figuresWithoutAlt,
      }),
    },
  };

  writeFileSync(join(KEYS, `${id}.key.json`), `${JSON.stringify(key, null, 2)}\n`, 'utf8');
  rows.push({ id, disposition, tagged: read.tagged, clauses: verdict.checked ? verdict.clauses.length : null, needs: expected.needs.length });
}

for (const row of rows) {
  console.log(
    `${row.id.padEnd(8)} ${row.disposition.padEnd(20)} tagged=${String(row.tagged).padEnd(5)}`
    + ` ua1 clauses=${row.clauses === null ? 'n/a' : String(row.clauses).padStart(2)} needs=${row.needs}`,
  );
}
console.log(`\nauthored ${rows.length} real keys from third-party instruments only`);
console.log(`  delivered expected: ${rows.filter((r) => r.disposition === 'delivered').length}`);
console.log(`  refused expected:   ${rows.filter((r) => r.disposition !== 'delivered').length}`);
if (!existsSync(VERAPDF)) console.error(`\nno veraPDF at ${VERAPDF} — conformance evidence is missing from every key`);
