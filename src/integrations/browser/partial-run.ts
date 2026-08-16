import type { EvidenceStatus } from '../../domain/evidence';
import type { DeterministicFinding } from '../../services/deterministic-audit';
import type { JourneyRunnerResult, PageAudit } from './types';

/**
 * What a failed run had already captured, carried out with the error.
 *
 * Its own module, and deliberately a light one: these are thrown by the
 * browser layer and caught by the API handler, so the handler needs the class
 * itself — `instanceof` is a value, not a type. Exported from
 * `run-browser-audit` instead, they dragged `playwright-core` into the fast
 * unit suite the moment a test mocked that module with `importOriginal` to
 * keep them. Nothing here imports anything that runs.
 *
 * Both wrap rather than replace. `message` and `name` are copied from the
 * original and `cause` preserved, so `classifyRunFailure` — which reads
 * `.message` — returns exactly what it returned before. A run that fails
 * still fails with the same code; it just stops taking its own evidence down
 * with it.
 *
 * Two classes rather than one because the layers hold different things: raw
 * captures below, evidence already judged against the run's contract above.
 * Collapsing them would put the evidence rules in the runner.
 */
export class PartialJourneyError extends Error {
  readonly captured: JourneyRunnerResult;

  constructor(cause: unknown, captured: JourneyRunnerResult) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = cause instanceof Error ? cause.name : 'Error';
    this.captured = captured;

    // See the note on `PartialAuditError`: keeps a captured DOM out of
    // `JSON.stringify(error)`, which is `{}` for a plain Error.
    Object.defineProperty(this, 'captured', { enumerable: false, value: captured });
  }
}

/**
 * A captured page with its evidence judged, its findings derived, and the
 * check counts behind a score.
 *
 * `checks` is here rather than computed by the success path alone, because
 * partial pages were persisting `checks_passed/failed/incomplete = null` — the
 * upload reads `checks`, and only complete runs ever produced it.
 */
export type AuditedPage = PageAudit & {
  evidenceStatus: EvidenceStatus;
  findings: DeterministicFinding[];
  // `passed` is optional because axe's own `passCount` is: a scan that could
  // not count passes has no denominator, and zero would claim one.
  checks: { passed?: number; failed: number; incomplete: number };
};

export class PartialAuditError extends Error {
  readonly auditedPages: AuditedPage[];
  /**
   * Pages the cap refused, carried across a boundary that used to drop them.
   *
   * `PartialJourneyError` reported this faithfully and this class had nowhere
   * to put it, so a run that was both truncated *and* failed stored
   * `truncated_pages = 0`: "we audited everything" about a walk that was cut
   * short twice over, which is the one thing the cap must never say quietly.
   */
  readonly truncatedPages: number;

  constructor(cause: Error, auditedPages: AuditedPage[], truncatedPages: number) {
    super(cause.message, { cause });
    this.name = cause.name;
    this.auditedPages = auditedPages;
    this.truncatedPages = truncatedPages;

    // Not enumerable. A class field is an own enumerable property, so
    // `JSON.stringify(error)` — which yields `{}` for a plain Error — would
    // have produced the full captured DOM of an authenticated page, and
    // `logger.ts`'s redaction walks five levels deep looking for keys it
    // knows. Nothing serialises an error today; this is so nothing can.
    Object.defineProperty(this, 'auditedPages', { enumerable: false, value: auditedPages });
  }
}
