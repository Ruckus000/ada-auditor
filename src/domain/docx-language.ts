import { inflateRawSync } from 'node:zlib';

/**
 * What language a .docx declares, read from its own bytes.
 *
 * ## Why this exists
 *
 * `[V]` Measured by the remediation test's Arm A: LibreOffice inflates a
 * document's language at IMPORT, before the pipeline ever looks. A source
 * declaring nothing arrived in the flat ODF as `en-US`; bare `en` widened to
 * `en-US`, `es` to `es-ES`, `ar` to `ar-SA` — four strata, one bug class.
 * The pipeline already corrects the exporter's invention (`Finish` reapplies
 * the source language, including reapplying nothing), but "the source" was
 * read from the fodt, which is downstream of the import that inflates. The
 * only reading the inflater cannot touch is the .docx's own XML.
 *
 * ## What "the document's language" means here
 *
 * The run-property default in `styles.xml` (`w:docDefaults … w:lang w:val`)
 * when one exists — that is the document-wide declaration Word writes — else
 * the majority `w:lang w:val` across the body's runs, else null. Null is a
 * statement, not a gap in the reading: a document that declares no language
 * has declared none, and inventing one downstream is precisely the defect
 * this module exists to prevent.
 *
 * ## The container reading
 *
 * A .docx is a ZIP; the two parts needed are extracted with the central
 * directory as the authority (its sizes are always present, unlike local
 * headers under streaming flags) and `inflateRawSync` for deflated entries.
 * Legacy `.doc` is OLE, not ZIP, and answers `readable: false` — the caller
 * keeps its downstream fallback for that case, with the inflation caveat
 * documented at the call site.
 */

export type DocxLanguage =
  | { readable: true; language: string | null }
  | { readable: false };

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** One named entry's bytes out of a ZIP, or null. Central-directory driven. */
/**
 * One named entry out of a ZIP, from the central directory. Dependency-free.
 *
 * Exported because `prepare-verapdf.ts` needs exactly this to lift the
 * installer jar out of a release zip, and a second copy of a central-directory
 * walk is how the two would drift — the same reasoning that moved StructText
 * into the shared Java rather than letting the spike keep its own.
 */
export function zipEntry(bytes: Uint8Array, name: string): Buffer | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // EOCD sits in the last 22..(22+65535) bytes; scan back for its signature.
  const scanFrom = Math.max(0, buf.length - 22 - 65535);
  let eocd = -1;
  for (let i = buf.length - 22; i >= scanFrom; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return null;

  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = buf.readUInt16LE(eocd + 10);

  let p = cdOffset;
  for (let i = 0; i < entries; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CD_SIG) return null;
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const entryName = buf.toString('utf8', p + 46, p + 46 + nameLength);

    if (entryName === name) {
      if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_SIG) return null;
      // Local header's own name/extra lengths can differ from the CD's; read
      // them from the local header the data actually follows.
      const localName = buf.readUInt16LE(localOffset + 26);
      const localExtra = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localName + localExtra;
      const data = buf.subarray(dataStart, dataStart + compressedSize);
      try {
        if (method === 0) return Buffer.from(data);
        if (method === 8) return inflateRawSync(data);
      } catch {
        return null;
      }
      return null;
    }

    p += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

const LANG_VAL = /<w:lang\b[^>]*\bw:val="([^"]+)"/g;

export function docxDeclaredLanguage(bytes: Uint8Array): DocxLanguage {
  const styles = zipEntry(bytes, 'word/styles.xml');
  const document = zipEntry(bytes, 'word/document.xml');
  if (document === null) {
    // Not a readable docx at all — legacy .doc, or something else wearing the
    // extension. The caller decides what absence of a reading means.
    return { readable: false };
  }

  if (styles !== null) {
    const defaults = /<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(styles.toString('utf8'))?.[0];
    if (defaults) {
      const declared = /<w:lang\b[^>]*\bw:val="([^"]+)"/.exec(defaults)?.[1];
      if (declared) return { readable: true, language: declared };
    }
  }

  // No document-wide default: the majority of the body's own run declarations.
  const votes = new Map<string, number>();
  for (const [, value] of document.toString('utf8').matchAll(LANG_VAL)) {
    if (value) votes.set(value, (votes.get(value) ?? 0) + 1);
  }
  let winner: string | null = null;
  let best = 0;
  for (const [value, count] of votes) {
    if (count > best) {
      winner = value;
      best = count;
    }
  }
  return { readable: true, language: winner };
}
