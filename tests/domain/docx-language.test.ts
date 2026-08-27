import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { docxDeclaredLanguage } from '../../src/domain/docx-language';

/**
 * The reader that beats the importer to the source's own words.
 *
 * Zips are built here byte by byte (store and deflate both), because the fast
 * suite tracks no binaries and spawns no `zip` — and because the reader's
 * whole claim is that it needs nothing but the bytes.
 */

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function zip(entries: Array<[string, string]>, method: 0 | 8 = 8): Uint8Array {
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

const styles = (lang: string | null) =>
  `<w:styles><w:docDefaults><w:rPrDefault><w:rPr>${lang === null ? '' : `<w:lang w:val="${lang}"/>`}</w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
const doc = (body = '<w:p/>') => `<w:document><w:body>${body}</w:body></w:document>`;

describe('docxDeclaredLanguage', () => {
  it('reads the document-wide default exactly, un-widened', () => {
    // The four measured inflations, each asserted as NOT happening here.
    for (const lang of ['en', 'es', 'ar', 'zh-CN']) {
      const result = docxDeclaredLanguage(zip([
        ['word/styles.xml', styles(lang)],
        ['word/document.xml', doc()],
      ]));
      expect(result).toEqual({ readable: true, language: lang });
    }
  });

  it('a readable docx that declares nothing declared nothing', () => {
    const result = docxDeclaredLanguage(zip([
      ['word/styles.xml', styles(null)],
      ['word/document.xml', doc()],
    ]));
    expect(result).toEqual({ readable: true, language: null });
  });

  it('falls back to the majority of run-level declarations', () => {
    const body =
      '<w:p><w:r><w:rPr><w:lang w:val="fr"/></w:rPr></w:r></w:p>' +
      '<w:p><w:r><w:rPr><w:lang w:val="fr"/></w:rPr></w:r></w:p>' +
      '<w:p><w:r><w:rPr><w:lang w:val="de"/></w:rPr></w:r></w:p>';
    const result = docxDeclaredLanguage(zip([['word/document.xml', doc(body)]]));
    expect(result).toEqual({ readable: true, language: 'fr' });
  });

  it('answers unreadable for OLE and garbage, so the caller keeps its fallback', () => {
    expect(docxDeclaredLanguage(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toEqual({ readable: false });
    expect(docxDeclaredLanguage(new Uint8Array(0))).toEqual({ readable: false });
    // A real ZIP that is not a docx — no document.xml — is unreadable too.
    expect(docxDeclaredLanguage(zip([['readme.txt', 'hello']]))).toEqual({ readable: false });
  });

  it('reads store-method entries as well as deflated ones', () => {
    const result = docxDeclaredLanguage(zip([
      ['word/styles.xml', styles('es')],
      ['word/document.xml', doc()],
    ], 0));
    expect(result).toEqual({ readable: true, language: 'es' });
  });
});
