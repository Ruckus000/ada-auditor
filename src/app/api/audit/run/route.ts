import { isRunAuthorized } from '../../_lib/auth';
import { handleAuditRun } from '../../_lib/audit-run-handler';
import { createRequestId } from '../../_lib/request-id';

export async function POST(request: Request) {
  const requestId = createRequestId();

  if (!isRunAuthorized(request)) {
    return Response.json(
      { error: 'unauthorized', requestId },
      { status: 401 },
    );
  }

  const result = await handleAuditRun(request, requestId);
  return Response.json(result.body, { status: result.status });
}
