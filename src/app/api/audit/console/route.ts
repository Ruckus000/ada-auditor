import { handleAuditRun } from '../../_lib/audit-run-handler';
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

  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${configuredToken}`);
  headers.delete('x-auditor-run-token');

  const authorizedRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: await request.text(),
  });

  const result = await handleAuditRun(authorizedRequest, requestId);
  return Response.json(result.body, { status: result.status });
}
