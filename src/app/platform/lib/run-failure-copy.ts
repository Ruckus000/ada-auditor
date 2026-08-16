import type { RunFailureCode } from '../../api/_lib/run-failure';

/**
 * Why a run stopped, in words an operator can act on.
 *
 * `failureReason` has been stored since failures were first classified and
 * read by nothing, so every failure rendered as `? INCONCLUSIVE` with no
 * explanation — a stale selector, a browser crash and a journey walked out of
 * scope all looked identical on the screen, and each needs a different person
 * to do a different thing.
 *
 * Not `glossary.ts`'s `API_ERRORS`. That map is reached only by
 * `describeApiError` ← `verdict-panel` ← the `/console` screen, and these
 * codes come off a stored platform run, which that screen never shows. An
 * entry there would be copy nobody could reach — it has already happened once
 * on this codebase and had to be deleted.
 *
 * Keyed by `RunFailureCode` rather than `string`, so a new code cannot be
 * added to the classifier without the compiler asking what it should say.
 */
const COPY: Record<RunFailureCode, string> = {
  journey_step_failed:
    'A step could not be performed — usually a selector that no longer matches. Check the run log for which one, then record the journey again.',
  journey_has_no_steps:
    'This run named a site but no path through it, so there was nothing to walk.',
  journey_not_in_scope: 'This journey is not in the run contract’s scope, so the run was refused.',
  action_not_allowed:
    'A step asked for something this environment forbids. Production is read-only.',
  invalid_step_id: 'The run’s step name was not usable as an evidence filename.',
  incomplete_evidence:
    'A page’s evidence could not be captured in full, and this run was set to stop rather than report a partial result.',
  run_timed_out:
    'The run never reported back and was closed out. Usually the journey outlived the function’s time limit.',
  audit_run_failed: 'The run stopped for a reason it could not categorise. The run log has the detail.',
};

/**
 * Falls back to the raw code rather than to a friendly guess.
 *
 * A code with no entry here is one the classifier grew and this map did not.
 * Printing it is ugly and true; inventing a sentence for it would be neither.
 */
export function describeRunFailure(code: string): string {
  return COPY[code as RunFailureCode] ?? `The run stopped: ${code}.`;
}
