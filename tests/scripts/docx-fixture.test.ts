import { describe, expect, it } from 'vitest';

import {
  FIXTURE_LANGUAGE,
  FIXTURE_TITLE,
  buildFixtureDocx,
} from '../../scripts/docx-fixture';
import { docxDeclaredLanguage, zipEntry } from '../../src/domain/docx-language';
import { isWordDocument } from '../../src/domain/document-remediation';

/**
 * The smoke fixture, held to the product's own readers.
 *
 * `smoke-documents.ts` proves LibreOffice ran by posting a Word document at a
 * deployment and reading the answer. That proof is only as good as the bytes:
 * `isWordDocument` routes on bytes alone, and a file it does not recognise as
 * a `.docx` is offered to `isPdf` — where a PDF goes to `repairPdfBytes`, a
 * PDFBox-only lane that never calls `resolveLibreOffice()` and returns the
 * same `200 application/pdf` with the same summary header. A silently wrong
 * fixture therefore produces a smoke run that passes and measures nothing.
 *
 * So the checks below are the product's readers, imported, not a restatement
 * of what they are believed to do. The script runs these same two before it
 * opens a socket; this file is what stops a builder change reaching a
 * deployment to be discovered there.
 *
 * It is imported from `scripts/docx-fixture.ts` and NOT from
 * `scripts/smoke-documents.ts`: entry points call `main()` at import, and
 * importing one from a test runs it.
 */

describe('the conversion smoke fixture', () => {
  const bytes = buildFixtureDocx();

  it('is a Word document by the door\'s own reading', () => {
    expect(isWordDocument(bytes)).toEqual({ ok: true, kind: 'docx' });
  });

  it('declares its language where the pipeline reads one', () => {
    expect(docxDeclaredLanguage(bytes)).toEqual({
      readable: true,
      language: FIXTURE_LANGUAGE,
    });
  });

  /**
   * The reason the first assertion passes, said separately.
   *
   * `isWordDocument` reads only the first 8192 bytes. Entry ORDER is what puts
   * both markers inside that window, and nothing else in this file would say
   * so if the order changed and the archive stayed valid — a `.docx` whose
   * `word/` parts are written last is a perfectly good ZIP that this door
   * refuses.
   */
  it('carries both container markers inside the 8192-byte scan window', () => {
    const head = Buffer.from(bytes.subarray(0, 8192)).toString('latin1');
    expect(head).toContain('[Content_Types].xml');
    expect(head).toContain('word/');
  });

  it('names itself, so the response can be checked for `already-titled`', () => {
    const core = zipEntry(bytes, 'docProps/core.xml');
    expect(core?.toString('utf8')).toContain(`<dc:title>${FIXTURE_TITLE}</dc:title>`);
  });
});
