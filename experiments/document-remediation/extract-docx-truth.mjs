// Reads a .docx's OWN statement of its structure, from its XML.
//
// This is the fidelity oracle for the conversion arm: a .docx is a ZIP of
// XML, so the source's real headings, tables, lists, figure alt, declared
// language and title are readable facts, not guesses — for REAL documents as
// much as generated ones. Run over the generated corpus it also cross-checks
// the generator: extractor and keys must agree, which catches a bug in either.
//
// Legacy .doc is OLE, not ZIP, and is out of scope here by documented
// limitation — those documents get outcome-level checks only.
//
// Usage: node extract-docx-truth.mjs <file.docx|dir> [outDir]
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { readLanguage } from '../../src/integrations/documents/flat-odf.ts';

const SOFFICE = process.env.SOFFICE_PATH ?? '/Applications/LibreOffice.app/Contents/MacOS/soffice';

function extractDocTruthViaFodt(docPath) {
  const work = mkdtempSync(join(tmpdir(), 'doc-truth-'));
  try {
    execFileSync(SOFFICE, [
      '--headless', `-env:UserInstallation=file://${work}/p`,
      '--convert-to', 'fodt', '--outdir', work, docPath,
    ], { stdio: 'ignore', timeout: 120_000 });
    const fodt = readdirSync(work).find((f) => f.endsWith('.fodt'));
    if (!fodt) return null;
    const xml = readFileSync(join(work, fodt), 'utf8');
    const headingLevels = [...xml.matchAll(/<text:h\b[^>]*text:outline-level="(\d+)"[^>]*>([\s\S]*?)<\/text:h>/g)]
      .filter((m) => m[2].replace(/<[^>]+>/g, '').trim() !== '')
      .map((m) => Number(m[1]));
    const frames = [...xml.matchAll(/<draw:frame\b[\s\S]*?<\/draw:frame>/g)].map((m) => m[0])
      .filter((f) => f.includes('<draw:image'));
    return {
      file: basename(docPath),
      readable: true,
      oracle: 'engine-derived',
      title: /<dc:title>([\s\S]*?)<\/dc:title>/.exec(xml)?.[1]?.trim() || null,
      // The PIPELINE's own composition (language + country), imported, not
      // reimplemented: `[V]` a second parser over the same fodt read "en"
      // where readLanguage composes "en-US", and the grader reported seven
      // inventions that were two parsers disagreeing about one file.
      language: readLanguage(xml),
      headings: headingLevels.length,
      headingLevels,
      tables: [...xml.matchAll(/<table:table\b/g)].length,
      lists: [...xml.matchAll(/<text:list\b/g)].length,
      listItems: [...xml.matchAll(/<text:list-item\b/g)].length,
      figures: frames.length,
      figuresWithAlt: frames.filter((f) => /<svg:(?:desc|title)>/.test(f)).length,
    };
  } catch {
    return null;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function part(docx, name) {
  try {
    return execFileSync('unzip', ['-p', docx, name], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  } catch {
    return null; // The part is optional in the format; absent is a fact.
  }
}

const count = (text, re) => (text.match(re) ?? []).length;

export function extractTruth(docx) {
  const doc = part(docx, 'word/document.xml');
  if (doc === null) {
    // Legacy OLE .doc has no XML to read. The fallback oracle converts to
    // flat ODF with LibreOffice and reads THAT — engine-derived truth,
    // labeled as such: it grades fidelity of the export half only, because
    // the importer produced the reference. Weaker than source truth, far
    // better than ungraded.
    const viaFodt = extractDocTruthViaFodt(docx);
    if (viaFodt !== null) return viaFodt;
    return { file: basename(docx), readable: false };
  }

  const core = part(docx, 'docProps/core.xml') ?? '';
  const styles = part(docx, 'word/styles.xml') ?? '';

  // Headings: any paragraph whose STYLE DEFINITION carries an outline level
  // (covers HeadingN and every custom style — `[V]` one municipal document
  // used a style literally named "Heading", no digit), plus paragraphs with a
  // direct-formatting `w:outlineLvl` (`[V]` four documents declared all their
  // structure that way, zero pStyle in the body). The pStyle-name-only first
  // version under-read both shapes and mis-graded legitimate transcription as
  // invention — the extractor-bug case the predictions pre-registered.
  // Two passes on purpose: an optional group inside a lazy match is simply
  // skipped, so the one-regex version never captured a level. Find each style
  // block first, then look inside it.
  const styleLevel = new Map();
  for (const block of styles.matchAll(/<w:style [^>]*w:styleId="([^"]+)"[\s\S]*?<\/w:style>/g)) {
    const level = /<w:outlineLvl w:val="([0-8])"\/>/.exec(block[0]);
    if (level) styleLevel.set(block[1], Number(level[1]) + 1);
  }
  // Per PARAGRAPH, and only paragraphs that carry text: `[V]` every heading
  // "lost" in conversion was an empty one — a blank heading-styled line —
  // and the pipeline now deletes those as the defects they are, so truth
  // counts what a reader can hear: headings that say something.
  const headingLevels = [];
  for (const m of doc.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const para = m[0];
    // Content, not tag presence: a generator (or Word itself, pasting) can
    // leave an empty <w:t></w:t>, and a tag that says nothing is as silent
    // as no tag. One definition of "empty" across generator, pipeline and
    // truth, or the three drift — measured, twice, today.
    const text = [...para.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => t[1]).join('');
    if (text.trim() === '') continue;
    const style = /w:pStyle w:val="([^"]+)"/.exec(para)?.[1];
    const fromStyle = style ? styleLevel.get(style) ?? (/^Heading([1-9])$/.exec(style) ? Number(style.slice(7)) : null) : null;
    const direct = /<w:outlineLvl w:val="([0-8])"\/>/.exec(para);
    const level = fromStyle ?? (direct ? Number(direct[1]) + 1 : null);
    if (level !== null) headingLevels.push(level);
  }

  // Figures and their alt, in BOTH image dialects: DrawingML (wp:docPr,
  // descr= carries the alt) and VML (`[V]` one real municipal document held
  // its two images as OLE-embedded v:shape/v:imagedata WMFs — invisible to a
  // docPr-only count, which mis-read the pipeline's honest 1.1.1 gap as an
  // import invention). VML alt lives on the shape's alt= attribute.
  const docPr = [...doc.matchAll(/<wp:docPr [^>]*>/g)].map((m) => m[0]);
  const vmlWithImage = [...doc.matchAll(/<v:shape\b[^>]*>(?:(?!<\/v:shape>)[\s\S])*?<v:imagedata/g)].map((m) => m[0]);
  const figures = docPr.length + vmlWithImage.length;
  const figuresWithAlt =
    docPr.filter((tag) => /descr="[^"]/.test(tag)).length +
    vmlWithImage.filter((block) => /<v:shape\b[^>]*\balt="[^"]/.test(block)).length;

  // Language: the docDefaults run language — absent means the document
  // declares none, which is itself the claim under test in one stratum.
  const lang = /w:lang w:val="([^"]+)"/.exec(styles)?.[1] ?? null;

  const titleMatch = /<dc:title>([\s\S]*?)<\/dc:title>/.exec(core);
  const title = titleMatch && titleMatch[1].trim() !== '' ? titleMatch[1].trim() : null;

  return {
    file: basename(docx),
    readable: true,
    title,
    language: lang,
    headings: headingLevels.length,
    headingLevels,
    tables: count(doc, /<w:tbl>/g),
    // Distinct numbering ids in use, matching how Inspect counts a list once.
    lists: new Set([...doc.matchAll(/w:numId w:val="(\d+)"/g)].map((m) => m[1])).size,
    // ITEMS, which is what fidelity compares: `[V]` the export splits one
    // Word numbering group into several PDF `L` structures at interruptions
    // (1 source group became 12 delivered lists on one real document), so
    // group counts disagree between honest instruments while the item count
    // is the same list content on both sides.
    listItems: [...doc.matchAll(/<w:numPr>/g)].length,
    figures,
    figuresWithAlt,
  };
}

const [target, outDir] = process.argv.slice(2);
if (target) {
  const files = statSync(target).isDirectory()
    ? readdirSync(target).filter((f) => /\.docx?$/.test(f)).map((f) => join(target, f))
    : [target];
  if (outDir) mkdirSync(outDir, { recursive: true });
  for (const file of files) {
    const truth = extractTruth(file);
    if (outDir) {
      writeFileSync(join(outDir, `${basename(file).replace(/\.docx?$/, '')}.truth.json`), JSON.stringify(truth, null, 2) + '\n');
    } else {
      console.log(JSON.stringify(truth));
    }
  }
  if (outDir) console.log(`wrote ${files.length} truth files to ${outDir}`);
}
