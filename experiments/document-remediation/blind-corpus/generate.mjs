/**
 * Writes the blind corpus: planted bytes into `docs/`, frozen keys into
 * `keys/`, and a `manifest.json` of every hash.
 *
 * Bytes are gitignored, keys are tracked. The keys are the campaign's claim
 * about what should happen and are authored BEFORE the pipeline sees a
 * document; the manifest is what makes that checkable afterwards, because a
 * key edited after a disappointing run is the one failure mode a blind test
 * cannot survive.
 *
 * Usage: node generate.mjs
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  cyclicTreePdf, HELVETICA_RESOURCES, incrementalTitlePdf, lit, noPagesPdf, pdf, signedPdf,
  structuredPdf, text, widget,
} from './pdf-builders.mjs';
import {
  fakeHeading, fakeListItem, figure, foreignRun, heading, listItem, oleContainer, para, table,
  trackedPara, writeDocx,
} from './docx-builders.mjs';
import { SPEC, EXPECTED_ROWS } from './spec.mjs';

const HERE = import.meta.dirname;
const DOCS = join(HERE, 'docs');
const KEYS = join(HERE, 'keys');
const WORK = join(HERE, 'work');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// ------------------------------------------------------------ PDF assembly

/** A structure tree root with nothing under it: a claim, and no structure. */
function emptyTreePdf() {
  const d = pdf();
  const catalog = d.slot();
  const pagesNode = d.slot();
  const page = d.slot();
  const treeRoot = d.add('<< /Type /StructTreeRoot /K [] >>');
  const resources = d.add(HELVETICA_RESOURCES);
  const contents = d.add(d.stream('', text('nothing is tagged here')));
  d.set(
    page,
    `<< /Type /Page /Parent ${d.ref(pagesNode)} /MediaBox [0 0 612 792] /Contents ${d.ref(contents)}`
      + ` /Resources ${d.ref(resources)} >>`,
  );
  d.set(pagesNode, `<< /Type /Pages /Kids [${d.ref(page)}] /Count 1 >>`);
  d.set(
    catalog,
    `<< /Type /Catalog /Pages ${d.ref(pagesNode)} /StructTreeRoot ${d.ref(treeRoot)}`
      + ` /MarkInfo << /Marked true >> /Lang (en-US) >>`,
  );
  return d.serialize({ trailerExtra: `/Root ${d.ref(catalog)}` });
}

/**
 * A portfolio: a tagged cover sheet with a document attached to it.
 *
 * The attachment is deliberately an untagged PDF. Nothing in the pipeline
 * reads inside an attachment, so whether that silence is voiced anywhere is
 * the question this row asks.
 */
function portfolioPdf() {
  const attached = structuredPdf({ tagged: false, marked: false, title: 'Attached Schedule', lang: 'en-US', elements: [] });
  const d = pdf();
  const catalog = d.slot();
  const pagesNode = d.slot();
  const page = d.slot();
  const treeRoot = d.slot();

  const resources = d.add(HELVETICA_RESOURCES);
  const contents = d.add(d.stream('', text('Cover sheet', 0)));
  const element = d.add(`<< /Type /StructElem /S /H1 /P ${d.ref(treeRoot)} /Pg ${d.ref(page)} /K 0 >>`);
  const parentTree = d.add(`<< /Nums [0 [${d.ref(element)}]] >>`);
  d.set(treeRoot, `<< /Type /StructTreeRoot /K [${d.ref(element)}] /ParentTree ${d.ref(parentTree)} /ParentTreeNextKey 1 >>`);
  d.set(
    page,
    `<< /Type /Page /Parent ${d.ref(pagesNode)} /MediaBox [0 0 612 792] /Contents ${d.ref(contents)}`
      + ` /Resources ${d.ref(resources)} /StructParents 0 >>`,
  );
  d.set(pagesNode, `<< /Type /Pages /Kids [${d.ref(page)}] /Count 1 >>`);

  const embedded = d.add(d.stream('/Type /EmbeddedFile /Subtype /application#2Fpdf', attached));
  const fileSpec = d.add(
    `<< /Type /Filespec /F (schedule.pdf) /UF (schedule.pdf) /EF << /F ${d.ref(embedded)} >> /Desc (Attached schedule) >>`,
  );
  const names = d.add(`<< /Names [(schedule.pdf) ${d.ref(fileSpec)}] >>`);
  const namesDict = d.add(`<< /EmbeddedFiles ${d.ref(names)} >>`);
  const info = d.add(`<< /Title ${lit('Portfolio Cover')} >>`);

  d.set(
    catalog,
    `<< /Type /Catalog /Pages ${d.ref(pagesNode)} /StructTreeRoot ${d.ref(treeRoot)}`
      + ' /MarkInfo << /Marked true >> /Lang (en-US)'
      + ` /Names ${d.ref(namesDict)} /Collection << /Type /Collection /View /D >> >>`,
  );
  return d.serialize({ trailerExtra: `/Root ${d.ref(catalog)} /Info ${d.ref(info)}` });
}

