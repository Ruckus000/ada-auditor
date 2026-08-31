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

const HEADING_TYPES = new Set(['/H1', '/H2', '/H3', '/H4', '/H5', '/H6', '/H']);

/**
 * `/S` also names an ACTION's subtype, and an action is not a structure
 * element. Actions carry no `/P`, so the parent check already excludes them;
 * the list is explicit anyway, because "it happens not to match" is a reason
 * that stops being true.
 */
const ACTION_SUBTYPES = new Set([
  '/URI', '/GoTo', '/GoToR', '/GoToE', '/Launch', '/Named', '/JavaScript', '/SubmitForm',
  '/ResetForm', '/Hide', '/Thread', '/Sound', '/Movie', '/Rendition', '/Trans', '/SetOCGState',
  '/GoTo3DView', '/ImportData',
]);

/**
 * Is this object a structure element?
 *
 * By SHAPE, not by `/Type`. ISO 32000 makes `/Type /StructElem` optional, and
 * real producers omit it: the first blind run called fourteen genuinely tagged
 * documents untagged for this reason, and would have recorded the product
 * delivering untagged PDFs — a broken promise that never happened. Counting by
 * shape reproduces the product's counts exactly on every document tested.
 */
const isStructureElement = (obj) =>
  obj['/S'] !== undefined && obj['/P'] !== undefined && !ACTION_SUBTYPES.has(obj['/S']);

const deref = (value) => value?.value ?? value;
const plainString = (value) => {
  if (typeof value !== 'string') return null;
  if (value.startsWith('u:')) return value.slice(2);
  if (value.startsWith('b:')) return Buffer.from(value.slice(2), 'hex').toString('utf8');
  return null;
};

/**
 * A PDF text string, decoded the way a reader would get it.
 *
 * `plainString` reads `b:` as UTF-8, which is right for the fields it was
 * written for and wrong for a description: three of the corpus's alt strings
 * are hex UTF-16BE with a byte-order mark, and reading those as UTF-8 produces
 * mojibake rather than the file path they actually contain. A first scan that
 * missed them entirely is what proved this matters.
 */
const textString = (value) => {
  if (typeof value !== 'string') return null;
  if (value.startsWith('u:')) return value.slice(2);
  if (!value.startsWith('b:')) return null;
  const bytes = Buffer.from(value.slice(2), 'hex');
  if (bytes[0] !== 0xfe || bytes[1] !== 0xff) return bytes.toString('utf8');
  const be = bytes.subarray(2);
  // swap16 needs an even length and mutates, so copy first.
  return Buffer.from(be.subarray(0, be.length - (be.length % 2))).swap16().toString('utf16le');
};

/**
 * Does this description fail WCAG Technique F30?
 *
 * F30 — "text alternatives that are not alternatives (e.g. filenames or
 * placeholder text)" — names three categories, and this implements those and
 * nothing beyond them. Provenance evidence only: each rule says "a machine put
 * this here", never "this description is poor".
 *
 * DELIBERATELY DUPLICATED from `isPlaceholderAlt` in the product. The
 * independence test forbids this file from importing anything under `src/`, so
 * the rule has to exist twice. Written by one person, the two agree by
 * construction — which means the corrected keys prove what the alt strings ARE,
 * and prove nothing about whether classifying them this way is right.
 */
/** An OOXML attribute value is XML-escaped; F30 is about the decoded string. */
const decodeXmlEntities = (value) => value
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

const ALT_PLACEHOLDER = new Set([
  'decorative', 'spacer', 'image', 'picture', 'graphic', 'photo', 'blank',
  'untitled', 'placeholder',
]);
const ALT_PATH = /^(\\\\|[A-Za-z]:\\|\/Users\/|\/home\/|file:\/\/)/;
const ALT_FILENAME = /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg|eps)$/i;
const ALT_CID = /\bcid:/i;
const ALT_PROGRAMMATIC = /^(picture|image|photo|graphic|figure|img)\s*\d+$|^\d+$/i;

