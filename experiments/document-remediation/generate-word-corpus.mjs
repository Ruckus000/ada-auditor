// Writes the Arm A generated corpus: 30 .docx files plus their frozen keys.
//
// The OOXML is authored HERE, byte by byte, and that is the point: LibreOffice
// is the engine under test, so the inputs must come from an independent
// producer, and a .docx is only a ZIP of small XML parts. `zip -X` does the
// packaging; `xmllint` gates well-formedness of every part before a document
// is allowed into the corpus, so a generator bug fails generation, not the
// system under test.
//
// Keys are emitted beside the bytes and TRACKED (they are authored intent,
// reviewable and frozen before any run); the .docx bytes and media are
// gitignored like every other corpus output — the repo tracks zero binaries.
//
// Usage: node generate-word-corpus.mjs        # writes word-corpus/
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'word-corpus';
const KEYS = join(OUT, 'keys');

// A 1x1 red PNG. Inline so the repo carries no image file; it exists only
// inside generated (ignored) bytes.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function esc(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- paragraph builders ------------------------------------------------

const para = (text, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

const heading = (level, text) => para(text, `Heading${level}`);

/** Bold + large by direct formatting — visually a heading, structurally not. */
const fakeHeading = (text) =>
  `<w:p><w:r><w:rPr><w:b/><w:sz w:val="48"/></w:rPr><w:t>${esc(text)}</w:t></w:r></w:p>`;

const listItem = (numId, text) =>
  `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${esc(text)}</w:t></w:r></w:p>`;

const pageBreak = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/** A paragraph containing an external hyperlink (needs rIdLink1 in rels). */
const linkPara = (text, label) =>
  `<w:p><w:r><w:t xml:space="preserve">${esc(text)} </w:t></w:r><w:hyperlink r:id="rIdLink1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:r><w:rPr><w:u w:val="single"/><w:color w:val="0000EE"/></w:rPr><w:t>${esc(label)}</w:t></w:r></w:hyperlink></w:p>`;

const cell = (text) => `<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${para(text)}</w:tc>`;

const table = (rows) =>
  `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>` +
  rows.map((r) => `<w:tr>${r.map(cell).join('')}</w:tr>`).join('') +
  `</w:tbl>`;

/** An inline image; `alt` null omits the description outright. */
const figure = (alt, relId = 'rIdImg1') =>
  `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Figure 1"${alt === null ? '' : ` descr="${esc(alt)}"`}/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="Figure 1"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

// ---- document parts ----------------------------------------------------

function stylesXml(lang) {
  // `lang: null` means the document declares NO language anywhere — the
  // stratum that measures whether absence survives to an absent /Lang.
  const langRun = lang === null ? '' : `<w:lang w:val="${lang}"/>`;
  const headings = [1, 2, 3]
    .map(
      (n) =>
        `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${36 - n * 4}"/></w:rPr></w:style>`,
    )
    .join('');
  return `${XML_DECL}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/>${langRun}</w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${headings}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style></w:styles>`;
}

const NUMBERING = `${XML_DECL}<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

function coreXml(title) {
  // No <dc:title> element at all when untitled — an empty element is a
  // different (and wrong) claim.
  return `${XML_DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">${title === null ? '' : `<dc:title>${esc(title)}</dc:title>`}</cp:coreProperties>`;
}

