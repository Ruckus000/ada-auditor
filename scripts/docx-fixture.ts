import { deflateRawSync } from 'node:zlib';

/**
 * The one Word document `smoke-documents.ts` posts at a deployment.
 *
 * ## Its own module, not part of the script
 *
 * `scripts/smoke-documents.ts` is an entry point and calls `main()`. Importing
 * an entry point from a test runs it — the trap that once migrated the real
 * database on every local `npm test`, recorded in `CLAUDE.md` and already
 * worked around twice (`split-statements.ts`, `blind-test/score.ts`). So the
 * builder lives here, where a test can import it and nothing happens.
 *
 * ## Synthesised, not committed and not shelled out
 *
 * The bytes are assembled here for the same reason `tests/domain/
 * docx-language.test.ts` assembles its own: the fast suite tracks no binaries
 * and spawns no `zip`, so a committed `.docx` would be an untracked blob
 * nothing could check and a `zip` subprocess would put a system package
 * between the smoke test and the thing it is meant to prove. Everything below
 * is `node:zlib` and byte writes.
 *
 * ## The part that is load-bearing: entry ORDER
 *
 * `isWordDocument` (`src/domain/document-remediation.ts`) routes on bytes and
 * nothing else. It reads the first `SCAN_BYTES` (8192) of the upload as
 * latin1 and requires BOTH `[Content_Types].xml` and `word/` to appear in that
 * window. Filename and MIME type are ignored entirely.
 *
 * A document whose markers fall outside the window is not refused — it is
 * offered to `isPdf` next, and a file that fails both is a 415. Worse, the
 * sibling case is silent: a PDF posted at the same route is routed to
 * `repairPdfBytes`, a PDFBox-only lane that never calls `resolveLibreOffice()`,
 * and returns the same `200 application/pdf` with the same summary header. So
 * a green smoke run on the wrong bytes proves nothing about LibreOffice at all.
 *
 * `[Content_Types].xml` is therefore written FIRST and `word/document.xml`
 * SECOND. ZIP stores each entry's name uncompressed in its local file header,
 * so both markers are readable in the raw bytes without inflating anything,
 * and two small deflated parts cannot push the second name past 8192.
 * `tests/scripts/docx-fixture.test.ts` asserts exactly this against the
 * product's own reader rather than against a copy of the rule.
 *
 * ## The prose
 *
 * Written for this file. The OOXML part shapes follow
 * `experiments/document-remediation/blind-corpus/docx-builders.mjs`, which is
 * the repo's worked example of authoring parts by hand so LibreOffice is never
 * also the producer of its own input — but none of that corpus's text is
 * reused, because a smoke fixture sharing bytes with the blind corpus would
 * quietly make one a re-run of the other.
 */

/** The document's `<dc:title>`, and what the response summary must echo back. */
export const FIXTURE_TITLE = 'Quarterly Accessibility Bulletin';

/** Declared in `w:docDefaults`, which is where `docxDeclaredLanguage` looks first. */
export const FIXTURE_LANGUAGE = 'en-US';

/** One H1 and one H2. The default `--min-headings` is this number. */
export const FIXTURE_HEADINGS = 2;

/** Sent as the upload's filename. Ignored by the door; a handle for a human. */
export const FIXTURE_FILENAME = 'smoke-conversion-fixture.docx';

export const DOCX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W_NAMESPACE = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * CRC-32, the one ZIP requires. Bit-at-a-time: the parts here are a few
 * kilobytes, and a table would be more code than the loop it saves.
 */
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/**
 * A ZIP, written byte by byte: local headers, central directory, EOCD.
 *
 * Entries are emitted in the order given, and that order is the whole point —
 * see the note above. Deflate for every part, because `docxDeclaredLanguage`
 * reads its two parts back through `inflateRawSync` and a store-only archive
 * would leave that path unexercised by the very fixture meant to prove it.
 */
