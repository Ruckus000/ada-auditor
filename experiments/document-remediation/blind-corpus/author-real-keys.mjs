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

  // ISO 32000 requires a conforming reader to resolve a custom structure type
  // through the tree's /RoleMap, and the product does (`Inspect.standard()`).
  // Reading the raw `/S` instead made this instrument disagree with the product
  // on five real documents and call the difference an invented claim: n03 maps
  // /Title -> /H1 six times, n22 maps /Shape and /Vector -> /Figure, n05, n21
  // and n30 one element each. Every one of those was the product being right.
  const roleMap = (() => {
    const raw = catalog?.['/StructTreeRoot'];
    const root = typeof raw === 'string' && raw.endsWith(' R') ? deref(objects[`obj:${raw}`]) : raw;
    const map = root?.['/RoleMap'];
    const resolved = typeof map === 'string' && map.endsWith(' R') ? deref(objects[`obj:${map}`]) : map;
    return resolved && typeof resolved === 'object' ? resolved : {};
  })();
  /** The standard type an element resolves to, one hop through the role map. */
  const roleOf = (e) => {
    const own = e['/S'];
    return HEADING_TYPES.has(own) || own === '/Figure' || own === '/Table' || own === '/L'
      ? own
      : (roleMap[own] ?? own);
  };

  const headings = structure.filter((e) => HEADING_TYPES.has(roleOf(e)));
  const figures = structure.filter((e) => roleOf(e) === '/Figure');
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
      tables: structure.filter((e) => roleOf(e) === '/Table').length,
      lists: structure.filter((e) => roleOf(e) === '/L').length,
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

/**
 * The tag that carries a Word image's description: DrawingML's `wp:docPr`
 * and the legacy VML `v:imagedata`. A document that predates the DrawingML
 * era, or that embeds an OLE object, carries `<v:imagedata>` and no
 * `<wp:docPr>` — the first pass counted four images in a document with five
 * and accused the product of inventing the fifth.
 */
const DRAWING_TAG = /<(?:wp:docPr|v:imagedata)\b[^>]*>/g;
/**
 * `descr` and `title` are both author-supplied descriptions, and the
 * converter carries either into /Alt. Non-empty on purpose: `descr=""` is
 * the attribute present and the description absent.
 */
const DESCRIPTION_ATTRIBUTE = /\b(?:descr|title)="([^"]+)"/;
/** A drawing tag with a description, anywhere in the fragment tested. */
const DESCRIBED_DRAWING = new RegExp(`<(?:wp:docPr|v:imagedata)\\b[^>]*${DESCRIPTION_ATTRIBUTE.source}`);

/**
 * `w:outlineLvl` as a 1-based heading level, or `null` for 9 — "Body Text",
 * the value Word writes to take a paragraph or a style OUT of the outline.
 * Every other value is a heading level; 9 is a declaration that it is not.
 */
const outlineLevelOf = (val) => (val === '9' ? null : Number(val) + 1);

