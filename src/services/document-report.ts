import type { DocumentLinkKind } from '../domain/discovery';
import type {
  ClientDocumentRecord,
  DocumentReportEntry,
  DocumentReportSection,
  StoredDocumentAnswer,
} from '../domain/platform';
import type { RemediationSummary } from '../domain/document-remediation';
import { pairDocuments } from './document-pairing';

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
function latestReading(record: ClientDocumentRecord):
  | {
      summary: RemediationSummary;
      at: string;
      by: 'inspection' | 'conversion';
      /** The bytes the reading is of; what an answer is matched against. */
      inputSha256?: string;
      /** Set only when a conversion speaks AND its file is actually stored —
       * a download handle on the public page must never point at nothing. */
      conversionId?: string;
    }
  | null {
  const inspection = record.latestInspection;
  const conversion = record.latestConversion;
  const conversionReading = conversion
    ? {
        summary: conversion.summary,
        at: conversion.convertedAt,
        by: 'conversion' as const,
        inputSha256: conversion.inputSha256,
        ...(conversion.artifactUrl === undefined ? {} : { conversionId: conversion.id }),
      }
    : null;
  const inspectionReading = inspection
    ? {
        summary: inspection.summary,
        at: inspection.inspectedAt,
        by: 'inspection' as const,
        ...(inspection.inputSha256 === undefined ? {} : { inputSha256: inspection.inputSha256 }),
      }
    : null;

  if (inspectionReading && conversionReading) {
    return conversionReading.at > inspectionReading.at ? conversionReading : inspectionReading;
  }
  return conversionReading ?? inspectionReading;
}

/**
 * The punch items the client has been asked for: client asks whose latest
 * answer at the reading's own bytes is a request. The items' sentences,
 * never the operator's note.
 */
function requestedItems(
  reading: NonNullable<ReturnType<typeof latestReading>>,
  answers: StoredDocumentAnswer[],
): string[] {
  const asks = reading.summary.asks ?? [];
  const needs = reading.summary.needs ?? [];
  const requested = new Set(
    answers
      .filter((a) => a.inputSha256 === reading.inputSha256 && a.disposition === 'requested')
      .map((a) => a.askId),
  );
  return asks.flatMap((ask, index) =>
    ask.answerable === 'client' && requested.has(ask.id) && needs[index] ? [needs[index].item] : [],
  );
}

export function buildDocumentReport(
  documents: ClientDocumentRecord[],
  capturedAt: string,
  /** Latest answers per (document, bytes, ask), for every document listed. */
  answers: StoredDocumentAnswer[] = [],
): DocumentReportSection {
  const pairs = pairDocuments(documents);
  const answersByDocument = new Map<string, StoredDocumentAnswer[]>();
  for (const answer of answers) {
    answersByDocument.set(answer.documentId, [...(answersByDocument.get(answer.documentId) ?? []), answer]);
  }
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
      ...(reading.conversionId === undefined ? {} : { conversionId: reading.conversionId }),
      tagged: reading.summary.tagged,
      pages: reading.summary.pages,
      gaps: [...reading.summary.gaps],
      // Punch items are counts-and-work statements ("Figure 1 needs a
      // human-written description") — no document content, so they pass the
      // same no-titleText review this construction exists for.
      ...(reading.summary.needs === undefined ? {} : { needs: reading.summary.needs.map((n) => ({ ...n })) }),
      ...(pairs.has(record.id) ? { sourceAvailable: true as const } : {}),
      ...(reading.summary.conformance === undefined
        ? {}
        : { conformance: reading.summary.conformance }),
      // Criterion identifiers only — the same counts-and-outcomes material the
      // gaps and needs above are, and the thing that stops a pinned entry
      // reading as a broader claim than the instrument made. Omitted rather
      // than defaulted when the reading predates the field: absence means "not
      // recorded", and inventing a scope for an old reading would be the
      // overstatement this exists to end.
      ...(reading.summary.scope === undefined
        ? {}
        : { scope: { criteria: [...reading.summary.scope.criteria] } }),
      // Counts of what a person supplied, and the items asked of the client
      // — field by field, for the same reason as everything above: an
      // answer's `value` and `note` are content, and neither reaches here.
      ...(reading.summary.declared === undefined
        ? {}
        : { declared: { ...reading.summary.declared } }),
      ...(() => {
        const requested = requestedItems(reading, answersByDocument.get(record.id) ?? []);
        return requested.length === 0 ? {} : { requested };
      })(),
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
