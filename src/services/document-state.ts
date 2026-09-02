import type { Ask } from '../domain/document-answers';
import type { RemediationSummary } from '../domain/document-remediation';
import type { ClientDocumentRecord, StoredDocumentAnswer } from '../domain/platform';

/**
 * One derived state per document, from what the store holds.
 *
 * The inventory used to be a list of instrument readings: a punch list with
 * no identity, filters that judged `gaps` while the work sat in `needs`, and
 * no way to say what an operator should do next. This is the function every
 * surface sorts, filters and counts on instead — computed at read time from
 * the rows, never stored, so it cannot disagree with them.
 *
 * ## The order is the whole design
 *
 * First match wins, and the sequence is the operator's: what they can do
 * before what is blocked on somebody else. `running` is deliberately not
 * here — it is a fact about a browser tab, not a row.
 */
export const DOCUMENT_STATES = [
  'not-reviewed',
  'stale',
  'needs-answers',
  'conformant',
  'ready',
  'waiting-on-client',
  'closed',
] as const;

export type DocumentState = (typeof DOCUMENT_STATES)[number];

export type Reading = {
  summary: RemediationSummary;
  at: string;
  by: 'inspection' | 'conversion';
  /** The bytes the reading is of; absent on readings made before the field. */
  inputSha256?: string;
  /** Set only when a conversion speaks AND its file is actually stored. */
  conversionId?: string;
};

/**
 * The latest word on a document: the conversion if it is newer than the
 * inspection — its gaps are the honest residue of the file actually
 * delivered — else the inspection.
 *
 * A paired PDF reads its Word SOURCE's conversion too. Converting the source
 * is that PDF's remediation, and the delivered file lands on the sibling row;
 * a PDF row that could not see it would keep asking for work already done.
 */
export function latestReading(
  record: ClientDocumentRecord,
  source?: ClientDocumentRecord,
): Reading | null {
  const candidates: Reading[] = [];
  const inspection = record.latestInspection;
  if (inspection) {
    candidates.push({
      summary: inspection.summary,
      at: inspection.inspectedAt,
      by: 'inspection',
      ...(inspection.inputSha256 === undefined ? {} : { inputSha256: inspection.inputSha256 }),
    });
  }
  for (const conversion of [record.latestConversion, source?.latestConversion]) {
    if (!conversion) continue;
    candidates.push({
      summary: conversion.summary,
      at: conversion.convertedAt,
      by: 'conversion',
      inputSha256: conversion.inputSha256,
      ...(conversion.artifactUrl === undefined ? {} : { conversionId: conversion.id }),
    });
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, candidate) => (candidate.at > latest.at ? candidate : latest));
}

export type DocumentStanding = {
  state: DocumentState;
  /** Asks nobody has answered yet — the operator's next work, client asks included. */
  open: Ask[];
  /** Client asks whose latest answer is a request — blocked on the client. */
  waiting: Ask[];
  /** Answers given against other bytes than this reading's. Never applied, always counted. */
  expired: number;
};

function isCompliant(summary: RemediationSummary): boolean {
  return summary.conformance?.checker === 'verapdf-ua1' && summary.conformance.compliant;
}

export function documentState(
  record: Pick<ClientDocumentRecord, 'kind' | 'contentSha256'>,
  reading: Reading | null,
  answers: StoredDocumentAnswer[],
): DocumentStanding {
  if (reading === null) return { state: 'not-reviewed', open: [], waiting: [], expired: 0 };

  // Only answers keyed to the reading's own bytes apply. A reading that does
  // not know its bytes can match nothing: unknown must never read as "same".
  const current = answers.filter(
    (answer) => reading.inputSha256 !== undefined && answer.inputSha256 === reading.inputSha256,
  );
  const expired = answers.length - current.length;
  const latestFor = new Map(current.map((answer) => [answer.askId, answer]));

  const asks = reading.summary.asks ?? [];
  const open = asks.filter((ask) => ask.answerable !== 'none' && !latestFor.has(ask.id));
  const waiting = asks.filter(
    (ask) => ask.answerable === 'client' && latestFor.get(ask.id)?.disposition === 'requested',
  );

  const standing = (state: DocumentState): DocumentStanding => ({ state, open, waiting, expired });

  if (
    record.contentSha256 !== undefined &&
    reading.inputSha256 !== undefined &&
    record.contentSha256 !== reading.inputSha256
  ) {
    return standing('stale');
  }
  if (open.length > 0) return standing('needs-answers');
  if (isCompliant(reading.summary)) return standing('conformant');

  const declaredSince = current.some(
    (answer) => answer.disposition === 'declared' && answer.declaredAt > reading.at,
  );
  // A document whose run is refused — signed, encrypted, untagged — is never
  // "ready": a declared answer waits until the client supplies a file that
  // can be run, and "ready" would send an operator to a button that answers
  // with the refusal.
  const refused = asks.some((ask) => ask.kind === 'repair');
  if (declaredSince && !refused) return standing('ready');
  if (waiting.length > 0) return standing('waiting-on-client');
  // An inspected, tagged PDF has only been read: a repair transcribes what
  // its tree already says, so a run would advance it even with no answers —
  // unless it is waiting on the client, which is the state that says why the
  // run alone would not finish it.
  const repairable = reading.by === 'inspection' && record.kind === 'pdf' && reading.summary.tagged;
  return standing(repairable && !refused ? 'ready' : 'closed');
}

export function countByState(states: Iterable<DocumentState>): Record<DocumentState, number> {
  const counts = Object.fromEntries(DOCUMENT_STATES.map((state) => [state, 0])) as Record<
    DocumentState,
    number
  >;
  for (const state of states) counts[state] += 1;
  return counts;
}

/**
 * What a run closed, by ask id — the diff a result panel shows instead of a
 * second summary box. `documentGapKey` diffs gaps by criterion for the
 * regression view; this diffs the punch list by identity, which is finer.
 */
export function compareAsks(
  previous: Ask[] | undefined,
  next: Ask[] | undefined,
): { closed: Ask[]; remaining: Ask[]; added: Ask[] } {
  const before = previous ?? [];
  const after = next ?? [];
  const afterIds = new Set(after.map((ask) => ask.id));
  const beforeIds = new Set(before.map((ask) => ask.id));
  return {
    closed: before.filter((ask) => !afterIds.has(ask.id)),
    remaining: after.filter((ask) => beforeIds.has(ask.id)),
    added: after.filter((ask) => !beforeIds.has(ask.id)),
  };
}
