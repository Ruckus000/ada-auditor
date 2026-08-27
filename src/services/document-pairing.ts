import type { ClientDocumentRecord } from '../domain/platform';

/**
 * Pairs a PDF with the Word document it was published from, by name.
 *
 * The product answer to the measured PDF-repair STOP: municipal sites
 * publish the PDF and its Word source side by side — the CDN municipality in
 * the corpus serves both per document — and converting the SOURCE produces a
 * tagged PDF whose claims are true, which repair demonstrably cannot
 * (2/28 semantically true, 62 false assertions where truth was checkable).
 * So a paired PDF's remediation action is "convert the source"; only an
 * unpaired PDF falls to the punch list.
 *
 * Pairing is DERIVED, not stored: a pure function over the inventory at read
 * time. A stored pairing column would need write-time maintenance on every
 * crawl merge and could go stale; this cannot, and adding persistence later
 * is one migration away if a reason appears.
 *
 * The stem is the URL's decoded last path segment, lowercased, extension
 * off, query string off (the CDN appends `?ver=` cache keys). Ambiguity is
 * refused, not guessed: two Word documents sharing a stem pair with nothing
 * — offering a client the WRONG source would be worse than offering none.
 * When one stem has both a `.docx` and a legacy `.doc`, the `.docx` wins:
 * it is the richer format and the likelier current original.
 */

export function documentStem(url: string): string | null {
  try {
    const last = new URL(url).pathname.split('/').pop() ?? '';
    const decoded = decodeURIComponent(last).toLowerCase();
    const stem = decoded.replace(/\.(pdf|docx?|doc)$/i, '');
    return stem.length > 0 && stem !== decoded ? stem : null;
  } catch {
    // An unparsable URL (an upload's bare filename) still has a stem.
    const decoded = url.toLowerCase();
    const stem = decoded.replace(/\.(pdf|docx?|doc)$/i, '');
    return stem.length > 0 && stem !== decoded ? stem : null;
  }
}

/** pdf document id → the Word sibling it can be converted from. */
export function pairDocuments(
  records: readonly ClientDocumentRecord[],
): Map<string, { id: string; kind: 'docx' | 'doc'; url: string }> {
  const wordByStem = new Map<string, ClientDocumentRecord[]>();
  for (const record of records) {
    if (record.kind !== 'docx' && record.kind !== 'doc') continue;
    const stem = documentStem(record.url);
    if (stem === null) continue;
    const bucket = wordByStem.get(stem);
    if (bucket) bucket.push(record);
    else wordByStem.set(stem, [record]);
  }

  const pairs = new Map<string, { id: string; kind: 'docx' | 'doc'; url: string }>();
  for (const record of records) {
    if (record.kind !== 'pdf') continue;
    const stem = documentStem(record.url);
    if (stem === null) continue;
    const candidates = wordByStem.get(stem) ?? [];
    const docx = candidates.filter((c) => c.kind === 'docx');
    const doc = candidates.filter((c) => c.kind === 'doc');
    // docx wins over doc; ambiguity within a kind pairs with nothing.
    const chosen = docx.length === 1 ? docx[0] : docx.length === 0 && doc.length === 1 ? doc[0] : null;
    if (chosen) {
      pairs.set(record.id, { id: chosen.id, kind: chosen.kind as 'docx' | 'doc', url: chosen.url });
    }
  }
  return pairs;
}