const isPlaceholderAlt = (raw) => {
  if (typeof raw !== 'string') return false;
  // A trailing NUL is a producer's string terminator, not content, and a
  // leading "Description:" is an exporter artifact. Without the first, three
  // legitimate descriptions read as illegible - one of them on r01, the only
  // conformant real PDF in the corpus.
  const s = raw.slice(0, 500)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+$/, '')
    .replace(/^description:\s*/i, '')
    .trim();
  if (s === '') return false; // Empty is a positive claim of no meaning, not a gap.
  return ALT_PATH.test(s) || ALT_CID.test(s) || ALT_FILENAME.test(s)
    || ALT_PLACEHOLDER.has(s.toLowerCase()) || ALT_PROGRAMMATIC.test(s);
};

/**
 * The heading levels a reader meets, in the order a reader meets them.
 *
 * Walking the structure tree, not the object map. The first pass collected
 * heading levels by iterating qpdf's objects, whose order is whatever the file
 * happens to store — so "starts at H3" and "skips a level" were derived from
 * an order no reader experiences, and three documents were credited with
 * heading problems on that basis.
 *
 * Bounded by a seen-set: a structure tree is a tree by intent and a graph in
 * practice, which the planted cyclic fixture exists to prove.
 */
function headingOrder(objects, catalog) {
  const root = catalog?.['/StructTreeRoot'];
  if (typeof root !== 'string') return [];

  const levels = [];
  const seen = new Set();
  const resolve = (ref) => (typeof ref === 'string' && ref.endsWith(' R') ? deref(objects[`obj:${ref}`]) : ref);

  const walk = (ref, depth) => {
    if (depth > 200 || (typeof ref === 'string' && seen.has(ref))) return;
    if (typeof ref === 'string') seen.add(ref);
    const node = resolve(ref);
    if (!node || typeof node !== 'object') return;

    if (typeof node['/S'] === 'string' && HEADING_TYPES.has(node['/S'])) {
      levels.push(node['/S'] === '/H' ? 1 : Number(node['/S'].slice(2)));
    }
    const kids = node['/K'];
    for (const kid of Array.isArray(kids) ? kids : [kids]) {
      if (kid === undefined || typeof kid === 'number') continue;
      walk(kid, depth + 1);
    }
  };

  walk(root, 0);
  return levels;
}

/**
 * veraPDF's 7.18.1-3, read from the objects: *a form field shall have a TU key
 * present, or all its widget annotations shall have alternative descriptions*.
 *
 * The published rule rather than a tighter one of ours, so this reading and the
 * reference checker's can be compared as two independent answers to the same
 * question instead of two different questions.
 *
 * `/TU` is walked up `/Parent` because a field and its widget are often
 * separate objects, and the walk starts at the widget so a merged field-widget
 * dictionary is covered by the same pass. Depth-bounded: a malformed loop must
 * not hang the author.
 */
function hasAccessibleName(widget, objects) {
  const resolve = (ref) => (typeof ref === 'string' && ref.endsWith(' R') ? deref(objects[`obj:${ref}`]) : ref);
  const named = (value) => {
    const text = textString(value);
    return typeof text === 'string' && text.trim() !== '';
  };

  if (named(widget['/Contents'])) return true;

  let node = widget;
  for (let depth = 0; node && typeof node === 'object' && depth < 8; depth += 1) {
    if (named(node['/TU'])) return true;
    node = resolve(node['/Parent']);
  }
  return false;
}