/** Encrypted by qpdf: a third-party producer, so the encryption is real. */
function encryptedPdf() {
  mkdirSync(WORK, { recursive: true });
  const plain = join(WORK, 'plain.pdf');
  const out = join(WORK, 'encrypted.pdf');
  writeFileSync(plain, structuredPdf({
    title: 'Locked Notice', lang: 'en-US',
    elements: [{ type: 'H1', text: 'Locked Notice' }, { type: 'P', text: 'body' }],
  }));
  rmSync(out, { force: true });
  execFileSync('qpdf', ['--encrypt', '--user-password=', '--owner-password=owner', '--bits=256', '--', plain, out]);
  const bytes = readFileSync(out);
  rmSync(plain, { force: true });
  rmSync(out, { force: true });
  return bytes;
}

// ----------------------------------------------------------- DOCX assembly

const LEAD = 'Applications close at the end of the month and late submissions are held for the following cycle.';
const FOLLOW = 'Questions about eligibility go to the program desk, which answers in the order received.';

/** Every planted Word shape, keyed by the name its spec row names. */
const SHAPES = {
  baseline: () => [
    heading(1, 'Program Notice'),
    para(LEAD),
    heading(2, 'Eligibility'),
    table([['Category', 'Deadline'], ['Residential', 'March 1'], ['Commercial', 'April 1']], { headerRow: true }),
    listItem(1, 'Proof of address'),
    listItem(1, 'Signed declaration'),
    listItem(1, 'Payment receipt'),
    para(FOLLOW),
  ],
  simple: () => [heading(1, 'Program Notice'), para(LEAD)],
  'fake-headings': () => [fakeHeading('Program Notice'), para(LEAD), fakeHeading('Eligibility'), para(FOLLOW)],
  'typed-list': () => [
    heading(1, 'Typed List'), fakeListItem(1, 'Proof of address'), fakeListItem(2, 'Signed declaration'),
    fakeListItem(3, 'Payment receipt'),
  ],
  'layout-table': () => [
    heading(1, 'Placement Grid'),
    table([['Left column text', 'Right column text'], ['More text', 'More text']], { borders: false }),
  ],
  'figure-no-alt': () => [heading(1, 'Undescribed Figure'), para(LEAD), figure(null)],
  'figure-alt': () => [heading(1, 'Described Figure'), para(LEAD), figure('The east basin after the storm')],
  'foreign-runs': () => [
    heading(1, 'Quoted Sources'), para(LEAD),
    foreignRun('Die Frist endet am Monatsende.', 'de-DE'),
    foreignRun('Nachfragen richten Sie an das Programmbüro.', 'de-DE'),
  ],
  rtl: () => [heading(1, 'إشعار'), para('تنتهي مهلة تقديم الطلبات في نهاية الشهر.')],
  cjk: () => [heading(1, '项目通知'), para('申请将于月底截止，逾期提交的申请将顺延至下一周期。')],
  tracked: () => [
    heading(1, 'Under Review'),
    trackedPara('The deadline is', 'the last business day of', 'the end of'),
    para(FOLLOW),
  ],
  'deep-start': () => [heading(3, 'Deep Start'), para(LEAD)],
  empty: () => [],
};

const DOCX_LANG_SLOTS = {
  rtl: { rtlLang: 'ar-SA', rtl: true },
  cjk: { eastAsiaLang: 'zh-CN' },
};