function contentTypes(hasImage) {
  return `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${hasImage ? '<Default Extension="png" ContentType="image/png"/>' : ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
}

const ROOT_RELS = `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

function docRels(hasImage, hasLink) {
  return `${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSty" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${hasImage ? '<Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' : ''}${hasLink ? '<Relationship Id="rIdLink1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/agendas" TargetMode="External"/>' : ''}</Relationships>`;
}

const documentXml = (body) =>
  `${XML_DECL}<w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`;

// ---- the strata --------------------------------------------------------
//
// Each entry is a document plus its FROZEN key: planted structure and the
// expected outcome, including expected honest failures. `expected.gaps`
// lists criterion prefixes the delivered file may legitimately carry;
// anything else read from the output is a finding against the system.

const LOREM =
  'The council reviewed the drainage assessment and resolved to continue monitoring through the next quarter. Residents may submit written comment during ordinary business hours.';

const STRATA = [];

function add(id, tests, opts) {
  STRATA.push({ id, tests, ...opts });
}

// -- baseline and structure singles --------------------------------------
add('a01-baseline', 'The easy case: titled, en-US, full hierarchy. A failure here is a failure everywhere.', {
  title: 'Quarterly Operations Summary', lang: 'en-US',
  body: [heading(1, 'Quarterly Operations Summary'), para(LOREM), heading(2, 'Throughput'), para(LOREM), heading(3, 'Regional detail'), para(LOREM)],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 3, tables: 0, lists: 0, figures: 0, gaps: [] },
});
add('a02-headings-only', 'Headings with minimal prose; hierarchy must survive exactly.', {
  title: 'Agenda', lang: 'en-US',
  body: [heading(1, 'Agenda'), heading(2, 'Old business'), heading(2, 'New business'), heading(3, 'Budget line'), heading(2, 'Adjournment')],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 5, tables: 0, lists: 0, figures: 0, gaps: [] },
});
add('a03-simple-table', 'One data table with a header row.', {
  title: 'Fee Schedule', lang: 'en-US',
  body: [heading(1, 'Fee Schedule'), table([[ 'Permit', 'Fee' ], [ 'Fence', '$25' ], [ 'Deck', '$40' ]])],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 1, tables: 1, lists: 0, figures: 0, gaps: [] },
});
add('a04-lists', 'A bulleted and a numbered list.', {
  title: 'Meeting Notes', lang: 'en-US',
  body: [heading(1, 'Meeting Notes'), listItem(1, 'Call to order'), listItem(1, 'Roll call'), listItem(2, 'Approve minutes'), listItem(2, 'Adjourn')],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 1, tables: 0, lists: 2, figures: 0, gaps: [] },
});
add('a05-figure-with-alt', 'One image carrying alt text; the alt must survive to the PDF.', {
  title: 'Site Plan', lang: 'en-US', image: true,
  body: [heading(1, 'Site Plan'), figure('Plat map of the Mill Lane subdivision'), para(LOREM)],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 1, tables: 0, lists: 0, figures: 1, gaps: [] },
});
add('a06-figure-no-alt', 'One image with NO alt: the delivered file must carry the 1.1.1 gap, honestly.', {
  title: 'Site Plan', lang: 'en-US', image: true,
  body: [heading(1, 'Site Plan'), figure(null), para(LOREM)],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 1, tables: 0, lists: 0, figures: 1, gaps: ['1.1.1'] },
});

// -- truth traps ---------------------------------------------------------
add('a07-untitled-no-h1', 'No title, no heading — the filename is the last transcription source. POLICY 2026-08-27b: filename-derived titles (user-approved); before it this stratum expected the honest gap.', {
  title: null, lang: 'en-US',
  body: [para(LOREM), para(LOREM)],
  expected: { outcome: 'delivered', title: 'filename-derived', titleText: 'a07 untitled no h1', language: 'en-US', headings: 0, tables: 0, lists: 0, figures: 0, gaps: [] },
});
add('a08-untitled-with-h1', 'No title, but an H1 to transcribe: provenance must read transcribed, and the text must equal the H1.', {
  title: null, lang: 'en-US',
  body: [heading(1, 'Planning Committee Agenda'), para(LOREM)],
  expected: { outcome: 'delivered', title: 'transcribed', titleText: 'Planning Committee Agenda', language: 'en-US', headings: 1, tables: 0, lists: 0, figures: 0, gaps: [] },
});
add('a09-no-language', 'NO language declared anywhere. The output /Lang must be ABSENT — an invented en-US is the hard-fail this stratum exists to catch.', {
  title: 'Notice', lang: null,
  body: [heading(1, 'Notice'), para(LOREM)],
  expected: { outcome: 'delivered', title: 'already-titled', language: null, headings: 1, tables: 0, lists: 0, figures: 0, gaps: ['3.1.1'] },
});
add('a10-language-es', 'Spanish document; es must survive as es.', {
  title: 'Aviso Publico', lang: 'es',
  body: [heading(1, 'Aviso Publico'), para('El consejo revisara la solicitud durante la proxima sesion ordinaria.')],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'es', headings: 1, tables: 0, lists: 0, figures: 0, gaps: [] },
});
add('a11-language-bare-en', 'Bare en, which LibreOffice measurably widens to en-US when left alone; the pipeline must not.', {
  title: 'Notice', lang: 'en',
  body: [heading(1, 'Notice'), para(LOREM)],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en', headings: 1, tables: 0, lists: 0, figures: 0, gaps: [] },
});

