import { describe, expect, it } from 'vitest';
import {
  compareDocumentInspections,
  documentGapKey,
} from '../../src/services/document-regression';
import type { StoredDocumentInspection } from '../../src/domain/platform';
import type { RemediationSummary } from '../../src/domain/document-remediation';

/** The document pipeline's own regression, diffed by criterion. */

function summary(gaps: string[]): RemediationSummary {
  return {
    title: 'no-heading-to-copy',
    sourceLanguage: null,
    tagged: false,
    pages: 4,
    headings: 0,
    tables: 0,
    lists: 0,
    figures: 3,
    gaps,
  };
}

function inspection(
  id: string,
  documentId: string,
  inspectedAt: string,
  gaps: string[],
): StoredDocumentInspection {
  return {
    id,
    clientId: 'acme',
    documentId,
    url: `https://town.example/${documentId}.pdf`,
    source: 'crawl',
    summary: summary(gaps),
    inspectedAt,
  };
}

describe('documentGapKey', () => {
  it('is the criterion prefix, nothing else', () => {
    expect(documentGapKey('1.1.1: 3 figures with no alt text')).toBe('1.1.1');
    expect(documentGapKey('2.4.2: the document has no title')).toBe('2.4.2');
  });

  it('answers the whole string for a gap with no prefix, rather than throwing', () => {
    expect(documentGapKey('no colon here')).toBe('no colon here');
  });
});

describe('compareDocumentInspections', () => {
  it('reports a first reading as such, with nothing new and nothing resolved', () => {
    const [diff] = compareDocumentInspections([
      inspection('i1', 'doc-a', '2026-08-26T10:00:00.000Z', ['2.4.2: no title']),
    ]);

    expect(diff).toMatchObject({
      documentId: 'doc-a',
      status: 'first-reading',
      newGaps: [],
      resolvedGaps: [],
      unchangedCount: 1,
    });
    expect(diff.baselineAt).toBeUndefined();
  });

  it('a count change within one criterion reads as UNCHANGED — the failure persists, smaller', () => {
    // The exact case whole-string diffing gets wrong: "3 figures" → "1
    // figure" is the same 1.1.1 failure shrinking, not one gap resolved and a
    // new one introduced.
    const [diff] = compareDocumentInspections([
      inspection('i2', 'doc-a', '2026-08-26T11:00:00.000Z', [
        '1.1.1: 1 figure with no alt text',
      ]),
      inspection('i1', 'doc-a', '2026-08-26T10:00:00.000Z', [
        '1.1.1: 3 figures with no alt text',
      ]),
    ]);

    expect(diff.status).toBe('unchanged');
    expect(diff.newGaps).toEqual([]);
    expect(diff.resolvedGaps).toEqual([]);
    expect(diff.unchangedCount).toBe(1);
  });

  it('improved, regressed, and mixed all read from the criterion sets', () => {
    const diffs = compareDocumentInspections([
      // doc-improved: 2.4.2 resolved.
      inspection('a2', 'doc-improved', '2026-08-26T11:00:00.000Z', []),
      inspection('a1', 'doc-improved', '2026-08-26T10:00:00.000Z', ['2.4.2: no title']),
      // doc-regressed: 1.1.1 appeared.
      inspection('b2', 'doc-regressed', '2026-08-26T11:00:00.000Z', [
        '1.1.1: 2 figures with no alt text',
      ]),
      inspection('b1', 'doc-regressed', '2026-08-26T10:00:00.000Z', []),
      // doc-mixed: 2.4.2 resolved, 1.1.1 appeared.
      inspection('c2', 'doc-mixed', '2026-08-26T11:00:00.000Z', [
        '1.1.1: 1 figure with no alt text',
      ]),
      inspection('c1', 'doc-mixed', '2026-08-26T10:00:00.000Z', ['2.4.2: no title']),
    ]);

    const byDoc = new Map(diffs.map((diff) => [diff.documentId, diff]));
    expect(byDoc.get('doc-improved')).toMatchObject({
      status: 'improved',
      resolvedGaps: ['2.4.2: no title'],
      newGaps: [],
    });
    expect(byDoc.get('doc-regressed')).toMatchObject({
      status: 'regressed',
      newGaps: ['1.1.1: 2 figures with no alt text'],
      resolvedGaps: [],
    });
    expect(byDoc.get('doc-mixed')).toMatchObject({ status: 'mixed' });
    expect(byDoc.get('doc-mixed')?.baselineAt).toBe('2026-08-26T10:00:00.000Z');
  });

  it('refuses to diff across instrument versions — incomparable, not a fabricated change', () => {
    // The same answer walkedTheSamePath gives page regression for a changed
    // ruleset: a vocabulary change diffed silently would report OUR change as
    // the client's document changing. Absent stamps read as version 1.
    const [diff] = compareDocumentInspections([
      { ...inspection('i2', 'doc-a', '2026-08-26T11:00:00.000Z', []), instrumentVersion: 2 },
      inspection('i1', 'doc-a', '2026-08-26T10:00:00.000Z', ['2.4.2: no title']),
    ]);

    expect(diff.status).toBe('incomparable');
    expect(diff.newGaps).toEqual([]);
    expect(diff.resolvedGaps).toEqual([]);

    // Same version on both sides — including both absent — compares normally.
    const [comparable] = compareDocumentInspections([
      { ...inspection('i2', 'doc-b', '2026-08-26T11:00:00.000Z', []), instrumentVersion: 1 },
      inspection('i1', 'doc-b', '2026-08-26T10:00:00.000Z', ['2.4.2: no title']),
    ]);
    expect(comparable.status).toBe('improved');
  });

  it('takes the latest two readings per document out of a newest-first listing', () => {
    // Three readings: the diff must be i3 against i2, never against i1 —
    // otherwise a gap fixed two readings ago reads as freshly resolved
    // forever.
    const [diff] = compareDocumentInspections([
      inspection('i3', 'doc-a', '2026-08-26T12:00:00.000Z', []),
      inspection('i2', 'doc-a', '2026-08-26T11:00:00.000Z', []),
      inspection('i1', 'doc-a', '2026-08-26T10:00:00.000Z', ['2.4.2: no title']),
    ]);

    expect(diff.status).toBe('unchanged');
    expect(diff.resolvedGaps).toEqual([]);
    expect(diff.baselineAt).toBe('2026-08-26T11:00:00.000Z');
  });
});