function readDocx(path) {
  const names = execFileSync('unzip', ['-Z1', path], { maxBuffer: 16 * 1024 * 1024 }).toString('utf8').split('\n');
  const part = (name) => (names.includes(name)
    ? execFileSync('unzip', ['-p', path, name], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8')
    : '');

  const doc = part('word/document.xml');
  const styles = part('word/styles.xml');
  const core = part('docProps/core.xml');
  // Every STORY part, not just the body. A table can live in a footnote, an
  // endnote, a header or a text box, and the converter carries it into the PDF
  // as a table like any other. Reading only `word/document.xml` counted n42's
  // single table — which sits in `word/footnotes.xml` — as zero, and then
  // accused the product of inventing it.
  const stories = names
    .filter((n) => /^word\/(document|footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(n))
    .map((n) => part(n))
    .join('');

  // A heading is a paragraph with an OUTLINE LEVEL. A style called `HeadingN`
  // is merely the commonest way to acquire one, and matching that name was this
  // instrument's third failure of the same kind: reading a document more
  // narrowly than a conforming consumer does, then calling the difference an
  // invention by the product.
  //
  // `[V]` n50 declares its entire outline with 84 direct `w:outlineLvl` on
  // otherwise unstyled paragraphs and zero `HeadingN` — the key said 0 while the
  // delivered PDF correctly carried 49. n41 uses `contactheading`, which is
  // `w:basedOn="Heading2"` and inherits that style's level — the key said 34
  // against a correct 43. Both were scored as invented claims against a product
  // that had read the document right.
  //
  // The three shapes, after `extract-docx-truth.mjs:88-124`, which already
  // records two of them from the earlier campaign ("one municipal document used
  // a style literally named 'Heading', no digit"; "four documents declared all
  // their structure that way, zero pStyle in the body"). Copied rather than
  // imported for the reason `isPlaceholderAlt` is copied above: the
  // independence test forbids this file from reaching outside its own
  // directory, and one person writing the rule twice is the price of that.
  // The `w:basedOn` chain is NEW here — that shape defeated the earlier
  // implementation too.
  //
  // Level 9 is "Body Text" — the tenth value of `w:outlineLvl`, which Word
  // writes when an author (or a template) takes a style OUT of the outline.
  // It is an explicit override, so it STOPS the `w:basedOn` walk: a style
  // that says 9 is not a heading even when the style it descends from is.
  // `[V]` r23 and r30 both carry `TOCHeading`, `basedOn Heading1` and its
  // own `outlineLvl 9` — the table-of-contents title, which Word's
  // navigation pane leaves out, Word's own PDF export writes as body text,
  // and LibreOffice imports as `<text:index-title>` with
  // `default-outline-level=""`. A `[0-8]` range here never let 9 into `own`,
  // so the walk fell through to `Heading1` and read the title as an H1 —
  // the 36 / 9 "corrections" of 2026-09-03, retracted the same day once the
  // style was read. A level-9 style is stored as `null` so `has()` is true
  // and the walk stops there.
  const styleLevel = (() => {
    const own = new Map();
    const basedOn = new Map();
    for (const block of styles.matchAll(/<w:style [^>]*w:styleId="([^"]+)"[\s\S]*?<\/w:style>/g)) {
      const id = block[1];
      const level = /<w:outlineLvl w:val="([0-9])"\s*\/?>/.exec(block[0]);
      if (level) own.set(id, outlineLevelOf(level[1]));
      const parent = /<w:basedOn w:val="([^"]+)"\s*\/?>/.exec(block[0]);
      if (parent) basedOn.set(id, parent[1]);
    }
    // Resolve inheritance. Depth-bounded rather than cycle-detected: a
    // malformed style graph is a document defect and must not hang the author.
    const resolved = new Map(own);
    for (const id of basedOn.keys()) {
      if (resolved.has(id)) continue;
      let cursor = id;
      for (let hop = 0; hop < 8; hop += 1) {
        cursor = basedOn.get(cursor);
        if (cursor === undefined) break;
        if (own.has(cursor)) { resolved.set(id, own.get(cursor)); break; }
      }
    }
    return resolved;
  })();

  const headingLevels = [];
  for (const m of doc.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const para = m[0];
    // Only paragraphs that SAY something. `removeEmptyHeadings`
    // (`flat-odf.ts`) deletes blank headings on the way through, so counting
    // them here would make the key disagree with the delivered document by
    // exactly the number of blanks — 35 of them on n50.
    //
    // "Says something" is the PRODUCT's test, mirrored: it strips the tags
    // from the heading's flat-ODF form and asks whether anything is left. A
    // drawing the author described leaves something — the importer lands
    // `descr` in `svg:desc` and `title` in `svg:title`, both of which read as
    // text after the strip — so a heading whose only run is a described image
    // survives and is exported as /H over a /Figure. A `<w:t>`-only test here
    // calls that heading empty. The two emptiness tests must agree, and r28
    // is the document that showed they did not: paragraph 47 is a Heading2
    // holding one described drawing and no text, the product delivered it as
    // the twelfth heading, and this instrument's `<w:t>` reading said eleven —
    // which the scorer would have graded as invented structure against a
    // converter that had carried the author's own image correctly. A drawing
    // with NO description leaves nothing, on both sides: the product demotes
    // that heading to a paragraph and keeps the figure for the punch list.
    const text = [...para.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => t[1]).join('');
    if (text.trim() === '' && !DESCRIBED_DRAWING.test(para)) continue;
    // Direct formatting first: it overrides the style, which is what OOXML says
    // and what the converter honours. A direct 9 is body text too.
    const direct = /<w:outlineLvl w:val="([0-9])"\s*\/?>/.exec(para);
    const style = /w:pStyle w:val="([^"]+)"/.exec(para)?.[1];
    const fromStyle = style === undefined
      ? null
      : styleLevel.has(style)
        ? styleLevel.get(style)
        : (/^Heading([1-9])$/.exec(style) ? Number(style.slice(7)) : null);
    const level = direct ? outlineLevelOf(direct[1]) : fromStyle;
    if (level !== null) headingLevels.push(level);
  }
  // DrawingML images AND the legacy VML ones; see `DRAWING_TAG`.
  const drawings = [...doc.matchAll(DRAWING_TAG)];

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
      // The COUNT is not the same claim as the LEVELS above, and the comment
      // there does not reach it.
      //
      // A level SEQUENCE cannot be predicted from the source: r28's source runs
      // H1, H1, H3, and whether that skip survives depends on what the exporter
      // does with the heading that made it. A count is a different thing — a
      // fidelity expectation, and one the product is supposed to meet, because
      // carrying an author's headings across is the conversion's whole job.
      //
      // It is graded asymmetrically on purpose (`score.ts`): MORE headings than
      // the source had is `invented-structure` and fatal, which is the corpus's
      // only guard against the converter fabricating structure; FEWER is
      // `counts-off` and a non-fatal note on a probe row, because a heading
      // that does not survive is a finding to look at rather than a promise
      // broken. Do not delete this check to silence those notes.
      //
      // RESOLVED (2026-09-03): r28 (key 13, delivered 12) and r32 (key 5,
      // delivered 4) were never headings lost in conversion. Both keys were
      // authored under this file's FIRST rule — a `HeadingN` style-name match
      // with no `w:basedOn` and no empty-paragraph skip — at `5ad8352`, and
      // when the rule changed at `56a08b2` its corrections run was
      // `--only=n`, so the `r` cohort kept its pre-fix answers. r32's fifth
      // "heading" is a page break in a Heading2 paragraph, which the product
      // rightly deletes; r28's twelfth is the described-image heading the
      // loop above now counts.
      //
      // RETRACTED THE SAME DAY: that pass also read r23 as 36 and r30 as 9
      // against deliveries of 35 and 8, and called the difference a TOC
      // heading the conversion drops. It was this file's `[0-8]` range: each
      // document's `TOCHeading` style is based on `Heading1` AND carries its
      // own `outlineLvl 9`, the body-text level, which the range could not
      // see — so the walk fell through to the parent. The title is not a
      // heading in Word's outline, in Word's PDF export or in LibreOffice's
      // import, and the delivered 35 / 8 were right. Promoting it in the
      // product would tag as a heading something its author declared not to
      // be one; the decision is to leave the product alone and fix the
      // instrument. See `docs/research/document-remediation/word-keys-2026-09-03.md`,
      // "Second correction".
      headings: headingLevels.length,
      tables: (stories.match(/<w:tbl[ >]/g) ?? []).length,
      lists: null,
      figures: drawings.length,
    },
    // Either description attribute counts (`DESCRIPTION_ATTRIBUTE`). Counting
    // only `descr` credited a seal captioned with `title` as undescribed, and
    // then expected a punch item for work somebody had already done.
    figuresWithoutAlt: drawings.filter((m) => !DESCRIPTION_ATTRIBUTE.test(m[0])).length,
    // The same F30 reading as the PDF path. A `descr` the author never wrote —
    // an exporter's file path, a placeholder word — is not a description just
    // because the attribute is populated, and the converter carries it into
    // /Alt unchanged. Without this the Word half of the corpus reads a
    // placeholder as described while the PDF half does not, and the key author
    // disagrees with itself about the same string.
    figuresIllegibleAlt: drawings.filter((m) => {
      const value = DESCRIPTION_ATTRIBUTE.exec(m[0])?.[1];
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

/**
 * `--only=<prefix>` authors keys for one cohort and leaves every other locked
 * key alone.
 *
 * Without it, default mode rewrites EVERY key in `keys/` from the current
 * reading — which for the documents already locked would silently replace the
 * answers the product has been graded against, and erase the corrections that
 * record where the instrument was wrong. That is the one failure mode a blind
 * test cannot survive, so adding a second cohort has to be able to say which
 * cohort it means.
 */
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice('--only='.length);

/**
 * With `--only`, corrections for every OTHER cohort have to survive the write.
 *
 * `corrections.json` is rebuilt from the rows this run processed, so running a
 * single cohort would drop every correction belonging to the others — 42 of
 * them, the whole record of where this instrument has been wrong before. The
 * same shape overwrote `real-manifest.json` during the harvest. A file that is
 * a RECORD must be merged, never rewritten from a partial pass.
 */
function mergeCorrections(fresh) {
  if (!ONLY) return fresh;
  const path = join(HERE, 'corrections.json');
  if (!existsSync(path)) return fresh;
  const prior = JSON.parse(readFileSync(path, 'utf8'));
  // Ordered by document, stably, so re-running one cohort leaves every other
  // row where it was instead of moving the re-run cohort to the end — a
  // record whose diff is mostly relocation hides the one line that changed.
  return [...prior.filter((c) => !c.docId.startsWith(ONLY)), ...fresh]
    .sort((a, b) => (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0));
}

const EVIDENCE = {
  disposition:
    'qpdf: the catalog carries /StructTreeRoot and structure elements that omit the optional /Type /StructElem,'
    + ' which ISO 32000 permits. The first authoring pass required /Type and so read a tagged document as untagged.',
  counts:
    'qpdf: structure elements counted by shape (/S with a parent, excluding action subtypes) rather than by the'
    + ' optional /Type, and resolved one hop through the structure tree /RoleMap, which ISO 32000 requires a'
    + ' conforming reader to apply and this instrument previously ignored — n03 maps /Title to /H1 six times,'
    + ' n22 maps /Shape and /Vector to /Figure, n05, n21 and n30 one element each. For Word sources, tables are'
    + ' counted across every story part (footnotes, endnotes, headers, footers) rather than word/document.xml'
    + ' alone: n42 carries its only table in word/footnotes.xml. Every one of these differences was the product'
    + ' reading the document correctly and this instrument reading it wrongly.',
  countsWord:
    'unzip: a Word heading is a paragraph with an outline level — a direct w:outlineLvl, or its style\'s level'
    + ' resolved through w:basedOn — that SAYS something: text, or a drawing carrying a non-empty descr or title.'
    + ' That is the product\'s own emptiness test mirrored (removeEmptyHeadings strips tags, and a description'
    + ' lands in svg:desc). The locked keys were authored at 5ad8352 under a HeadingN style-name match with no'
    + ' w:basedOn and no empty-paragraph skip; the rule changed at 56a08b2, whose corrections run was --only=n,'
    + ' so the r cohort kept its pre-fix answers until 2026-09-03. r32\'s fifth "heading" is a page break in a'
    + ' Heading2 paragraph; r28\'s twelfth is a Heading2 whose only run is a described image, delivered as /H2'
    + ' over a /Figure. A style\'s own outlineLvl 9 (Word\'s body-text level) is an explicit override that'
    + ' stops the basedOn walk: r23 and r30 carry TOCHeading, based on Heading1 with its own level 9, and a'
    + ' [0-8] range read that title as an H1 (36 / 9) on 2026-09-03 before the same day\'s second pass read'
    + ' the style; the deliveries of 35 / 8 were right and those two corrections are withdrawn. Figures count'
    + ' DrawingML wp:docPr and VML v:imagedata both (r34 embeds an OLE object as VML); tables are counted'
    + ' across every story part (n42 carries its only table in word/footnotes.xml).',
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
  if (ONLY && !file.startsWith(ONLY)) continue;
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
        evidence: kind === 'scope-change'
          ? EVIDENCE.legibility
          : (field === 'counts' && !isPdf ? EVIDENCE.countsWord : (EVIDENCE[field] ?? EVIDENCE.default)),
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
  const allCorrections = mergeCorrections(corrections);
  writeFileSync(join(HERE, 'corrections.json'), `${JSON.stringify(allCorrections, null, 2)}\n`, 'utf8');
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
