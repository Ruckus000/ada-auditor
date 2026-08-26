import type { DocumentLinkKind } from '../domain/discovery';
import type {
  ClientDocumentRecord,
  DocumentReportEntry,
  DocumentReportSection,
} from '../domain/platform';
import type { RemediationSummary } from '../domain/document-remediation';

/**
 * The documents section of an issued client report, built once and pinned.
 *
 * Reports are run-anchored and immutable by documented design
 * (`report-view.ts` states the guarantee); the document inventory is
 * client-anchored and changes with every scan. The join between them is a
 * decision, and this module encodes it: the section is a SNAPSHOT captured
 * when the report is issued, stored on the report row, and never recomputed —
 * a shared link shows what was true when it was issued, exactly like the run
 * half beside it.
 *
 * Document gaps NEVER gate a run and never become `AuditFinding`s — the two
 * finding paths stay separate, per the standing rule. This section is purely
 * additive evidence.
 *
 * The shapes live in `domain/platform.ts` beside `StoredReport`, which stores
 * them; the privacy rule they encode (no `titleText` — the shared page is
 * public-by-token, and a document's stated title is document content) is
 * documented there and enforced here by field-by-field construction.
 */

/**
 * The latest word on a document: the conversion if it is newer than the
 * inspection — its gaps are the honest residue of the file actually
 * delivered — else the inspection.
 */
function latestReading(
  record: ClientDocumentRecord,
): { summary: RemediationSummary; at: string; by: 'inspection' | 'conversion' } | null {
  const inspection = record.latestInspection;
  const conversion = record.latestConversion;
  if (inspection && conversion) {
    return conversion.convertedAt > inspection.inspectedAt
      ? { summary: conversion.summary, at: conversion.convertedAt, by: 'conversion' }
      : { summary: inspection.summary, at: inspection.inspectedAt, by: 'inspection' };
  }
  if (conversion) {
    return { summary: conversion.summary, at: conversion.convertedAt, by: 'conversion' };
  }
  if (inspection) {
    return { summary: inspection.summary, at: inspection.inspectedAt, by: 'inspection' };
  }
  return null;
}

export function buildDocumentReport(
  documents: ClientDocumentRecord[],
  capturedAt: string,
): DocumentReportSection {
  const byKind: Partial<Record<DocumentLinkKind, number>> = {};
  const entries: DocumentReportEntry[] = [];
  let unread = 0;
  let withGaps = 0;

  for (const record of documents) {
    byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;

    const reading = latestReading(record);
    if (reading === null) {
      // Counted but contributing no gap lines — a gap list comes from an
      // instrument reading, not from absence.
      unread += 1;
      continue;
    }
    if (reading.summary.gaps.length > 0) withGaps += 1;

    // Field by field, never a spread: `RemediationSummary` carries
    // `titleText`, and a spread here is one added summary field away from
    // publishing document content on a public page.
    entries.push({
      url: record.url,
      kind: record.kind,
      source: record.source,
      ...(record.foundOn === undefined ? {} : { foundOn: record.foundOn }),
      readAt: reading.at,
      readBy: reading.by,
      tagged: reading.summary.tagged,
      pages: reading.summary.pages,
      gaps: [...reading.summary.gaps],
    });
  }

  return {
    capturedAt,
    totals: {
      documents: documents.length,
      byKind,
      read: entries.length,
      withGaps,
      unread,
    },
    entries,
  };
}