// -- abstention traps ----------------------------------------------------
add('a12-fake-headings', 'Bold 24pt direct formatting masquerading as headings. The honest output has ZERO headings; inventing them is the failure.', {
  title: 'Community Update', lang: 'en-US',
  body: [fakeHeading('Community Update'), para(LOREM), fakeHeading('Road Work'), para(LOREM)],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 0, tables: 0, lists: 0, figures: 0, gaps: [] },
});
add('a13-layout-table', 'A table used purely for page layout. Recorded as what the system can see: one table. The key documents the limitation rather than pretending detection.', {
  title: 'Newsletter', lang: 'en-US',
  body: [heading(1, 'Newsletter'), table([[LOREM, LOREM]])],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 1, tables: 1, lists: 0, figures: 0, gaps: [] },
});
add('a14-manual-bullets', 'Hyphen-prefixed paragraphs that LOOK like a list; the honest reading is zero lists.', {
  title: 'Checklist', lang: 'en-US',
  body: [heading(1, 'Checklist'), para('- bring the survey'), para('- bring the deed'), para('- bring photo identification')],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 1, tables: 0, lists: 0, figures: 0, gaps: [] },
});

// -- robustness ----------------------------------------------------------
add('a15-empty', 'A structurally valid docx with an empty body: nothing to tag, so the pipeline must refuse as not-tagged rather than deliver an empty success.', {
  title: null, lang: 'en-US',
  body: [para('')],
  expected: { outcome: 'refused', refusal: 'not-tagged' },
});
add('a16-single-char', 'One character of content; the filename still names it. POLICY 2026-08-27b.', {
  title: null, lang: 'en-US',
  body: [para('x')],
  expected: { outcome: 'delivered', title: 'filename-derived', titleText: 'a16 single char', language: 'en-US', headings: 0, tables: 0, lists: 0, figures: 0, gaps: [] },
});
add('a17-long-document', '~110 pages via explicit breaks: the performance row against the 60s-per-call ceiling.', {
  title: 'Comprehensive Plan', lang: 'en-US',
  body: [heading(1, 'Comprehensive Plan'), ...Array.from({ length: 110 }, (_, i) => [heading(2, `Section ${i + 1}`), para(LOREM), pageBreak()]).flat()],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 111, tables: 0, lists: 0, figures: 0, gaps: [] },
});
add('a18-cjk', 'Chinese text with zh-CN declared; the charset path the childEnv locale rule protects.', {
  title: '公告', lang: 'zh-CN',
  body: [heading(1, '公告'), para('市议会将于下周二举行例会。')],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'zh-CN', headings: 1, tables: 0, lists: 0, figures: 0, gaps: [] },
});
add('a19-rtl-arabic', 'Arabic with ar declared.', {
  title: 'إعلان', lang: 'ar',
  body: [heading(1, 'إعلان'), para('سيعقد المجلس جلسته القادمة يوم الثلاثاء.')],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'ar', headings: 1, tables: 0, lists: 0, figures: 0, gaps: [] },
});
add('a20-emoji', 'Emoji and symbols in headings and body.', {
  title: 'Parks Update', lang: 'en-US',
  body: [heading(1, 'Parks Update ☀️'), para('Pool hours → extended. ⚠️ Diving board closed.')],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 1, tables: 0, lists: 0, figures: 0, gaps: [] },
});
add('a21-merged-cells', 'A table with a merged header cell spanning two columns.', {
  title: 'Budget', lang: 'en-US',
  body: [heading(1, 'Budget'), `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${para('Fiscal 2026')}</w:tc></w:tr><w:tr>${cell('Revenue')}${cell('$1.2M')}</w:tr></w:tbl>`],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 1, tables: 1, lists: 0, figures: 0, gaps: [] },
});
add('a22-deep-nesting', 'Headings skipping levels: H1 then H3. Transcription means the skip survives; repairing it would be invention.', {
  title: 'Zoning Digest', lang: 'en-US',
  body: [heading(1, 'Zoning Digest'), heading(3, 'Variances'), para(LOREM)],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 2, tables: 0, lists: 0, figures: 0, gaps: [] },
});
add('a23-mixed-everything', 'Headings, table, both lists, figure with alt, in one document.', {
  title: 'Annual Report', lang: 'en-US', image: true,
  body: [heading(1, 'Annual Report'), para(LOREM), heading(2, 'Financials'), table([[ 'Line', 'Amount' ], [ 'Roads', '$300k' ]]), heading(2, 'Priorities'), listItem(1, 'Drainage'), listItem(1, 'Sidewalks'), listItem(2, 'Phase one'), figure('Photograph of the resurfaced portion of Main Street')],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 3, tables: 1, lists: 2, figures: 1, gaps: [] },
});
add('a24-whitespace-title', 'A whitespace dc:title is no title; the filename derives instead. POLICY 2026-08-27b.', {
  title: '   ', lang: 'en-US',
  body: [para(LOREM)],
  expected: { outcome: 'delivered', title: 'filename-derived', titleText: 'a24 whitespace title', language: 'en-US', headings: 0, tables: 0, lists: 0, figures: 0, gaps: [] },
});
add('a25-heading-special-chars', 'Ampersands, angle brackets and quotes in a transcribed title: escaping must survive two conversions.', {
  title: null, lang: 'en-US',
  body: [heading(1, 'Roads & Bridges <2026> "Priorities"'), para(LOREM)],
  expected: { outcome: 'delivered', title: 'transcribed', titleText: 'Roads & Bridges <2026> "Priorities"', language: 'en-US', headings: 1, tables: 0, lists: 0, figures: 0, gaps: [] },
});
add('a26-two-figures-mixed-alt', 'Two figures, one with alt and one without: the gap must count exactly one.', {
  title: 'Inspection Photos', lang: 'en-US', image: true,
  body: [heading(1, 'Inspection Photos'), figure('Culvert inlet before clearing'), figure(null)],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 1, tables: 0, lists: 0, figures: 2, gaps: ['1.1.1'] },
});
add('a27-many-headings-flat', 'Twenty H2s under one H1 — breadth rather than depth.', {
  title: 'Directory', lang: 'en-US',
  body: [heading(1, 'Directory'), ...Array.from({ length: 20 }, (_, i) => heading(2, `Department ${i + 1}`))],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 21, tables: 0, lists: 0, figures: 0, gaps: [] },
});
add('a28-long-paragraph', 'A single 10,000-character paragraph — buffer and reflow behaviour.', {
  title: 'Transcript Extract', lang: 'en-US',
  body: [heading(1, 'Transcript Extract'), para(LOREM.repeat(60))],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 1, tables: 0, lists: 0, figures: 0, gaps: [] },
});