function readPdf(path) {
  const objects = qpdfObjects(path);
  const summary = qpdfSummary(path);

  let catalog = null;
  let info = null;
  const structure = [];
  let annotations = 0;
  let annotationsOutside = 0;
  let formFields = 0;
  let formFieldsWithoutName = 0;
  let signed = false;

  for (const value of Object.values(objects)) {
    const obj = deref(value);
    if (!obj || typeof obj !== 'object') continue;
    if (obj['/Type'] === '/Catalog') catalog = obj;
    if (isStructureElement(obj)) structure.push(obj);
    if (obj['/Type'] === '/Sig' || obj['/FT'] === '/Sig') signed = obj['/V'] !== undefined || obj['/Type'] === '/Sig';
    if (obj['/Type'] === '/Annot' && (obj['/Subtype'] === '/Widget' || obj['/Subtype'] === '/Link')) {
      annotations += 1;
      if (obj['/StructParent'] === undefined) annotationsOutside += 1;
    }
    // A form field's accessible name, read independently of the product.
    // `/TU` is what assistive technology speaks; `/T` is the internal field
    // name and is not a label however descriptive it looks.
    if (obj['/Subtype'] === '/Widget') {
      formFields += 1;
      if (!hasAccessibleName(obj, objects)) formFieldsWithoutName += 1;
    }
    // Document information is untyped, so it is found by its keys. The first
    // run required `/Type` to be absent, which missed a document that declares
    // a title in both docinfo and XMP — and then accused the product of
    // inventing one.
    if (info === null && obj['/Title'] !== undefined && obj['/S'] === undefined) info = obj;
  }

  const headings = structure.filter((e) => HEADING_TYPES.has(e['/S']));
  const figures = structure.filter((e) => e['/S'] === '/Figure');
  const docinfoTitle = info ? plainString(info['/Title']) : null;
  // A title can also live only in the XMP packet, and a document that states
  // one there states one.
  const xmpTitle = /<dc:title>[\s\S]{0,400}?<\/dc:title>/.test(readFileSync(path, 'latin1'));
  const declaredTitle = docinfoTitle;
  const lang = catalog ? plainString(catalog['/Lang']) : null;

  return {
    pages: summary.pages?.length ?? null,
    encrypted: summary.encrypt?.encrypted === true,
    titleAnywhere: docinfoTitle !== null || xmpTitle,
    tagged: catalog?.['/StructTreeRoot'] !== undefined && structure.length > 0,
    marked: catalog?.['/MarkInfo']?.['/Marked'] === true,
    signed,
    language: lang === null || lang === '' ? null : lang,
    declaredTitle,
    headingLevels: headingOrder(objects, catalog),
    counts: {
      headings: headings.length,
      tables: structure.filter((e) => e['/S'] === '/Table').length,
      lists: structure.filter((e) => e['/S'] === '/L').length,
      figures: figures.length,
    },
    figuresWithoutAlt: figures.filter((e) => e['/Alt'] === undefined).length,
    // Counted separately from absent alt, so the two readings can be compared
    // and each correction attributed to the right cause.
    figuresIllegibleAlt: figures.filter(
      (e) => e['/Alt'] !== undefined && isPlaceholderAlt(textString(e['/Alt'])),
    ).length,
    annotations,
    annotationsOutside,
    formFields,
    formFieldsWithoutName,
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
  // DrawingML images AND the legacy VML ones. A document that predates the
  // DrawingML era, or that embeds an OLE object, carries `<v:imagedata>` and
  // no `<wp:docPr>` — the first pass counted four images in a document with
  // five and accused the product of inventing the fifth.
  const drawings = [
    ...doc.matchAll(/<wp:docPr\b[^>]*>/g),
    ...doc.matchAll(/<v:imagedata\b[^>]*>/g),
  ];

  return {
    tagged: null,
    language: /<w:lang[^>]*w:val="([^"]+)"/.exec(styles)?.[1] ?? null,
    declaredTitle: /<dc:title>([^<]*)<\/dc:title>/.exec(core)?.[1] ?? null,
    headingLevels,
    // Recorded as evidence, but NOT turned into a heading-level expectation.
    //
    // These levels describe the SOURCE. What gets graded is the PDF the
    // converter produced, and the two are not the same document: r28's source
    // runs H1, H1, H3 — a skip — and the delivered PDF has twelve headings
    // where the source had thirteen, so the heading that made it a skip did
    // not survive. The product reported the document it delivered, correctly.
    // Predicting output structure from input structure is a category error,
    // and this is where it stops.
    headingLevelsAreSourceOnly: true,
    counts: {
      headings: headingLevels.length,
      tables: (doc.match(/<w:tbl>/g) ?? []).length,
      lists: null,
      figures: drawings.length,
    },
    // `descr` and `title` are both author-supplied descriptions, and the
    // converter carries either into /Alt. Counting only `descr` credited a
    // seal captioned with `title` as undescribed, and then expected a punch
    // item for work somebody had already done.
    figuresWithoutAlt: drawings.filter((m) => !/\b(?:descr|title)="[^"]+"/.test(m[0])).length,
    // The same F30 reading as the PDF path. A `descr` the author never wrote —
    // an exporter's file path, a placeholder word — is not a description just
    // because the attribute is populated, and the converter carries it into
    // /Alt unchanged. Without this the Word half of the corpus reads a
    // placeholder as described while the PDF half does not, and the key author
    // disagrees with itself about the same string.
    figuresIllegibleAlt: drawings.filter((m) => {
      const value = /\b(?:descr|title)="([^"]+)"/.exec(m[0])?.[1];
      return value !== undefined && isPlaceholderAlt(decodeXmlEntities(value));
    }).length,
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
function needsFrom(read, { legibility = true } = {}) {
  const needs = [];
  if (read.language === null) needs.push('3.1.1');
  if (read.annotationsOutside > 0) needs.push('1.3.1');
  if ((read.formFieldsWithoutName ?? 0) > 0) needs.push('4.1.2');
  // Two readings, on purpose. `legibility: false` reproduces the ORIGINAL rule
  // — alt absent — so a correction can be attributed: a difference the old rule
  // already implied is an instrument defect I made, and a difference only the
  // new rule sees is a scope change. Without the split, both land in one
  // integer the protocol reads as a criticism of key quality.
  const undescribed = read.figuresWithoutAlt
    + (legibility ? (read.figuresIllegibleAlt ?? 0) : 0);
  for (let i = 0; i < undescribed; i += 1) needs.push('1.1.1');

  // A Word source's heading levels describe the source, not the PDF that will
  // be graded; see `headingLevelsAreSourceOnly`.
  if (read.headingLevelsAreSourceOnly === true) return needs;

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

/**
 * `--corrections` re-derives the answers and records where they differ from
 * the locked keys, instead of overwriting them.
 *
 * The first run found two defects in THIS file — structure elements counted by
 * an optional `/Type`, and a title detector that missed XMP — and the honest
 * repair of a key is an overlay carrying its evidence, not an edit.
 */
const CORRECTIONS_MODE = process.argv.includes('--corrections');

const EVIDENCE = {
  disposition:
    'qpdf: the catalog carries /StructTreeRoot and structure elements that omit the optional /Type /StructElem,'
    + ' which ISO 32000 permits. The first authoring pass required /Type and so read a tagged document as untagged.',
  counts:
    'qpdf: structure elements counted by shape (/S with a parent, excluding action subtypes) rather than by the'
    + ' optional /Type. Verified to reproduce the same counts on r01, r17 and r22 independently.',
  needs:
    'qpdf: derived from the corrected structure-element reading — heading levels and undescribed figures the first'
    + ' pass could not see.',
  titleDeclared:
    'raw packet: the document declares a title in its XMP dc:title, in document information, or both. The first'
    + ' pass looked only for an untyped dictionary carrying /Title.',
  language: 'qpdf: the catalog /Lang, re-read after the structure fix.',
  legibility:
    'qpdf: figures whose /Alt is PRESENT but fails WCAG Technique F30 — a filename, a path, a cid: reference or a'
    + ' placeholder word. The first pass tested only whether the key was absent, so a description that describes'
    + ' nothing counted as a description. This is a SCOPE CHANGE, not a defect in the earlier reading.',
  default: 'qpdf and the veraPDF CLI, re-read after the authoring defects the first run exposed.',
};

const corrections = [];
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
    // A title in the XMP packet is a declared title even when document
    // information carries none, so the honesty check reads both.
    titleDeclared: read.titleAnywhere ?? read.declaredTitle !== null,
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
        formFields: read.formFields, formFieldsWithoutName: read.formFieldsWithoutName,
        figuresWithoutAlt: read.figuresWithoutAlt,
        ua1: verdict.checked ? { compliant: verdict.compliant, failingClauses: verdict.clauses } : 'unchecked',
      } : {
        headingLevels: read.headingLevels, figuresWithoutAlt: read.figuresWithoutAlt,
      }),
    },
  };

  if (CORRECTIONS_MODE) {
    // The locked key stands. Where a fixed reading disagrees with it, the
    // difference is recorded as a correction with its evidence and stays
    // visible in every future scorecard — a key quietly rewritten after a
    // disappointing run is the one failure mode a blind test cannot survive.
    const locked = JSON.parse(readFileSync(join(KEYS, `${id}.key.json`), 'utf8'));
    // The middle reading is what makes attribution mechanical rather than a
    // judgement about field names: `needs` now carries corrections of BOTH
    // kinds, so classifying by field would conflate them.
    //   locked  -> presenceOnly : the old rule already implied it. My defect.
    //   presenceOnly -> now     : only the new rule sees it. A scope change.
    const presenceOnly = disposition === 'delivered'
      ? needsFrom(read, { legibility: false })
      : [];
    for (const field of ['disposition', 'language', 'titleDeclared', 'counts', 'needs']) {
      const was = locked.expected[field];
      const now = expected[field];
      if (JSON.stringify(was) === JSON.stringify(now)) continue;
      const kind = field === 'needs' && JSON.stringify(was) === JSON.stringify(presenceOnly)
        ? 'scope-change'
        : 'instrument-defect';
      // When a key was ALREADY wrong for another reason, the legibility items
      // land inside an instrument-defect row and vanish from the split. That is
      // the conservative direction — it never inflates the scope-change count —
      // but it under-reports it, so the contribution is recorded outright
      // rather than left to be inferred from a total.
      const legibilityAdded = field === 'needs'
        ? now.filter((c) => c === '1.1.1').length - presenceOnly.filter((c) => c === '1.1.1').length
        : 0;
      corrections.push({
        docId: id,
        field,
        kind,
        ...(legibilityAdded > 0 ? { legibilityAdded } : {}),
        was,
        now,
        evidence: kind === 'scope-change' ? EVIDENCE.legibility : (EVIDENCE[field] ?? EVIDENCE.default),
      });
    }
  } else {
    writeFileSync(join(KEYS, `${id}.key.json`), `${JSON.stringify(key, null, 2)}\n`, 'utf8');
  }
  rows.push({ id, disposition, tagged: read.tagged, clauses: verdict.checked ? verdict.clauses.length : null, needs: expected.needs.length });
}

