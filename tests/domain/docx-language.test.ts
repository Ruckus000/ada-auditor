import { describe, expect, it } from 'vitest';
import { docxDeclaredLanguage } from '../../src/domain/docx-language';
import { zip } from '../support/docx-fixture';

/**
 * The reader that beats the importer to the source's own words.
 *
 * Zips are built byte by byte (store and deflate both) by `tests/support/
 * docx-fixture.ts`, because the fast suite tracks no binaries and spawns no
 * `zip` — and because the reader's whole claim is that it needs nothing but
 * the bytes. The builder moved there when `source-truth.test.ts` needed the
 * same fixtures; two copies of a central-directory writer would drift exactly
 * as two copies of the reader would.
 */

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