function buildDocx(id, args, outPath) {
  const shape = SHAPES[args.shape];
  if (!shape) throw new Error(`${id}: no shape named ${args.shape}`);
  return writeDocx(join(WORK, `${id}.parts`), outPath, {
    title: args.title,
    lang: args.lang,
    body: shape(),
    image: args.shape.startsWith('figure'),
    comments: args.shape === 'tracked',
    macro: args.macro === true,
    ...(DOCX_LANG_SLOTS[args.shape] ?? {}),
  });
}

// -------------------------------------------------- door-case request bytes

/** A ZIP built from a directory of small files, by the system zip. */
function zipOf(entries, outPath) {
  const dir = join(WORK, 'ziptmp');
  rmSync(dir, { recursive: true, force: true });
  for (const [path, body] of Object.entries(entries)) {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  rmSync(outPath, { force: true });
  execFileSync('zip', ['-X', '-q', '-r', outPath, '.'], { cwd: dir });
  rmSync(dir, { recursive: true, force: true });
  return readFileSync(outPath);
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function doorBytes(kind, outPath) {
  switch (kind) {
    case 'empty':
      return Buffer.alloc(0);
    case 'text-named-pdf':
      return Buffer.from('This is a notice about the drainage assessment. It is not a PDF.\n', 'utf8');
    case 'magic-late':
      // 1100 bytes of filler before the marker: past the window the sniffer
      // reads, which is the boundary this row exists to pin.
      return Buffer.concat([
        Buffer.from('% filler\n'.repeat(130), 'latin1'),
        structuredPdf({ title: 'Late Marker', lang: 'en-US', elements: [{ type: 'P', text: 'body' }] }),
      ]);
    case 'zip-plain':
      return zipOf({ 'readme.txt': 'not a word document\n' }, outPath);
    case 'xlsx-like':
      return zipOf({
        '[Content_Types].xml': `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
        'xl/workbook.xml': `${XML_DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Deadlines" sheetId="1"/></sheets></workbook>`,
      }, outPath);
    case 'oversize': {
      // A real PDF followed by padding past the cap. The door decides on
      // size before anything parses it, so the padding costs nothing but
      // bytes and the file stays a genuine document underneath.
      const base = structuredPdf({ title: 'Large Notice', lang: 'en-US', elements: [{ type: 'H1', text: 'Large Notice' }] });
      return Buffer.concat([base, Buffer.from('% padding\n'.repeat(2_700_000), 'latin1')]);
    }
    default:
      throw new Error(`no door builder for ${kind}`);
  }
}

// ------------------------------------------------------------------ writing

const PDF_BUILDERS = {
  structured: (args) => structuredPdf({
    ...args,
    annots: (args.annots ?? []).map((a) => widget(a)),
  }),
  'empty-tree': emptyTreePdf,
  cyclic: cyclicTreePdf,
  signed: (args) => signedPdf(args),
  encrypted: encryptedPdf,
  portfolio: portfolioPdf,
  incremental: (args) => incrementalTitlePdf(args),
  'no-pages': noPagesPdf,
};

function filenameFor(row) {
  if (row.build?.filename) return row.build.filename;
  if (row.request?.filename) return row.request.filename;
  if (row.kind === 'word') {
    if (row.build.fn === 'legacy-doc') return `${row.id}.doc`;
    if (row.build.fn === 'ole') return `${row.id}.doc`;
    if (row.build.fn === 'pdf-named-docx') return `${row.id}.docx`;
    return `${row.id}.docx`;
  }
  if (row.kind === 'door') {
    if (row.request.build === 'zip-plain' || row.request.build === 'xlsx-like') return `${row.id}.docx`;
    return `${row.id}.pdf`;
  }
  return `${row.id}.pdf`;
}

rmSync(DOCS, { recursive: true, force: true });
rmSync(WORK, { recursive: true, force: true });
mkdirSync(DOCS, { recursive: true });
mkdirSync(KEYS, { recursive: true });
mkdirSync(WORK, { recursive: true });

// Only the planted keys are this file's to remove. Emptying the directory
// wholesale also deleted the real documents' keys — which are authored by a
// different script, from different instruments, and are not regenerable
// without re-reading twenty-eight files. Caught by the independence test
// counting keys; restored from the lock commit, which is the reason the lock
// commit exists.
for (const existing of readdirSync(KEYS)) {
  if (SPEC.some((row) => `${row.id}.key.json` === existing)) rmSync(join(KEYS, existing));
}

const manifest = { generated: 'blind-corpus/generate.mjs', documents: {}, keys: {} };
const written = [];

for (const row of SPEC) {
  const filename = filenameFor(row);
  const outPath = join(DOCS, filename);
  let bytes;

  if (row.kind === 'door') {
    // Rows that mutate only the REQUEST share one ordinary document: what
    // they measure is how it is sent, not what it contains.
    bytes = row.request.build
      ? doorBytes(row.request.build, outPath)
      : structuredPdf({ title: 'Program Notice', lang: 'en-US', elements: [
        { type: 'H1', text: 'Program Notice' }, { type: 'P', text: LEAD },
      ] });
  } else if (row.kind === 'pdf') {
    const build = PDF_BUILDERS[row.build.fn];
    if (!build) throw new Error(`${row.id}: no PDF builder named ${row.build.fn}`);
    bytes = build(row.build.args ?? {});
  } else if (row.build.fn === 'docx') {
    buildDocx(row.id, row.build.args, outPath);
    bytes = readFileSync(outPath);
  } else if (row.build.fn === 'ole') {
    bytes = oleContainer();
  } else if (row.build.fn === 'pdf-named-docx') {
    bytes = structuredPdf({ title: 'Program Notice', lang: 'en-US', elements: [
      { type: 'H1', text: 'Program Notice' }, { type: 'H2', text: 'Eligibility' }, { type: 'P', text: LEAD },
    ] });
  } else if (row.build.fn === 'legacy-doc') {
    // Converted by LibreOffice, which is the only producer of a legacy .doc
    // available here. It converts a document it did not author, from parts
    // this file wrote — the input is still independent of the pipeline.
    const source = join(DOCS, `${row.build.from}.docx`);
    execFileSync('soffice', ['--headless', '--convert-to', 'doc', '--outdir', WORK, source], { stdio: 'ignore' });
    bytes = readFileSync(join(WORK, `${row.build.from}.doc`));
  } else {
    throw new Error(`${row.id}: no builder for ${row.build.fn}`);
  }

  writeFileSync(outPath, bytes);
  const hash = sha256(readFileSync(outPath));

  const key = {
    id: row.id,
    file: filename,
    sha256: hash,
    origin: 'planted',
    kind: row.kind,
    weight: row.weight,
    tests: row.tests,
    ...(row.request ? { request: row.request } : {}),
    expected: row.expected,
    ...(row.note ? { note: row.note } : {}),
    ...(row.sameSummaryAs ? { sameSummaryAs: row.sameSummaryAs } : {}),
    ...(row.mustNotClaim ? { mustNotClaim: row.mustNotClaim } : {}),
  };
  const keyPath = join(KEYS, `${row.id}.key.json`);
  writeFileSync(keyPath, `${JSON.stringify(key, null, 2)}\n`, 'utf8');

  manifest.documents[filename] = hash;
  manifest.keys[`${row.id}.key.json`] = sha256(readFileSync(keyPath));
  written.push(`${row.id.padEnd(30)} ${filename.padEnd(34)} ${String(readFileSync(outPath).length).padStart(9)} bytes`);
}

rmSync(WORK, { recursive: true, force: true });
writeFileSync(join(HERE, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

for (const line of written) console.log(line);
console.log(`\nwrote ${written.length} documents to docs/ and ${written.length} keys to keys/`);

if (written.length !== EXPECTED_ROWS) {
  console.error(`expected ${EXPECTED_ROWS} rows, wrote ${written.length}`);
  process.exit(1);
}

// A document that no key can find guards nothing, and a key with no document
// grades nothing. Both directions, every run.
// Both directions, over the planted rows only: the keys directory also holds
// the real documents' keys, which this file neither writes nor owns.
const docFiles = new Set(readdirSync(DOCS));
const plantedKeys = readdirSync(KEYS).filter((f) => SPEC.some((row) => `${row.id}.key.json` === f));
if (docFiles.size !== plantedKeys.length) {
  console.error(`docs/ holds ${docFiles.size} files and ${plantedKeys.length} planted keys grade them`);
  process.exit(1);
}
