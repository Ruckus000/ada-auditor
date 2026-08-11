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
  // Not produced by `classifyRunFailure`: nothing throws it, because the
  // invocation that would have caught it is gone. `reconcileRunStatus` writes
  // it onto a run left `running` past the point where it could still be alive.
  | 'run_timed_out'
  | 'audit_run_failed';

export function classifyRunFailure(message: string): RunFailureCode {
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
  return 'audit_run_failed';
}
