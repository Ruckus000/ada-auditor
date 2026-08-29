/**
 * Proves the planted corpus contains what its keys claim — read by qpdf and
 * unzip, never by anything in `src/`.
 *
 * A builder bug and a product bug are indistinguishable at scoring time: both
 * arrive as "the key said 2 headings and the run reported 1". This pass
 * removes the first possibility before the run, using instruments that have
 * no stake in the answer.
 *
 * It deliberately checks the SOURCE side only. What the pipeline should make
 * of these documents is the key's claim and the run's business; what the
 * documents contain is a fact, and facts are checkable now.
 *
 * Usage: node verify.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const HERE = import.meta.dirname;
const DOCS = join(HERE, 'docs');
const KEYS = join(HERE, 'keys');

const problems = [];
const complain = (id, message) => problems.push(`${id}: ${message}`);

/**
 * qpdf's object dump, keyed `obj:N 0 R`. Encrypted files open with the empty
 * user password, which is what makes an encrypted row checkable at all.
 */
function qpdfObjects(path) {
  // Exit 3 is "succeeded with warnings", and a warning is not a refusal to
  // read. Treating it as one drops exactly the awkward documents a corpus is
  // for.
  let out;
  try {
    out = execFileSync('qpdf', ['--json=2', '--password=', path], {
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8');
  } catch (error) {
    if (error.status === 3 && error.stdout) out = error.stdout.toString('utf8');
    else throw error;
  }
  return JSON.parse(out).qpdf[1];
}

/** Every structure element type in the file, in no particular order. */
function structureTypes(objects) {
  const types = [];
  for (const value of Object.values(objects)) {
    const obj = value?.value ?? value;
    if (obj && typeof obj === 'object' && obj['/Type'] === '/StructElem') types.push(obj['/S']);
  }
  return types;
}

function findCatalog(objects) {
  for (const value of Object.values(objects)) {
    const obj = value?.value ?? value;
    if (obj && typeof obj === 'object' && obj['/Type'] === '/Catalog') return obj;
  }
  return null;
}

/** qpdf renders a literal string as `u:<text>` or `b:<hex>`. */
function plainString(value) {
  if (typeof value !== 'string') return null;
  if (value.startsWith('u:')) return value.slice(2);
  if (value.startsWith('b:')) return Buffer.from(value.slice(2), 'hex').toString('utf8');
  return value;
}

const HEADING_TYPES = new Set(['/H1', '/H2', '/H3', '/H4', '/H5', '/H6']);

function verifyPdf(key, bytes, path) {
  let objects;
  try {
    objects = qpdfObjects(path);
  } catch (error) {
    // Only the rows that are supposed to be unreadable may be unreadable.
    if (['p13-encrypted', 'p17-shifted-xref', 'p34-no-pages'].includes(key.id)) return;
    complain(key.id, `qpdf could not read it: ${String(error.stderr ?? error.message).trim().split('\n')[0]}`);
    return;
  }

  const catalog = findCatalog(objects);
  if (!catalog) {
    complain(key.id, 'no catalog');
    return;
  }

  const expected = key.expected ?? {};
  const wantsTree = expected.disposition !== 'refused-not-tagged' && key.id !== 'p06-empty-tree';
  const hasTree = catalog['/StructTreeRoot'] !== undefined;
  if (wantsTree && !hasTree && key.kind === 'pdf' && expected.disposition === 'delivered') {
    complain(key.id, 'the key expects a delivery but the file has no structure tree');
  }
  if (expected.disposition === 'refused-not-tagged' && key.id !== 'p06-empty-tree' && key.id !== 'p14-xfa-untagged' && hasTree) {
    complain(key.id, 'the key expects an untagged refusal but the file has a structure tree');
  }

  if (expected.counts) {
    const types = structureTypes(objects);
    const seen = {
      headings: types.filter((t) => HEADING_TYPES.has(t)).length,
      tables: types.filter((t) => t === '/Table').length,
      lists: types.filter((t) => t === '/L').length,
      figures: types.filter((t) => t === '/Figure').length,
    };
    for (const facet of ['headings', 'tables', 'lists', 'figures']) {
      if (expected.counts[facet] !== undefined && expected.counts[facet] !== seen[facet]) {
        complain(key.id, `key says ${facet} ${expected.counts[facet]}, the file carries ${seen[facet]}`);
      }
    }
  }

  if (expected.language !== undefined) {
    const lang = plainString(catalog['/Lang']);
    const planted = lang === null || lang === '' ? null : lang;
    if (expected.language !== planted && key.id !== 'p21-lang-empty') {
      complain(key.id, `key says language ${JSON.stringify(expected.language)}, the file declares ${JSON.stringify(planted)}`);
    }
  }

  // Facts that are the whole point of specific rows, checked where they live.
  const raw = bytes.toString('latin1');
  if (key.id === 'p20-cidset' && !raw.includes('/CIDSet')) complain(key.id, 'no CIDSet to remove');
  if (key.id === 'p31-fonts-not-embedded' && raw.includes('/FontFile')) complain(key.id, 'a font is embedded after all');
  if (key.id.startsWith('p1') && key.expected.disposition === 'refused-signed' && !raw.includes('/Sig')) {
    complain(key.id, 'no signature to refuse');
  }
  if (key.id === 'p16-portfolio' && !raw.includes('/EmbeddedFiles')) complain(key.id, 'no attachment');
}

const OOXML_MAIN = 'word/document.xml';

function verifyDocx(key, path) {
  let names;
  try {
    names = execFileSync('unzip', ['-Z1', path], { stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').split('\n');
  } catch {
    if (['w02-legacy-doc', 'w17-ole-not-word'].includes(key.id)) return;
    complain(key.id, 'not a readable ZIP');
    return;
  }
  if (!names.includes(OOXML_MAIN)) {
    if (key.expected.disposition === 'refused-pipeline' || key.kind === 'door') return;
    complain(key.id, 'no word/document.xml');
    return;
  }

  const doc = execFileSync('unzip', ['-p', path, OOXML_MAIN], { maxBuffer: 16 * 1024 * 1024 }).toString('utf8');
  const styles = execFileSync('unzip', ['-p', path, 'word/styles.xml'], { maxBuffer: 4 * 1024 * 1024 }).toString('utf8');
  const core = names.includes('docProps/core.xml')
    ? execFileSync('unzip', ['-p', path, 'docProps/core.xml'], { maxBuffer: 1024 * 1024 }).toString('utf8')
    : '';

  // xmllint on the extracted parts: a well-formedness failure here would
  // otherwise surface as a conversion failure and read as a product defect.
  for (const [label, xml] of [['document', doc], ['styles', styles]]) {
    try {
      execFileSync('xmllint', ['--noout', '-'], { input: xml });
    } catch {
      complain(key.id, `${label}.xml is not well-formed`);
    }
  }

  const counts = {
    headings: (doc.match(/w:val="Heading\d"/g) ?? []).length,
    tables: (doc.match(/<w:tbl>/g) ?? []).length,
    lists: (doc.match(/<w:numPr>/g) ?? []).length > 0 ? 1 : 0,
    figures: (doc.match(/<w:drawing>/g) ?? []).length,
  };
  // Heading styles also appear inside table header cells, which are cells and
  // not outline headings — subtract what the table planted.
  const inTableHeaders = (doc.match(/<w:tc>(?:(?!<\/w:tc>).)*w:val="Heading\d"/gs) ?? []).length;
  counts.headings -= inTableHeaders;

  const expected = key.expected?.counts;
  if (expected) {
    for (const facet of ['headings', 'tables', 'lists', 'figures']) {
      if (expected[facet] !== undefined && expected[facet] !== counts[facet]) {
        complain(key.id, `key says ${facet} ${expected[facet]}, the source carries ${counts[facet]}`);
      }
    }
  }

  const declaredLang = /<w:lang[^>]*w:val="([^"]+)"/.exec(styles)?.[1] ?? null;
  const wantLang = key.expected?.language;
  if (wantLang !== undefined && key.weight === 'core' && wantLang !== declaredLang) {
    complain(key.id, `key says language ${JSON.stringify(wantLang)}, the source declares ${JSON.stringify(declaredLang)}`);
  }

  const declaredTitle = /<dc:title>([^<]*)<\/dc:title>/.exec(core)?.[1] ?? null;
  if (key.expected?.title === 'already-titled' && declaredTitle === null) {
    complain(key.id, 'key says already-titled and the source has no dc:title');
  }
  if (key.expected?.title === 'transcribed' && declaredTitle !== null) {
    complain(key.id, 'key says the title is transcribed from a heading, but the source already has one');
  }
}

// ---------------------------------------------------------------- the sweep

const manifest = JSON.parse(readFileSync(join(HERE, 'manifest.json'), 'utf8'));
const keyFiles = readdirSync(KEYS).filter((f) => f.endsWith('.key.json')).sort();
let checked = 0;

for (const keyFile of keyFiles) {
  const key = JSON.parse(readFileSync(join(KEYS, keyFile), 'utf8'));
  const path = join(DOCS, key.file);
  const bytes = readFileSync(path);

  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== key.sha256) complain(key.id, 'the file does not match the hash in its key');
  if (manifest.documents[key.file] !== hash) complain(key.id, 'the file does not match the manifest');

  if (key.kind === 'door') {
    // A door row's document is a vehicle; what it must be is the shape the
    // row names, and that is asserted by the row's own build, not here.
    checked += 1;
    continue;
  }

  // Dispatch on the bytes, never the name. One row is PDF content under a
  // .docx name precisely because a name is not evidence, and a verifier that
  // trusted the extension would fail that row for agreeing with it.
  if (bytes.subarray(0, 1024).includes('%PDF-')) verifyPdf(key, bytes, path);
  else verifyDocx(key, path);
  checked += 1;
}

console.log(`verified ${checked} planted documents with qpdf ${execFileSync('qpdf', ['--version']).toString().split('\n')[0].split(' ').pop()} and unzip`);

if (problems.length > 0) {
  console.error(`\n${problems.length} planted documents do not match their keys:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('every planted document carries what its key claims');
