import type { StoredDocumentInspection } from '../domain/platform';

/**
 * Change over time in a document's gaps — the document pipeline's own
 * comparator, deliberately parallel to `regression.ts` and deliberately NOT
 * sharing `findingKey`: document gaps never become `AuditFinding`s, and the
 * two finding paths stay separate (the standing rule). This diffs one
 * document's inspection history against itself.
 *
 * Inspections only, never conversions. A conversion's summary describes the
 * OUTPUT file — a different artifact — and diffing an inspection of the
 * source against a conversion of the output would compare two documents and
 * call the difference progress.
 *
 * ## Known residuals, named rather than papered over
 *
 * - `listDocumentInspections` is capped at 100 per client, newest first. A
 *   client past that cap loses the oldest baselines — which starves an old
 *   document of a diff, never fabricates one. The safe direction.
 * - Gap identity is the criterion the instrument names. If `gapsIn` in
 *   `domain/document-remediation.ts` ever changes which criteria it emits,
 *   that change will read here as the client's change — the same class of
 *   problem `walkedTheSamePath`'s ruleset check solves for pages, unsolved
 *   here because inspections carry no instrument-version field yet.
 */

/**
 * The identity of one gap for diffing: its criterion prefix (`'1.1.1'`).
 *
 * ONE definition, exported — the same lesson `findingKey` records. The rest
 * of the string embeds a count (`'1.1.1: 3 figures with no alt text'`) that
 * legitimately changes while the failure persists; diffing whole strings
 * would report "3 figures" → "1 figure" as one gap resolved and a new one
 * introduced, when the truth is the same failure, smaller.
 */
export function documentGapKey(gap: string): string {
  const colon = gap.indexOf(':');
  return colon === -1 ? gap : gap.slice(0, colon);
}

export type DocumentGapDiff = {
  documentId: string;
  /** The URL of the CURRENT reading — the address the diff is about. */
  url: string;
  /**
   * `incomparable` when the two readings were taken by different instrument
   * versions — the same answer `walkedTheSamePath` gives page regression for
   * a changed ruleset, and for the same reason: a vocabulary change diffed
   * silently would report OUR change as the client's document changing.
   */
  status: 'first-reading' | 'unchanged' | 'improved' | 'regressed' | 'mixed' | 'incomparable';
  /** Current gap strings whose criterion is absent from the baseline. */
  newGaps: string[];
  /** Baseline gap strings whose criterion is absent from the current reading. */
  resolvedGaps: string[];
  unchangedCount: number;
  currentAt: string;
  baselineAt?: string;
};

/**
 * Latest two readings per document, out of one client-scoped listing.
 *
 * `inspections` is expected newest-first — the order
 * `listDocumentInspections` guarantees — so per document the first sighting
 * is the current reading and the second is its baseline.
 */
export function compareDocumentInspections(
  inspections: StoredDocumentInspection[],
): DocumentGapDiff[] {
  const byDocument = new Map<string, StoredDocumentInspection[]>();
  for (const inspection of inspections) {
    const held = byDocument.get(inspection.documentId);
    if (held === undefined) {
      byDocument.set(inspection.documentId, [inspection]);
    } else if (held.length < 2) {
      held.push(inspection);
    }
  }

  const diffs: DocumentGapDiff[] = [];
  for (const [documentId, readings] of byDocument) {
    const current = readings[0];
    const baseline = readings[1];

    if (baseline === undefined) {
      diffs.push({
        documentId,
        url: current.url,
        status: 'first-reading',
        newGaps: [],
        resolvedGaps: [],
        unchangedCount: current.summary.gaps.length,
        currentAt: current.inspectedAt,
      });
      continue;
    }

    // Rows written before the stamp existed read as version 1 — true, because
    // the vocabulary had not changed while they were being written.
    if ((current.instrumentVersion ?? 1) !== (baseline.instrumentVersion ?? 1)) {
      diffs.push({
        documentId,
        url: current.url,
        status: 'incomparable',
        newGaps: [],
        resolvedGaps: [],
        unchangedCount: 0,
        currentAt: current.inspectedAt,
        baselineAt: baseline.inspectedAt,
      });
      continue;
    }

    const currentKeys = new Set(current.summary.gaps.map(documentGapKey));
    const baselineKeys = new Set(baseline.summary.gaps.map(documentGapKey));

    const newGaps = current.summary.gaps.filter(
      (gap) => !baselineKeys.has(documentGapKey(gap)),
    );
    const resolvedGaps = baseline.summary.gaps.filter(
      (gap) => !currentKeys.has(documentGapKey(gap)),
    );
    const unchangedCount = current.summary.gaps.length - newGaps.length;

    diffs.push({
      documentId,
      url: current.url,
      status:
        newGaps.length === 0 && resolvedGaps.length === 0
          ? 'unchanged'
          : newGaps.length === 0
            ? 'improved'
            : resolvedGaps.length === 0
              ? 'regressed'
              : 'mixed',
      newGaps,
      resolvedGaps,
      unchangedCount,
      currentAt: current.inspectedAt,
      baselineAt: baseline.inspectedAt,
    });
  }

  return diffs;
}