for (const row of rows) {
  console.log(
    `${row.id.padEnd(8)} ${row.disposition.padEnd(20)} tagged=${String(row.tagged).padEnd(5)}`
    + ` ua1 clauses=${row.clauses === null ? 'n/a' : String(row.clauses).padStart(2)} needs=${row.needs}`,
  );
}
console.log(`\n${CORRECTIONS_MODE ? 're-read' : 'authored'} ${rows.length} real keys from third-party instruments only`);
console.log(`  delivered expected: ${rows.filter((r) => r.disposition === 'delivered').length}`);
console.log(`  refused expected:   ${rows.filter((r) => r.disposition !== 'delivered').length}`);

if (CORRECTIONS_MODE) {
  writeFileSync(join(HERE, 'corrections.json'), `${JSON.stringify(corrections, null, 2)}\n`, 'utf8');
  const touched = new Set(corrections.map((c) => c.docId));
  console.log(`\nwrote ${corrections.length} corrections across ${touched.size} documents to corrections.json`);
  const share = touched.size / rows.length;
  if (share > 0.1) {
    console.log(
      `  ${Math.round(share * 100)}% of real rows corrected — over the 10% the protocol calls a finding`
      + ' about key quality rather than about the product.',
    );
  }
}
if (!existsSync(VERAPDF)) console.error(`\nno veraPDF at ${VERAPDF} — conformance evidence is missing from every key`);
