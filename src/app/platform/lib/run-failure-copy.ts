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
 *
 * None of these send anyone to a log. Three of them did, and an operator has
 * no way to open one: `logEvent` writes to stdout, which is Vercel's function
 * logs, which needs deploy access. Advice nobody on this screen can follow is
 * worse than no advice, because it reads as though the answer exists and they
 * have failed to find it. Each says the one thing that *is* doable from here.
 */
const COPY: Record<RunFailureCode, string> = {
  journey_step_failed:
    'A step could not be performed — usually a selector that no longer matches the page. Record the journey again against the current site.',
  journey_has_no_steps:
    'This run named a site but no path through it, so there was nothing to walk. Add at least one step to the journey, then run it again.',
  // No production caller populates `allowedJourneyIds` — `runBrowserAudit`
  // defaults it to the journey's own id, so the guard always passes and nobody
  // reads this today. Kept because the compiler asks for it and a caller may
  // come; deliberately not given a next step, because there is no person to
  // name: a run refused here would be our own wiring, not an operator's doing.
  journey_not_in_scope: 'This journey is not in the run contract’s scope, so the run was refused.',
  action_not_allowed:
    'A step asked for something this environment forbids. Production is read-only.',
  // Not the reader's to fix, and a first draft of this sentence told them to
  // rename a step they never named. `stepId` is a field on the run request,
  // defaulted to `dashboard` by `audit-run-handler` and hardcoded by the
  // preview route; no screen exposes it and the API schema rejects a bad one
  // at the boundary. So this reaches a stored run only from a caller that
  // bypassed the schema, and the honest next step is to say whose it is.
  invalid_step_id:
    'The run’s step name was not usable as an evidence filename. A run started from a screen names it automatically, so this one came in through the API and the fix belongs to whatever sent it.',
  // Two events share this code: a host the journey does not allow, and a
  // private or reserved address. The second is refused on purpose and stays
  // refused, so the sentence leads with the pair rather than prescribing a fix
  // for the half that has one. Where the fix does apply it says where the
  // field is, because no screen has it — `allowedHosts` is set through the
  // journeys API and `docs/env.md` says it exists for third-party sign-in and
  // nothing else. Told only to widen it, an operator hunts for a control that
  // is not there.
  navigation_not_allowed:
    'The run refused to follow a navigation: somewhere outside this journey’s allowed hosts, or a private address. A private address stays refused. If the destination is legitimate, the journey’s allowed hosts have to be widened deliberately — no screen has that field; it is set through the journeys API.',
  // Nothing throws this: the staleness sweep writes it long after the
  // invocation is gone, so there is no evidence and no findings to read. Every
  // lever behind it — the function ceiling, the walk budget, the page cap —
  // needs deploy access, so the sentence names the one thing doable here and
  // says plainly that a repeat is not this screen's to fix.
  run_timed_out:
    'The run never reported back and was closed out, so it recorded nothing. Usually the journey outlived the function’s time limit. Run it again to see whether it repeats; a journey that keeps timing out needs a deployment change, not a change here.',
  audit_run_failed: 'The run stopped for a reason it could not categorise. Running it again will say whether it repeats.',
};

/**
 * Falls back to the raw code rather than to a friendly guess.
 *
 * A code with no entry here is one the classifier grew and this map did not.
 * Printing it is ugly and true; inventing a sentence for it would be neither.
 */
export function describeRunFailure(code: string): string {
  // `Object.hasOwn`, not `??`. The key comes from a database column with no
  // CHECK behind it, and a stored `__proto__` or `constructor` would resolve
  // through the prototype chain to something truthy and not a string — which
  // React renders by throwing, turning an unrecognised code into a 500 on the
  // journeys screen rather than the fallback written for it.
  return Object.hasOwn(COPY, code)
    ? COPY[code as RunFailureCode]
    : `The run stopped: ${code}.`;
}
