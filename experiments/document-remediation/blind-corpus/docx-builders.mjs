/**
 * OOXML construction primitives for the blind corpus.
 *
 * Shaped after `generate-word-corpus.mjs`, which authors its parts by hand so
 * that LibreOffice — the engine under test on the Word path — is never also
 * the producer of the inputs. The prose here is new: the Arm A corpus was the
 * set this pipeline was tuned against, and reusing a byte of it would make
 * this corpus a re-run rather than a blind test.
 *
 * `xmllint` gates every part before packaging, so a generator bug fails at
 * generation, where it cannot be mistaken for a system failure.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * One fixed timestamp for every part, because a ZIP stores modification times.
 *
 * Without this, regenerating the corpus produced different bytes for every
 * Word document even when nothing about them had changed — so every rebuild
 * invalidated eighteen hashes and a real content change was indistinguishable
 * from the clock moving. A hash-locked corpus has to be reproducible or the
 * lock says nothing.
 */
const FIXED_MTIME = new Date('2026-01-01T00:00:00Z');

function stampTree(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) stampTree(full);
    utimesSync(full, FIXED_MTIME, FIXED_MTIME);
  }
  utimesSync(dir, FIXED_MTIME, FIXED_MTIME);
}

export { stampTree, FIXED_MTIME };

