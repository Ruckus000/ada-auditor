import { z } from 'zod';
import { auditRunBodySchema, startRun } from '../../_lib/audit-run-handler';
import { createRequestId } from '../../_lib/request-id';
import { hasConsoleSession } from '../../_lib/console-session';
import { isSameOriginConsoleRequest } from '../../_lib/same-origin';

/**
 * Operator paved road: the console runs audits without pasting a token per run.
 *
 * Two independent gates, because neither is sufficient alone:
 *
 *  - An operator session cookie proves the caller knows AUDITOR_RUN_TOKEN. This
 *    is the authentication. Header checks cannot do this job: `sec-fetch-site`
 *    and `Origin` are trustworthy coming from a browser but are freely forged
 *    by any other client, so gating on them alone let anyone run audits with
 *    the server's token.
 *  - The same-origin check remains as CSRF defence, so another site cannot ride
 *    an operator's cookie.
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
  const configuredToken = process.env.AUDITOR_RUN_TOKEN;

  if (!configuredToken) {
    return Response.json(
      { error: 'auditor_run_token_not_configured', requestId },
      { status: 503 },
    );
  }

  if (!isSameOriginConsoleRequest(request)) {
    return Response.json(
      { error: 'console_same_origin_required', requestId },
      { status: 403 },
    );
  }

  if (!hasConsoleSession(request, configuredToken)) {
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
