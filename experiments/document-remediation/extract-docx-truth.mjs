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
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

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
  if (doc === null) return { file: basename(docx), readable: false };

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
  const headingLevels = [
    ...[...doc.matchAll(/w:pStyle w:val="([^"]+)"/g)]
      .map((m) => styleLevel.get(m[1]) ?? (/^Heading([1-9])$/.exec(m[1]) ? Number(/^Heading([1-9])$/.exec(m[1])[1]) : null))
      .filter((level) => level !== null),
    ...[...doc.matchAll(/<w:outlineLvl w:val="([0-8])"\/>/g)].map((m) => Number(m[1]) + 1),
  ];

  // Figures and their alt: every inline/anchored drawing has a docPr; alt is
  // its descr attribute, present or not.
  const docPr = [...doc.matchAll(/<wp:docPr [^>]*>/g)].map((m) => m[0]);
  const figures = docPr.length;
  const figuresWithAlt = docPr.filter((tag) => /descr="[^"]/.test(tag)).length;

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
    figures,
    figuresWithAlt,
  };
}

const [target, outDir] = process.argv.slice(2);
if (target) {
  const files = statSync(target).isDirectory()
    ? readdirSync(target).filter((f) => f.endsWith('.docx')).map((f) => join(target, f))
    : [target];
  if (outDir) mkdirSync(outDir, { recursive: true });
  for (const file of files) {
    const truth = extractTruth(file);
    if (outDir) {
      writeFileSync(join(outDir, `${basename(file, '.docx')}.truth.json`), JSON.stringify(truth, null, 2) + '\n');
    } else {
      console.log(JSON.stringify(truth));
    }
  }
  if (outDir) console.log(`wrote ${files.length} truth files to ${outDir}`);
}
