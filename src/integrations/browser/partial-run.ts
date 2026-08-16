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
  }
}

/** A captured page with its evidence judged and its findings derived. */
export type AuditedPage = PageAudit & {
  evidenceStatus: EvidenceStatus;
  findings: DeterministicFinding[];
};

export class PartialAuditError extends Error {
  readonly auditedPages: AuditedPage[];

  constructor(cause: Error, auditedPages: AuditedPage[]) {
    super(cause.message, { cause });
    this.name = cause.name;
    this.auditedPages = auditedPages;
  }
}