function zip(entries: Array<[string, string]>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, text] of entries) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralDirectory, eocd]);
}

const para = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}`
  + `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

const heading = (level: 1 | 2, text: string) => para(text, `Heading${level}`);

const CONTENT_TYPES =
  `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
  + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
  + '</Types>';

/**
 * The body: an outline two levels deep, and a paragraph under each.
 *
 * Two headings rather than one because a converter that flattens an outline
 * still emits a first heading; the H2 is what makes `headings >= 2` a claim
 * about structure surviving rather than about text existing. `w:sectPr` is
 * there because a body without one is a document LibreOffice has to guess the
 * page geometry for, and a fixture should not make the engine improvise.
 */
const DOCUMENT_XML =
  `${XML_DECLARATION}<w:document ${W_NAMESPACE}><w:body>`
  + heading(1, FIXTURE_TITLE)
  + para(
    'This page exists so a deployment can be asked to convert something real, and '
    + 'for nothing else. It names no person, no property and no filing, so a copy '
    + 'of it sitting in a log or an artifact directory discloses nothing.',
  )
  + heading(2, 'What the second level is for')
  + para(
    'The smoke check reads the heading count out of the response summary. A '
    + 'second level is what separates an outline that survived the conversion '
    + 'from a page of flat text that merely arrived.',
  )
  + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
  + '</w:body></w:document>';

const ROOT_RELS =
  `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
  + '</Relationships>';

/**
 * `w:lang` in `w:docDefaults`, and an outline level on each heading style.
 *
 * Both are read by something. The language is the document-wide declaration
 * `docxDeclaredLanguage` looks for first, and it is what the response's
 * `sourceLanguage` is checked against — LibreOffice INVENTS a language at
 * import when a source declares none (`en-US` out of nothing, `en` widened to
 * `en-US`), so a fixture that declared nothing would produce a passing
 * assertion that measured the inflater rather than the pipeline. The outline
 * levels are what make these paragraphs headings in OOXML's own terms; the
 * style NAME is only the usual route to one.
 */
const STYLES_XML =
  `${XML_DECLARATION}<w:styles ${W_NAMESPACE}>`
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/>'
  + `<w:lang w:val="${FIXTURE_LANGUAGE}"/>`
  + '</w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>'
  + '<w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>'
  + '<w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>'
  + '</w:styles>';

/**
 * A real `<dc:title>`, and a descriptive one.
 *
 * The response assertion is `title === 'already-titled'`, which the pipeline
 * only reports for a title a reader could use: `isPlaceholderTitle` refuses
 * producer stamps ("Microsoft Word - …") and the same junk table filenames go
 * through ("doc1", "untitled", "final_v2"). A title from that table would
 * arrive as `transcribed` or `filename-derived` instead and fail the check for
 * a reason that has nothing to do with the deployment.
 */
const CORE_XML =
  `${XML_DECLARATION}<cp:coreProperties `
  + 'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
  + 'xmlns:dc="http://purl.org/dc/elements/1.1/">'
  + `<dc:title>${esc(FIXTURE_TITLE)}</dc:title>`
  + '</cp:coreProperties>';

const DOCUMENT_RELS =
  `${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
  + '<Relationship Id="rIdSty" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  + '</Relationships>';

/**
 * The fixture, as bytes.
 *
 * Deterministic: no clock, no randomness, no filesystem. Two calls produce
 * identical bytes, which is what lets a run be described by a hash if anyone
 * ever needs to.
 */
export function buildFixtureDocx(): Uint8Array {
  return zip([
    // FIRST and SECOND, deliberately. See the module docblock.
    ['[Content_Types].xml', CONTENT_TYPES],
    ['word/document.xml', DOCUMENT_XML],
    ['_rels/.rels', ROOT_RELS],
    ['word/styles.xml', STYLES_XML],
    ['docProps/core.xml', CORE_XML],
    ['word/_rels/document.xml.rels', DOCUMENT_RELS],
  ]);
}
