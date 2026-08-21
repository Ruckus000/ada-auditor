'use client';

import { useState } from 'react';

/**
 * The error-code plumbing every platform form needs, written once.
 *
 * The house rule is that state holds a machine code and the sentence is
 * derived at render — see `where-screen.tsx` for why: only the code knows
 * which field an error was about. Every form that follows the rule then needs
 * the same three pieces, and five of them grew their own copy: a `MESSAGES`
 * record, a `NETWORK_ERROR_CODE` constant, and a ternary chain resolving one
 * to the other. The copies had already drifted — "Could not reach the server."
 * in two of them, the same sentence plus "Check your connection and try again."
 * in the others, and one file that declared the constant and then set the code
 * with a bare `'network'` literal.
 *
 * That is the failure this exists to stop: a copy change applied to some of
 * them looks complete, because whichever screen was tested shows the new text.
 */

/** A network failure never reached the server, so it never got a server error code. */
export const NETWORK_ERROR_CODE = 'network';

/**
 * The codes more than one form can receive, said the same way by all of them.
 *
 * A form's own map wins over this one — `verify-button` has a sharper sentence
 * for `invalid_journey_steps` because it is about to walk those steps, not run
 * them — so sharing the vocabulary does not flatten the copy.
 */
export const SHARED_ERROR_MESSAGES: Record<string, string> = {
  [NETWORK_ERROR_CODE]: 'Could not reach the server. Check your connection and try again.',
  unauthorized: 'Your session expired. Reload and sign in again.',
  journey_not_found: 'That journey is no longer on this client.',
  run_budget_exceeded: 'The run budget for this window is used up. Try again later.',
  invalid_journey_steps: 'This journey’s stored steps are not valid. Record it again.',
};

export type ErrorCopy = {
  /** The code, for the decisions only a code can make (`aria-invalid`, which field). */
  errorCode: string | null;
  /** The HTTP status behind it, or null when nothing reached the server. */
  errorStatus: number | null;
  /** The sentence, derived — never stored, never assembled at the call site. */
  errorMessage: string | null;
  setErrorCode: (code: string, status?: number | null) => void;
  clearError: () => void;
};

/**
 * `messages` are this form's own codes; `fallback` says what an unmapped one
 * reads as, and takes the status because most forms name it ("Could not add
 * the client (503). Try again.").
 */
export function useErrorCode(
  messages: Record<string, string>,
  fallback: (status: number | null) => string,
): ErrorCopy {
  const [error, setError] = useState<{ code: string; status: number | null } | null>(null);

  return {
    errorCode: error?.code ?? null,
    errorStatus: error?.status ?? null,
    errorMessage:
      error === null
        ? null
        : (messages[error.code] ?? SHARED_ERROR_MESSAGES[error.code] ?? fallback(error.status)),
    setErrorCode: (code, status = null) => setError({ code, status }),
    clearError: () => setError(null),
  };
}
