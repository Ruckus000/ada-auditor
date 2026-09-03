import { logWarn } from '../../../services/logger';
import { consumeDocumentBudget, documentBudgetLimits } from '../../../services/run-budget';
import type { UploadRefusal } from './document-upload';
import { getRunCounter } from './run-counter';

/**
 * The document ceiling, as the refusal a route hands back.
 *
 * Eight doors launch document work — four uploads that share
 * `readDocumentUpload`, and four that fetch or catalog by URL — and every one
 * asks here first, after the caller is authorised and before anything is
 * buffered, probed, fetched or written. A refused request is therefore not a
 * document, not a row and not an event: the caller was told, which is the
 * rule a refused audit run already follows.
 *
 * Shaped as an `UploadRefusal` rather than a new envelope, because the
 * routes already know how to answer with one, and `message` is the field
 * that exists for a refusal that is a true answer rather than a failure.
 * The sentence says when the window resets, so a person reading it on the
 * inventory screen knows whether to wait or to go home.
 */
export async function documentBudgetRefusal(requestId?: string): Promise<UploadRefusal | null> {
  const verdict = await consumeDocumentBudget(getRunCounter());
  if (verdict.allowed) return null;

  const window = verdict.window ?? 'hour';
  const resetsInSeconds = verdict.resetsInSeconds ?? 0;
  logWarn('document_budget_exceeded', {
    ...(requestId === undefined ? {} : { requestId }),
    window,
    resetsInSeconds,
  });

  const limits = documentBudgetLimits();
  const ceiling = window === 'hour' ? limits.perHour : limits.perDay;
  return {
    status: 429,
    error: 'document_budget_exceeded',
    detail: window,
    message: `Document work is capped at ${ceiling} per ${window} and this ${window} is spent. It resets in ${resetsIn(resetsInSeconds)}.`,
  };
}

function resetsIn(seconds: number): string {
  if (seconds < 90 * 60) {
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  const hours = Math.ceil(seconds / 3600);
  return `${hours} hours`;
}