add('a31-empty-headings', 'Two speaking headings and three blank heading-styled lines — the measured real-world shape behind every heading "lost" in conversion. The empties are defects (a heading announcing nothing) and the pipeline deletes them; truth counts what a reader can hear.', {
  title: 'Highway Report', lang: 'en-US',
  body: [heading(1, 'Highway Report'), heading(2, ''), para(LOREM), heading(2, 'Culverts'), heading(3, ''), heading(2, '')],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 2, tables: 0, lists: 0, figures: 0, gaps: [] },
});

add('a32-hyperlink', 'An external hyperlink. `[V]` Two real municipal documents were UA-1-blocked solely because their links carried no alternate description; Finish now transcribes the destination into /Contents, and this stratum is that fix\'s permanent witness.', {
  title: 'Public Notices', lang: 'en-US', link: true,
  body: [heading(1, 'Public Notices'), linkPara('Full agendas are posted at', 'the town website')],
  expected: { outcome: 'delivered', title: 'already-titled', language: 'en-US', headings: 1, tables: 0, lists: 0, figures: 0, gaps: [] },
});

add('a33-junk-filename', 'Untitled, heading-less, and saved as "Document1.docx": the junk-refusal table keeps the honest 2.4.2 gap, because a bad derived title is worse than a reported absence.', {
  title: null, lang: 'en-US', outName: 'Document1',
  body: [para(LOREM)],
  expected: { outcome: 'delivered', title: 'no-heading-to-copy', language: 'en-US', headings: 0, tables: 0, lists: 0, figures: 0, gaps: ['2.4.2'] },
});

