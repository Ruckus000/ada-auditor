/**
 * PDF construction primitives for the blind corpus.
 *
 * Every planted PDF is written here, byte by byte, for the reason the Arm A
 * generator authors its OOXML by hand: the system under test must not be the
 * producer of its own inputs. Chromium is deliberately NOT used — its output
 * carries a creation date and varies run to run, and a corpus whose hashes
 * move cannot be hash-locked. Realism is the fresh real documents' job; this
 * file's job is precision.
 *
 * Object numbering uses slots so a catalog can reference pages that do not
 * exist yet, which every real PDF writer needs and the ad-hoc arrays in the
 * unit-test fixtures avoid only because they are three objects long.
 *
 * Offsets are COMPUTED, never written by hand: a hand-typed xref sends PDFBox
 * down its repair path, and then the fixture tests the repair path instead of
 * the thing it was written for.
 */

/** A document under construction. */
export function pdf({ header = '%PDF-1.7' } = {}) {
  /** @type {(string|Buffer|null)[]} 0-indexed; object number is index + 1. */
  const objs = [];

  /** Reserve an object number to be filled in later (forward references). */
  const slot = () => {
    objs.push(null);
    return objs.length;
  };
  const set = (n, body) => {
    objs[n - 1] = body;
    return n;
  };
  /** Allocate and fill in one step. */
  const add = (body) => set(slot(), body);
  const ref = (n) => `${n} 0 R`;

  /** A stream object; `raw` bytes are written verbatim between the markers. */
  const stream = (dict, data) => {
    const body = typeof data === 'string' ? data : data.toString('latin1');
    return `<< ${dict} /Length ${body.length} >>\nstream\n${body}\nendstream`;
  };

  /**
   * Serialize.
   *
   * `xrefStyle: 'stream'` writes an uncompressed cross-reference stream — the
   * PDF 1.5 shape, which a reader must handle differently from a table. It is
   * left unfiltered on purpose: the point is the xref *shape*, and a Flate
   * filter would only add a second thing that could be wrong.
   *
   * `offsetShift` corrupts every recorded offset by a fixed amount, which is
   * how a real file arrives after something rewrote it badly. A reader that
   * cannot recover produces a refusal; one that can, must not silently deliver
   * something different.
   */
  const serialize = ({ trailerExtra = '', xrefStyle = 'table', offsetShift = 0 } = {}) => {
    const missing = objs.findIndex((o) => o === null);
    if (missing >= 0) throw new Error(`object ${missing + 1} was reserved and never filled`);

    let out = `${header}\n%\xe2\xe3\xcf\xd3\n`;
    const offsets = [];
    objs.forEach((body, index) => {
      offsets.push(out.length + offsetShift);
      out += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });

    const size = objs.length + 1;
    const xref = out.length;

    if (xrefStyle === 'table') {
      out += `xref\n0 ${size}\n0000000000 65535 f \n`;
      for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
      out += `trailer\n<< /Size ${size} ${trailerExtra} >>\nstartxref\n${xref}\n%%EOF\n`;
      return Buffer.from(out, 'latin1');
    }

    // A cross-reference stream is itself an object, so it takes the next
    // number and indexes itself — the self-reference every 1.5 writer makes.
    const xrefNum = size;
    const entries = [[1, 0, 65535], ...offsets.map((o) => [1, o, 0]), [1, xref, 0]];
    let data = '';
    for (const [type, offset, gen] of entries) {
      data += String.fromCharCode(type);
      data += String.fromCharCode((offset >> 24) & 0xff, (offset >> 16) & 0xff, (offset >> 8) & 0xff, offset & 0xff);
      data += String.fromCharCode((gen >> 8) & 0xff, gen & 0xff);
    }
    out += `${xrefNum} 0 obj\n<< /Type /XRef /Size ${size + 1} /W [1 4 2] ${trailerExtra} /Length ${data.length} >>\nstream\n${data}\nendstream\nendobj\n`;
    out += `startxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
  };

  return { slot, set, add, ref, stream, serialize, count: () => objs.length };
}

/**
 * The resource dictionary the simple builders share.
 *
 * A page with no /Resources sends every reader down a repair path, and then a
 * fixture written to test one thing tests the repair path instead — the same
 * trap a hand-typed xref sets.
 */
export const HELVETICA_RESOURCES = '<< /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >>';

/** Escape for a PDF literal string. */
export const lit = (text) => `(${String(text).replace(/([\\()])/g, '\\$1')})`;

/**
 * A UTF-16BE text string with the byte-order mark PDF requires.
 *
 * The two title encodings both occur in the wild and one of them is where
 * mojibake comes from, so both are planted.
 */
export const utf16 = (text) => {
  let out = '\xfe\xff';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    out += String.fromCharCode((code >> 8) & 0xff, code & 0xff);
  }
  return `(${out.replace(/([\\()])/g, '\\$1')})`;
};

/**
 * Content-stream text, optionally wrapped in a marked-content sequence.
 *
 * The tag matches the structure element that owns the content — `/H1` under an
 * H1, not `/P` under everything. A conforming tagged PDF does this, and the
 * first blind run showed why it matters: with every sequence tagged `/P`, the
 * product counted a heading it could not read the text of, so the title chain
 * skipped the heading rung and fell through to the filename. The fixture was
 * wrong, not the product.
 */
export const text = (body, mcid = null, tag = 'P') => {
  const draw = `BT /F1 12 Tf 40 700 Td ${lit(body)} Tj ET`;
  return mcid === null ? draw : `/${tag} << /MCID ${mcid} >> BDC\n${draw}\nEMC`;
};

/**
 * Assemble an ordinary one-page document with a structure tree.
 *
 * `elements` are `{ type, alt?, text?, kids? }`; each becomes one StructElem
 * under the tree root, in order. `tagged: false` omits the tree outright,
 * which is the shape the product refuses rather than guesses at.
 */
export function structuredPdf({
  elements = [],
  lang = 'en-US',
  title = null,
  titleEncoding = 'literal',
  marked = true,
  tagged = true,
  // Base-14 Helvetica by default, because the text has to be READABLE.
  //
  // The first corpus used a synthetic Identity-H font with a placeholder font
  // program, and no reader could decode a character of it: `[V]` textChars 0,
  // every heading's text empty, and the title chain fell through the heading
  // rung to the filename. That looked exactly like a product defect and was
  // not one — with Helvetica the same document transcribes "Drainage
  // Assessment" correctly.
  //
  // The trade is that base-14 is not embedded, so these documents fail UA-1
  // 7.21.4.1. That is honest — a large share of real PDFs are exactly this —
  // and the punch list is expected to say so. `cidset` and `not-embedded`
  // remain available for the rows that are about fonts.
  font = 'not-embedded',
  extraCatalog = '',
  annots = [],
  pages = 1,
  header = '%PDF-1.7',
  xrefStyle = 'table',
  offsetShift = 0,
} = {}) {
  const d = pdf({ header });
  const catalog = d.slot();
  const pagesNode = d.slot();
  const treeRoot = tagged ? d.slot() : null;

  const fontNum = fontObjects(d, font);

  // One content stream per page, with marked content matching the structure
  // elements on that page. Content that is neither tagged nor marked as an
  // artifact is what UA-1 7.1-3 fails, so a document meant to be well-formed
  // has to carry the BDC/EMC pairs, not merely the tree.
  const pageNums = [];
  const contentPerPage = [];
  for (let p = 0; p < pages; p += 1) {
    pageNums.push(d.slot());
    contentPerPage.push([]);
  }

  const elementObjs = [];
  elements.forEach((element, index) => {
    const page = Math.min(element.page ?? 0, pages - 1);
    const mcid = contentPerPage[page].length;
    contentPerPage[page].push(text(element.text ?? `${element.type} content ${index + 1}`, mcid, element.type));
    const num = d.slot();
    elementObjs.push({ num, element, page, mcid });
  });

  for (let p = 0; p < pages; p += 1) {
    const body = contentPerPage[p].length > 0 ? contentPerPage[p].join('\n') : text(`page ${p + 1}`, null);
    const contents = d.add(d.stream('', body));
    const pageAnnots = p === 0 && annots.length > 0 ? ` /Annots [${annots.map((a) => d.ref(a(d))).join(' ')}]` : '';
    d.set(
      pageNums[p],
      `<< /Type /Page /Parent ${d.ref(pagesNode)} /MediaBox [0 0 612 792] /Contents ${d.ref(contents)}`
        + ` /Resources << /Font << /F1 ${d.ref(fontNum)} >> >>`
        + `${tagged ? ` /StructParents ${p}` : ''}${pageAnnots} >>`,
    );
  }

  for (const { num, element, page, mcid } of elementObjs) {
    // A non-ASCII description has to travel as UTF-16BE, which is what real
    // producers write and what PDFBox decodes back. `lit()` would emit the
    // bytes raw and a reader would get mojibake, so a CJK row planted to prove
    // the predicate leaves it alone would prove nothing about a CJK string.
    const encode = /^[\x20-\x7e]*$/.test(String(element.alt)) ? lit : utf16;
    const alt = element.alt === undefined ? '' : ` /Alt ${encode(element.alt)}`;
    d.set(
      num,
      `<< /Type /StructElem /S /${element.type} /P ${d.ref(treeRoot)} /Pg ${d.ref(pageNums[page])}`
        + ` /K ${mcid}${alt} >>`,
    );
  }

  if (tagged) {
    // The parent tree is what maps marked content back to structure. Without
    // it a tagged PDF fails UA-1 even with a perfect tree, so it is built
    // rather than skipped — a fixture that is wrong for an uninteresting
    // reason wastes a corpus row.
    const numsPerPage = [];
    for (let p = 0; p < pages; p += 1) {
      const onPage = elementObjs.filter((e) => e.page === p).sort((a, b) => a.mcid - b.mcid);
      numsPerPage.push(`${p} [${onPage.map((e) => d.ref(e.num)).join(' ')}]`);
    }
    const parentTree = d.add(`<< /Nums [${numsPerPage.join(' ')}] >>`);
    d.set(
      treeRoot,
      `<< /Type /StructTreeRoot /K [${elementObjs.map((e) => d.ref(e.num)).join(' ')}]`
        + ` /ParentTree ${d.ref(parentTree)} /ParentTreeNextKey ${pages} >>`,
    );
  }

  d.set(pagesNode, `<< /Type /Pages /Kids [${pageNums.map((n) => d.ref(n)).join(' ')}] /Count ${pages} >>`);

  const titleEntry =
    title === null ? '' : ` /Title ${titleEncoding === 'utf16' ? utf16(title) : lit(title)}`;
  const info = title === null ? null : d.add(`<< ${titleEntry.trim()} >>`);

  d.set(
    catalog,
    `<< /Type /Catalog /Pages ${d.ref(pagesNode)}`
      + `${tagged ? ` /StructTreeRoot ${d.ref(treeRoot)}` : ''}`
      + `${marked ? ' /MarkInfo << /Marked true >>' : ''}`
      + `${lang === null ? '' : ` /Lang ${lit(lang)}`}`
      + `${extraCatalog} >>`,
  );

  return d.serialize({
    trailerExtra: `/Root ${d.ref(catalog)}${info === null ? '' : ` /Info ${d.ref(info)}`}`,
    xrefStyle,
    offsetShift,
  });
}

/**
 * Font objects, by kind.
 *
 * `not-embedded` is one of the two shapes that matter most in the wild: four
 * of twenty real municipal PDFs fail 7.21.4 because whatever produced them
 * never embedded a font, and no repair can invent glyph outlines. `cidset`
 * is the other: an embedded font indexed by a producer-written table that
 * lies, which removal fixes.
 */
function fontObjects(d, kind) {
  if (kind === 'not-embedded') {
    return d.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  }

  const descriptor = d.slot();
  const descendant = d.add(
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ABCDEF+Blind'
      + ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>'
      + ` /FontDescriptor ${d.ref(descriptor)} /CIDToGIDMap /Identity /DW 1000 >>`,
  );
  const fontFile = d.add(d.stream('/Length1 12', 'not a real font'));
  const cidSet = kind === 'cidset' ? d.add(d.stream('', '\xc0\x00')) : null;
  d.set(
    descriptor,
    '<< /Type /FontDescriptor /FontName /ABCDEF+Blind /Flags 4 /FontBBox [0 0 1000 1000]'
      + ' /ItalicAngle 0 /Ascent 1000 /Descent 0 /CapHeight 1000 /StemV 80'
      + ` /FontFile2 ${d.ref(fontFile)}${cidSet === null ? '' : ` /CIDSet ${d.ref(cidSet)}`} >>`,
  );
  const toUnicode = d.add(
    d.stream(
      '',
      '/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n'
        + '1 begincodespacerange <0000> <FFFF> endcodespacerange\n'
        + '1 beginbfrange <0000> <00ff> <0020> endbfrange\n'
        + 'endcmap CMapName currentdict /CMap defineresource pop end end',
    ),
  );
  return d.add(
    '<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+Blind /Encoding /Identity-H'
      + ` /DescendantFonts [${d.ref(descendant)}] /ToUnicode ${d.ref(toUnicode)} >>`,
  );
}

/** A widget annotation, indexed into the structure tree or deliberately not. */
export const widget = ({ nested = true, subtype = 'Widget' } = {}) => (d) =>
  d.add(
    `<< /Type /Annot /Subtype /${subtype} /Rect [10 10 60 30] /F 4`
      + `${subtype === 'Widget' ? ' /FT /Tx /T (Field1)' : ' /A << /S /URI /URI (https://example.org) >>'}`
      + `${nested ? ' /StructParent 0' : ''} >>`,
  );

/**
 * A signed document.
 *
 * Hand-built rather than genuinely signed, for the reason the unit fixture
 * gives: producing a real signature needs a certificate and changes nothing
 * about whether the product SEES one. `garbage: true` writes a signature
 * whose contents could never verify — the product must still refuse, because
 * refusing depends on presence, not validity, and a repair would destroy the
 * evidence either way.
 */
export function signedPdf({ garbage = false, tagged = true } = {}) {
  const d = pdf();
  const catalog = d.slot();
  const pagesNode = d.slot();
  const page = d.slot();
  const treeRoot = tagged ? d.slot() : null;
  const sigField = d.slot();
  const sigValue = d.slot();

  const helvetica = d.add(HELVETICA_RESOURCES);
  const contents = d.add(d.stream('', text('signed notice', tagged ? 0 : null)));
  const element = tagged ? d.add(`<< /Type /StructElem /S /P /P ${d.ref(treeRoot)} /Pg ${d.ref(page)} /K 0 >>`) : null;
  if (tagged) {
    const parentTree = d.add(`<< /Nums [0 [${d.ref(element)}]] >>`);
    d.set(
      treeRoot,
      `<< /Type /StructTreeRoot /K [${d.ref(element)}] /ParentTree ${d.ref(parentTree)} /ParentTreeNextKey 1 >>`,
    );
  }

  d.set(
    page,
    `<< /Type /Page /Parent ${d.ref(pagesNode)} /MediaBox [0 0 612 792] /Contents ${d.ref(contents)}`
      + ` /Resources ${d.ref(helvetica)}`
      + `${tagged ? ' /StructParents 0' : ''} /Annots [${d.ref(sigField)}] >>`,
  );
  d.set(pagesNode, `<< /Type /Pages /Kids [${d.ref(page)}] /Count 1 >>`);
  d.set(
    sigField,
    `<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /Rect [0 0 0 0]`
      + ` /V ${d.ref(sigValue)} /P ${d.ref(page)} >>`,
  );
  d.set(
    sigValue,
    '<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached'
      + ` /ByteRange [0 100 200 300] /Contents <${garbage ? 'deadbeef' : '00112233'}>`
      + ' /M (D:20260101000000Z) >>',
  );
  d.set(
    catalog,
    `<< /Type /Catalog /Pages ${d.ref(pagesNode)}`
      + `${tagged ? ` /StructTreeRoot ${d.ref(treeRoot)}` : ''}`
      + ' /MarkInfo << /Marked true >> /Lang (en-US)'
      + ` /AcroForm << /Fields [${d.ref(sigField)}] /SigFlags 3 >> >>`,
  );

  return d.serialize({ trailerExtra: `/Root ${d.ref(catalog)}` });
}

/**
 * A structure tree whose only element is its own child.
 *
 * A graph, not a tree. The bounded read has to terminate; a fixture like this
 * one already caught an unbounded walk once, and the corpus keeps a copy so
 * the bound is exercised through the product's front door too.
 */
export function cyclicTreePdf() {
  const d = pdf();
  const catalog = d.slot();
  const pagesNode = d.slot();
  const page = d.slot();
  const treeRoot = d.slot();
  const element = d.slot();

  const helvetica = d.add(HELVETICA_RESOURCES);
  const contents = d.add(d.stream('', text('cycle', 0)));
  d.set(element, `<< /Type /StructElem /S /P /P ${d.ref(treeRoot)} /Pg ${d.ref(page)} /K [${d.ref(element)}] >>`);
  d.set(treeRoot, `<< /Type /StructTreeRoot /K [${d.ref(element)}] >>`);
  d.set(
    page,
    `<< /Type /Page /Parent ${d.ref(pagesNode)} /MediaBox [0 0 612 792] /Contents ${d.ref(contents)}`
      + ` /Resources ${d.ref(helvetica)} /StructParents 0 >>`,
  );
  d.set(pagesNode, `<< /Type /Pages /Kids [${d.ref(page)}] /Count 1 >>`);
  d.set(
    catalog,
    `<< /Type /Catalog /Pages ${d.ref(pagesNode)} /StructTreeRoot ${d.ref(treeRoot)}`
      + ' /MarkInfo << /Marked true >> /Lang (en-US) >>',
  );
  return d.serialize({ trailerExtra: `/Root ${d.ref(catalog)}` });
}

/** An empty page tree: a structurally valid file with nothing in it. */
export function noPagesPdf() {
  const d = pdf();
  const catalog = d.slot();
  const pagesNode = d.add('<< /Type /Pages /Kids [] /Count 0 >>');
  d.set(catalog, `<< /Type /Catalog /Pages ${d.ref(pagesNode)} >>`);
  return d.serialize({ trailerExtra: `/Root ${d.ref(catalog)}` });
}

/**
 * An incremental update that changes the title.
 *
 * Transcription must read the LATEST trailer. A reader that takes the first
 * one it finds transcribes a title the document no longer claims, which is an
 * invented claim arrived at by carelessness rather than by inference.
 */
export function incrementalTitlePdf({ original, updated }) {
  const base = structuredPdf({ title: original, elements: [{ type: 'H1', text: 'Heading' }] });
  const baseText = base.toString('latin1');
  const prev = Number(baseText.slice(baseText.lastIndexOf('startxref') + 9).trim().split('\n')[0]);
  const rootMatch = /\/Root (\d+) 0 R/.exec(baseText);
  const sizeMatch = /\/Size (\d+)/.exec(baseText);
  const root = Number(rootMatch[1]);
  const size = Number(sizeMatch[1]);

  const infoNum = size;
  let out = baseText;
  const infoOffset = out.length;
  out += `${infoNum} 0 obj\n<< /Title ${lit(updated)} >>\nendobj\n`;
  const xref = out.length;
  out += `xref\n0 1\n0000000000 65535 f \n${infoNum} 1\n${String(infoOffset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${infoNum + 1} /Root ${root} 0 R /Info ${infoNum} 0 R /Prev ${prev} >>\n`;
  out += `startxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
