import { logWarn } from '../../../services/logger';
import {
  consumeDiscoveryBudget,
  consumeDocumentBudget,
  discoveryBudgetLimits,
  documentBudgetLimits,
  type BudgetVerdict,
} from '../../../services/run-budget';
import type { UploadRefusal } from './document-upload';
import { getRunCounter } from './run-counter';

/**
 * A spent ceiling, as the refusal a route hands back.
 *
 * Two ceilings answer this way. Document work has eight doors — four uploads
 * that share `readDocumentUpload`, and four that fetch or catalog by URL —
 * and discovery has two crawl routes; every one asks here after the caller
 * is authorised and before anything is buffered, probed, fetched or
 * launched. A refused request is therefore not a document, not a row, not a
 * crawl and not an event: the caller was told, which is the rule a refused
 * audit run already follows.
 *
 * Shaped as an `UploadRefusal` rather than a new envelope, because the
 * routes already know how to answer with one, and `message` is the field
 * that exists for a refusal that is a true answer rather than a failure.
 * The sentence says when the window resets, so a person reading it on a
 * screen knows whether to wait or to go home — "try again", the copy
 * modules' usual instruction, is the one thing this refusal makes wrong.
 */
export async function documentBudgetRefusal(requestId?: string): Promise<UploadRefusal | null> {
  const verdict = await consumeDocumentBudget(getRunCounter());
  return refusalFor(verdict, {
    code: 'document_budget_exceeded',
    subject: 'Document work',
    limits: documentBudgetLimits(),
    requestId,
  });
}

export async function discoveryBudgetRefusal(requestId?: string): Promise<UploadRefusal | null> {
  const verdict = await consumeDiscoveryBudget(getRunCounter());
  return refusalFor(verdict, {
    code: 'discovery_budget_exceeded',
    subject: 'Discovery',
    limits: discoveryBudgetLimits(),
    requestId,
  });
}

function refusalFor(
  verdict: BudgetVerdict,
  spec: { code: string; subject: string; limits: { perHour: number; perDay: number }; requestId?: string },
): UploadRefusal | null {
  if (verdict.allowed) return null;

  const window = verdict.window ?? 'hour';
  const resetsInSeconds = verdict.resetsInSeconds ?? 0;
  logWarn(spec.code, {
    ...(spec.requestId === undefined ? {} : { requestId: spec.requestId }),
    window,
    resetsInSeconds,
  });

  const ceiling = window === 'hour' ? spec.limits.perHour : spec.limits.perDay;
  return {
    status: 429,
    error: spec.code,
    detail: window,
    message: `${spec.subject} is capped at ${ceiling} per ${window} and this ${window} is spent. It resets in ${resetsIn(resetsInSeconds)}.`,
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
