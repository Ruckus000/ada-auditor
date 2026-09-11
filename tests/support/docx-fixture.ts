import { deflateRawSync } from 'node:zlib';

/**
 * A `.docx` built byte by byte, for tests that read one.
 *
 * Lifted here from `tests/domain/docx-language.test.ts` when a second reader
 * needed the same fixtures — the second real repeat with the same meaning,
 * which is the threshold. It is also the reason `zipEntry` itself is exported
 * rather than copied: two central-directory walks drift, and so would two
 * builders.
 *
 * Zips are constructed rather than shelled out to, because the fast suite
 * tracks no binaries and spawns no `zip` — and because the readers' whole claim
 * is that they need nothing but the bytes.
 */

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** Both storage methods, because real `.docx` files use deflate and the spec allows store. */
export function zip(entries: Array<[string, string]>, method: 0 | 8 = 8): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const raw = Buffer.from(text, 'utf8');
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** A `word/document.xml` around whatever body you hand it. */
export const wordDocument = (body = '<w:p/>') => `<w:document><w:body>${body}</w:body></w:document>`;

/** A `word/styles.xml` declaring a document-wide run language, or none. */
export const wordStyles = (lang: string | null, extra = '') =>
  `<w:styles><w:docDefaults><w:rPrDefault><w:rPr>${
    lang === null ? '' : `<w:lang w:val="${lang}"/>`
  }</w:rPr></w:rPrDefault></w:docDefaults>${extra}</w:styles>`;

/** A `docProps/core.xml` carrying a `dc:title`, or an empty one. */
export const wordCore = (title: string | null) =>
  `<cp:coreProperties>${title === null ? '' : `<dc:title>${title}</dc:title>`}</cp:coreProperties>`;

/** A paragraph carrying text, optionally styled and optionally outline-levelled. */
export const para = (text: string, opts: { style?: string; outline?: number } = {}) =>
  `<w:p><w:pPr>${opts.style === undefined ? '' : `<w:pStyle w:val="${opts.style}"/>`}${
    opts.outline === undefined ? '' : `<w:outlineLvl w:val="${opts.outline}"/>`
  }</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** A style definition that carries an outline level — the third heading dialect. */
export const styleDef = (id: string, outline: number) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/><w:pPr><w:outlineLvl w:val="${outline}"/></w:pPr></w:style>`;
