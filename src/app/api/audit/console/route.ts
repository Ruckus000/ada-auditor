import { z } from 'zod';
import { auditRunBodySchema, startRun } from '../../_lib/audit-run-handler';
import { createRequestId } from '../../_lib/request-id';
import { authorizePrincipal } from '../../_lib/authorize';

/**
 * Operator paved road: the console runs audits without pasting a token per run.
 *
 * Authorization is `authorizePrincipal`, the same function every other route
 * uses. It was not, and that mattered: this route gated on
 * `hasConsoleSession(request, AUDITOR_RUN_TOKEN)`, which validates only the
 * **v1** cookie shape. A v2 operator cookie starts `v2.`, so `isValidSessionValue`
 * read `Number('v2')` as NaN and refused it — meaning anyone who signed in with
 * an email and a password could not use this console at all, while the token
 * holder could.
 *
 * That is the second copy of an authorization rule `authorize.ts` exists to
 * hold; its own comment records the same rule having been copy-pasted into four
 * route files before. This was the fifth, and the one that drifted.
 *
 * The shared function keeps both gates this route hand-rolled — bearer token OR
 * (same-origin AND a valid session cookie) — and adds the operator cookie. The
 * same-origin check still never stands alone: `sec-fetch-site` and `Origin` are
 * trustworthy from a browser and forged freely by anything else.
 *
 * External integrations still call POST /api/audit/run with Bearer auth.
 */

// This route launches Chromium, exactly like /api/audit/run — and until now it
// declared neither of the things that makes that work. Without `runtime` it can
// be placed on a runtime that cannot spawn a browser at all, and without
// `maxDuration` a real multi-page journey is cut off at the platform default
// while the same journey through /api/audit/run gets 300 seconds. Every
// browser-launching route needs both.
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  const requestId = createRequestId();

  /**
   * Unchanged, and deliberately ahead of the auth check.
   *
   * `startRun` does not read this token — it is reached in-process — so this is
   * not a precondition of running an audit. It is a statement about the
   * deployment: `/api/ready` gates on `auditorRunTokenConfigured`, so a
   * deployment without it is one nothing should be driving yet, and 503 says
   * that where 401 would send an operator to re-enter a credential that was
   * never going to work.
   *
   * The honest edge: with `AUDITOR_SESSION_SECRET` set and this unset, an
   * operator cookie would in fact authenticate, and this still answers 503.
   * That combination is a deployment `/api/ready` already calls not-ready.
   */
  if (!process.env.AUDITOR_RUN_TOKEN) {
    return Response.json(
      { error: 'auditor_run_token_not_configured', requestId },
      { status: 503 },
    );
  }

  if (!(await authorizePrincipal(request))) {
    return Response.json({ error: 'console_session_required', requestId }, { status: 401 });
  }

  let parsedBody: z.infer<typeof auditRunBodySchema>;
  try {
    parsedBody = auditRunBodySchema.parse(await request.json());
  } catch {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }

  // The console renders a result when the run finishes, so it asks for the
  // synchronous mode. The async 202 shape is for API and CI callers, which
  // poll; adopting it here would mean rewriting the console's run flow for no
  // gain it can currently use.
  //
  // This used to rebuild the request with `authorization: Bearer <the server's
  // own token>` forged onto it, because an HTTP handler was the only way to
  // reach the run path. Now that `startRun` exists, the caller that has already
  // authenticated the operator simply calls it. Nothing manufactures a
  // credential, which matters more the moment identity is per-user: there would
  // then be a real principal being impersonated rather than a shared secret
  // being handed back to its owner.
  const result = await startRun({ ...parsedBody, wait: true }, requestId);
  return Response.json(result.body, { status: result.status });
}
