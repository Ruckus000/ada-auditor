import { handleAuditRun } from '../../_lib/audit-run-handler';
import { createRequestId } from '../../_lib/request-id';

/**
 * Operator paved road: same-origin console uses server env token.
 * External integrations must still call POST /api/audit/run with Bearer auth.
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

export function isSameOriginConsoleRequest(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'same-origin') {
    return true;
  }

  const origin = request.headers.get('origin');
  if (!origin) {
    return false;
  }

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