/** A 1x1 red PNG, inline so the repo carries no image file. */
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const para = (text, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

export const heading = (level, text) => para(text, `Heading${level}`);

/**
 * A heading declared by DIRECT outline level and nothing else — no `w:pStyle`.
 *
 * The shape this corpus could not express, and therefore could not catch. A real
 * township's minutes declared its entire outline this way: 84 paragraphs with
 * `w:outlineLvl w:val="2"` and zero `HeadingN` styles anywhere in the body.
 * Outline level is what OOXML means by a heading; the style name is only the
 * common route to one.
 *
 * `level` is 1-based to match `heading()`; `w:outlineLvl` is 0-based.
 */
export const outlinePara = (level, text) =>
  `<w:p><w:pPr><w:outlineLvl w:val="${level - 1}"/></w:pPr>`
  + `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

/**
 * An outline-levelled paragraph carrying no text.
 *
 * `removeEmptyHeadings` (`flat-odf.ts`) deletes these on the way through, and
 * that deletion is the difference between a source's heading count and the
 * delivered document's. Planted so the row proves the deletion happens rather
 * than assuming it.
 */
export const emptyOutlinePara = (level) =>
  `<w:p><w:pPr><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:r><w:t/></w:r></w:p>`;

/** Bold and large by direct formatting: visually a heading, structurally not. */
export const fakeHeading = (text) =>
  `<w:p><w:r><w:rPr><w:b/><w:sz w:val="48"/></w:rPr><w:t>${esc(text)}</w:t></w:r></w:p>`;

export const listItem = (numId, text) =>
  `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${esc(text)}</w:t></w:r></w:p>`;

/** A list by typing, not by structure — the shape transcription must not promote. */
export const fakeListItem = (n, text) => para(`${n}. ${text}`);

/** A run in a different language than the document default. */
export const foreignRun = (text, lang) =>
  `<w:p><w:r><w:rPr><w:lang w:val="${lang}"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

/** An unresolved tracked insertion and deletion in one paragraph. */
export const trackedPara = (kept, inserted, deleted) =>
  `<w:p><w:r><w:t xml:space="preserve">${esc(kept)} </w:t></w:r>`
  + `<w:ins w:id="101" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"><w:r><w:t xml:space="preserve">${esc(inserted)} </w:t></w:r></w:ins>`
  + `<w:del w:id="102" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"><w:r><w:delText xml:space="preserve">${esc(deleted)}</w:delText></w:r></w:del></w:p>`;

/**
 * A table cell.
 *
 * A header cell is bold by direct formatting, never by a Heading style. The
 * first blind run caught the difference: styling header cells `Heading3` made
 * them real outline headings, so a document planted with two headings arrived
 * carrying four. The product was counting correctly; the fixture was lying
 * about what it contained. Word marks a header ROW with `w:tblHeader`, which
 * is what this now does.
 */
const cell = (text, header) =>
  `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>`
  + (header
    ? `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`
    : para(text))
  + '</w:tc>';

/** `borders: false` is the layout table — a grid used for placement, not data. */
export const table = (rows, { borders = true, headerRow = false } = {}) =>
  `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${
    borders
      ? '<w:tblBorders><w:top w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders>'
      : '<w:tblBorders><w:top w:val="none"/><w:bottom w:val="none"/><w:left w:val="none"/><w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders>'
  }</w:tblPr>`
  + rows.map((r, i) => {
    const isHeader = headerRow && i === 0;
    return `<w:tr>${isHeader ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}`
      + r.map((c) => cell(c, isHeader)).join('')
      + '</w:tr>';
  }).join('')
  + '</w:tbl>';

/**
 * An inline image; `alt: null` omits the description outright.
 *
 * `style` puts the drawing in a styled paragraph — `Heading2` makes it a
 * heading whose only run is an image, a shape real authors produce (r28
 * carries one, described) and which the corpus could not express before
 * `w20-image-only-heading`. `id` keeps `wp:docPr` unique when a document
 * carries more than one drawing, as OOXML requires.
 */
export const figure = (alt, { relId = 'rIdImg1', style = null, id = 1 } = {}) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="914400"/><wp:docPr id="${id}" name="Figure ${id}"${alt === null ? '' : ` descr="${esc(alt)}"`}/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="Figure 1"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

export const pageBreak = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/**
 * `lang: null` declares no language anywhere, which is the stratum measuring
 * whether absence survives to an absent /Lang. `rtl` and `eastAsia` set the
 * script-specific slots Word uses, because a right-to-left document declares
 * its language in a different attribute than a left-to-right one.
 */
/**
 * @param customHeading - `{ id, basedOn }` for a style that carries NO outline
 *   level of its own and inherits one through `w:basedOn`. A real university
 *   policy used `contactheading` based on `Heading2`; it is a heading by OOXML's
 *   definition and invisible to anything matching on the style NAME.
 */
function stylesXml(lang, { rtl = null, eastAsia = null, customHeading = null } = {}) {
  const parts = [];
  if (lang !== null) parts.push(`w:val="${lang}"`);
  if (rtl !== null) parts.push(`w:bidi="${rtl}"`);
  if (eastAsia !== null) parts.push(`w:eastAsia="${eastAsia}"`);
  const langRun = parts.length > 0 ? `<w:lang ${parts.join(' ')}/>` : '';
  const headings = [1, 2, 3, 4]
    .map(
      (n) =>
        `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${36 - n * 4}"/></w:rPr></w:style>`,
    )
    .join('');
  // No `w:outlineLvl` of its own on purpose: the level has to come through
  // `w:basedOn`, or the fixture does not test inheritance.
  const custom = customHeading
    ? `<w:style w:type="paragraph" w:styleId="${customHeading.id}">`
      + `<w:name w:val="${customHeading.id}"/>`
      + `<w:basedOn w:val="${customHeading.basedOn}"/>`
      + `<w:rPr><w:sz w:val="26"/></w:rPr></w:style>`
    : '';
  return `${XML}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/>${langRun}</w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${headings}${custom}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/></w:style></w:styles>`;
}

const NUMBERING = `${XML}<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

/** No `<dc:title>` element at all when untitled — an empty one is a different claim. */
const coreXml = (title) =>
  `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">${title === null ? '' : `<dc:title>${esc(title)}</dc:title>`}</cp:coreProperties>`;

const contentTypes = ({ image, comments, macro }) =>
  `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + (image ? '<Default Extension="png" ContentType="image/png"/>' : '')
  + (macro ? '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>' : '')
  + `<Override PartName="/word/document.xml" ContentType="application/vnd.${macro ? 'ms-word.document.macroEnabled.main+xml' : 'openxmlformats-officedocument.wordprocessingml.document.main+xml'}"/>`
  + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
  + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
  + (comments ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : '')
  + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
  + '</Types>';

const ROOT_RELS = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const docRels = ({ image, link, comments }) =>
  `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + '<Relationship Id="rIdSty" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  + '<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
  + (image ? '<Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>' : '')
  + (link ? '<Relationship Id="rIdLink1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.org/notices" TargetMode="External"/>' : '')
  + (comments ? '<Relationship Id="rIdCom" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>' : '')
  + '</Relationships>';

const COMMENTS = `${XML}<w:comments ${W}><w:comment w:id="1" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"><w:p><w:r><w:t>Check this figure before publication.</w:t></w:r></w:p></w:comment></w:comments>`;

const documentXml = (body, { rtl = false } = {}) =>
  `${XML}<w:document ${W}><w:body>${body}<w:sectPr>${rtl ? '<w:bidi/>' : ''}<w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`;

/**
 * Write one .docx.
 *
 * Every part is validated before it is packaged; `zip -X` keeps packaging
 * deterministic so the corpus can be hash-locked and rebuilt to the same
 * bytes.
 */
export function writeDocx(workDir, outPath, spec) {
  const {
    title = null,
    lang = 'en-US',
    rtlLang = null,
    eastAsiaLang = null,
    body = [],
    image = false,
    link = false,
    comments = false,
    macro = false,
    rtl = false,
    customHeading = null,
  } = spec;

  const parts = {
    '[Content_Types].xml': contentTypes({ image, comments, macro }),
    '_rels/.rels': ROOT_RELS,
    'docProps/core.xml': coreXml(title),
    'word/document.xml': documentXml(body.join(''), { rtl }),
    'word/styles.xml': stylesXml(lang, { rtl: rtlLang, eastAsia: eastAsiaLang, customHeading }),
    'word/numbering.xml': NUMBERING,
    'word/_rels/document.xml.rels': docRels({ image, link, comments }),
    ...(comments ? { 'word/comments.xml': COMMENTS } : {}),
  };

  rmSync(workDir, { recursive: true, force: true });
  for (const [path, xml] of Object.entries(parts)) {
    const full = join(workDir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, xml, 'utf8');
    execFileSync('xmllint', ['--noout', full]);
  }
  if (image) {
    mkdirSync(join(workDir, 'word/media'), { recursive: true });
    writeFileSync(join(workDir, 'word/media/image1.png'), PNG_1PX);
  }
  if (macro) {
    // Not a real VBA project — the door decides on the container, and a
    // functioning macro would be a liability in a corpus for no added signal.
    writeFileSync(join(workDir, 'word/vbaProject.bin'), Buffer.from('\xd0\xcf\x11\xe0not-a-real-project', 'latin1'));
  }

  rmSync(outPath, { force: true });
  stampTree(workDir);
  execFileSync('zip', ['-X', '-q', '-r', outPath, '.'], { cwd: workDir });
  rmSync(workDir, { recursive: true, force: true });
  return outPath;
}

/**
 * An OLE compound-file container that is not a Word document.
 *
 * The door sniffs the OLE magic and routes to the Word path, which is correct
 * — legacy .doc has no other marker. What matters is that the pipeline then
 * refuses cleanly instead of delivering something. An encrypted .docx arrives
 * in exactly this shape, wrapped in OLE, which is why one file covers both.
 */
export const oleContainer = () =>
  Buffer.concat([
    Buffer.from('d0cf11e0a1b11ae1', 'hex'),
    Buffer.alloc(504, 0),
    Buffer.from('this is an OLE container carrying no Word document', 'latin1'),
  ]);
