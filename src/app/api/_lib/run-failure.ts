/**
 * Maps an internal failure into a stable, public error code.
 *
 * Run failures surface as thrown Errors whose messages are written for
 * developers, and some of them carry environment names, action names, or
 * filesystem paths. Returning `error.message` verbatim to the caller leaks
 * those internals and, worse, makes the wire format an accident of whatever
 * string someone last edited. Callers get a code they can branch on; the
 * original message still goes to the structured run log, which is where it is
 * useful.
 *
 * Anything unrecognised collapses to `audit_run_failed` — new internal errors
 * are opaque by default rather than leaking until someone notices.
 */
export type RunFailureCode =
  | 'journey_not_in_scope'
  | 'action_not_allowed'
  | 'invalid_step_id'
  | 'incomplete_evidence'
  /**
   * The same code the platform run route answers with, for the callers that
   * do not pass through it: a bearer POST to `/api/audit/run` naming a target
   * and no steps. Without this branch that request got `audit_run_failed` —
   * "a reason it could not categorise" — about the one failure the runner
   * categorised exactly.
   */
  | 'journey_has_no_steps'
  /**
   * A step could not be performed — almost always a selector that no longer
   * matches. Operator-fixable, and previously indistinguishable from a browser
   * crash: both arrived as `audit_run_failed`.
   */
  | 'journey_step_failed'
  // Not produced by `classifyRunFailure`: nothing throws it, because the
  // invocation that would have caught it is gone. `reconcileRunStatus` writes
  // it onto a run left `running` past the point where it could still be alive.
  | 'run_timed_out'
  | 'audit_run_failed';

export function classifyRunFailure(message: string): RunFailureCode {
  // First, and anchored, because this is the only message here built partly
  // from operator-authored text. The branches below match with `includes`, so
  // a journey whose selector happened to contain "incomplete evidence" was
  // classified as an evidence failure — the operator naming their own run's
  // error code by accident. A message starting with `Step N ("` can only have
  // come from `attemptStep`, so it is safe to decide here and stop.
  if (/^Step \d+ \(".*"\) could not /.test(message)) {
    return 'journey_step_failed';
  }
  if (message.includes('not allowed by run contract scope')) {
    return 'journey_not_in_scope';
  }
  // Two shapes reach here: the policy check in run-audit, and the per-step
  // check in the journey runner, which interpolates the action and environment.
  if (message.includes('not allowed by environment policy') || /^Action ".*" is not allowed in /.test(message)) {
    return 'action_not_allowed';
  }
  if (message.startsWith('stepId must')) {
    return 'invalid_step_id';
  }
  if (message.includes('incomplete evidence')) {
    return 'incomplete_evidence';
  }
  // Thrown by `runBrowserAudit` when a run names a target URL and no steps.
  // Anchored to the start of the whole sentence, not a substring of it: the
  // messages reaching here carry operator-supplied selectors and URLs, so a
  // loose `includes` lets a stale-selector timeout be reported as "no steps".
  // That misattributes a failure rather than leaking one, but the fix is a
  // keyword.
  if (message.startsWith('A run against a target URL must name its own steps')) {
    return 'journey_has_no_steps';
  }
  return 'audit_run_failed';
}