// -- adversarial containers (runner-level refusals) ----------------------
add('a29-zip-not-docx', 'A valid ZIP holding a text file: soffice cannot load it, and the refusal must name the first conversion step.', {
  special: 'zip-not-docx',
  expected: { outcome: 'refused', refusalOneOf: ['converter-failed', 'no-output'], step: 'source-to-fodt' },
});
add('a30-truncated-docx', 'a01 cut off mid-archive: a corrupt container refused cleanly, never a crash.', {
  special: 'truncated',
  expected: { outcome: 'refused', refusalOneOf: ['converter-failed', 'no-output'], step: 'source-to-fodt' },
});

// ---- packaging ---------------------------------------------------------

function writeDocx(dir, stratum, outName) {
  const parts = {
    '[Content_Types].xml': contentTypes(Boolean(stratum.image)),
    '_rels/.rels': ROOT_RELS,
    'docProps/core.xml': coreXml(stratum.title),
    'word/document.xml': documentXml(stratum.body.join('')),
    'word/styles.xml': stylesXml(stratum.lang),
    'word/numbering.xml': NUMBERING,
    'word/_rels/document.xml.rels': docRels(Boolean(stratum.image), Boolean(stratum.link)),
  };

  rmSync(dir, { recursive: true, force: true });
  for (const [path, xml] of Object.entries(parts)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), xml, 'utf8');
    // The gate: a malformed part is a generator bug and fails HERE, at
    // generation, where it cannot masquerade as a system failure.
    execFileSync('xmllint', ['--noout', join(dir, path)]);
  }
  if (stratum.image) {
    mkdirSync(join(dir, 'word/media'), { recursive: true });
    writeFileSync(join(dir, 'word/media/image1.png'), PNG_1PX);
  }

  const docx = join(OUT, `${outName}.docx`);
  rmSync(docx, { force: true });
  // -X strips extra attrs for determinism; [Content_Types].xml need not be
  // first for LibreOffice, and `zip` stores directory-order which is ours.
  execFileSync('zip', ['-X', '-q', '-r', join('..', `${outName}.docx`), '.'], { cwd: dir });
  rmSync(dir, { recursive: true, force: true });
  return docx;
}

mkdirSync(KEYS, { recursive: true });

let written = 0;
for (const stratum of STRATA) {
  const key = { document: stratum.id, tests: stratum.tests, expected: stratum.expected };

  if (stratum.special === 'zip-not-docx') {
    const dir = join(OUT, `${stratum.id}.tmp`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'readme.txt'), 'not a word document\n', 'utf8');
    rmSync(join(OUT, `${stratum.id}.docx`), { force: true });
    execFileSync('zip', ['-X', '-q', '-r', join('..', `${stratum.id}.docx`), '.'], { cwd: dir });
    rmSync(dir, { recursive: true, force: true });
  } else if (stratum.special === 'truncated') {
    // Written from a01's bytes at run time by the generator itself, so the
    // two cannot drift: same container, cut mid-archive.
    const { readFileSync: read } = await import('node:fs');
    const whole = read(join(OUT, 'a01-baseline.docx'));
    writeFileSync(join(OUT, `${stratum.id}.docx`), whole.subarray(0, Math.floor(whole.length / 2)));
  } else {
    writeDocx(join(OUT, `${stratum.id}.tmp`), stratum, stratum.outName ?? stratum.id);
  }

  // Planted-structure record rides in the key for the fidelity check — only
  // where a delivery is expected: a refused document has no structure to
  // grade, and undefined counts in a frozen key are a generator bug.
  if (stratum.expected.outcome === 'delivered' && !stratum.special) {
    key.planted = {
      title: stratum.title, language: stratum.lang,
      headings: stratum.expected.headings, tables: stratum.expected.tables,
      lists: stratum.expected.lists, figures: stratum.expected.figures,
    };
  }

  // Keyed by the FILE's name, which for one stratum differs from the id on
  // purpose (a33 ships as Document1.docx): the runner maps evidence to keys
  // by basename, and a key nothing can find guards nothing.
  writeFileSync(join(KEYS, `${stratum.outName ?? stratum.id}.key.json`), JSON.stringify(key, null, 2) + '\n', 'utf8');
  written += 1;
}

console.log(`wrote ${written} documents and keys to ${OUT}/`);
if (written !== 33) {
  console.error(`expected 33 strata, have ${written}`);
  process.exit(1);
}
