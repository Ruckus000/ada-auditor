import type { EvidenceStatus } from '../../domain/evidence';
import type { DeterministicFinding } from '../../services/deterministic-audit';
import type { JourneyTruncationReason } from '../../domain/run-limits';
import type { JourneyRunnerResult, PageAudit } from './types';

/**
 * Attaches a payload that survives property access and not serialisation.
 *
 * A class field is an own *enumerable* property, so declaring these normally
 * made `JSON.stringify(error)` — which is `{}` for a plain Error — produce the
 * full captured DOM of an authenticated page, within reach of `logger.ts`'s
 * five-level redaction walk. Nothing serialises an error today; this is so
 * nothing can start to.
 *
 * `declare` on the field and one `defineProperty` here, rather than a field
 * plus an assignment plus a redefinition: under `useDefineForClassFields` that
 * was three writes to one property, and the last of them silently made it
 * non-writable and non-configurable too, which is more than the comment
 * claimed. Writable and configurable are explicit now, so the only thing being
 * changed is visibility.
 */
function defineHidden<T>(target: object, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    writable: true,
    configurable: true,
  });
}

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
  declare readonly captured: JourneyRunnerResult;

  constructor(cause: unknown, captured: JourneyRunnerResult) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = cause instanceof Error ? cause.name : 'Error';
    defineHidden(this, 'captured', captured);
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
  declare readonly auditedPages: AuditedPage[];
  /**
   * Pages the cap refused, carried across a boundary that used to drop them.
   *
   * `PartialJourneyError` reported this faithfully and this class had nowhere
   * to put it, so a run that was both truncated *and* failed stored
   * `truncated_pages = 0`: "we audited everything" about a walk that was cut
   * short twice over, which is the one thing the cap must never say quietly.
   */
  readonly truncatedPages: number;
  /**
   * Which bound cut the walk short, carried for the reason `truncatedPages`
   * is: a run that was truncated *and* then failed must not read as a complete
   * audit, and it must not misname what stopped it either. Absent means not
   * truncated.
   */
  readonly truncationReason?: JourneyTruncationReason;
  /**
   * What the walk cost before it died.
   *
   * A fourth positional argument would have been a fourth thing to get in the
   * wrong order, so the tail is one options object. `phaseMs` is here because
   * the failure path is exactly where a run that outran its function ends up,
   * and until now that path recorded no timing at all — the one shape of run
   * whose duration is most worth knowing was the one nothing measured.
   */
  readonly phaseMs?: Record<string, number>;

  constructor(
    cause: Error,
    auditedPages: AuditedPage[],
    truncatedPages: number,
    details: {
      truncationReason?: JourneyTruncationReason;
      phaseMs?: Record<string, number>;
    } = {},
  ) {
    super(cause.message, { cause });
    this.name = cause.name;
    this.truncatedPages = truncatedPages;
    this.truncationReason = details.truncationReason;
    this.phaseMs = details.phaseMs;
    defineHidden(this, 'auditedPages', auditedPages);
  }
}
