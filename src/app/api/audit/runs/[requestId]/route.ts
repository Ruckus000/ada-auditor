import { authorizePrincipal } from '../../../_lib/authorize';
import { createRequestId } from '../../../_lib/request-id';
import { getRunStore } from '../../../../../integrations/persistence';

/** Fetch one run by id — the counterpart to `runs/latest`. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const traceId = createRequestId();

  if (!(await authorizePrincipal(request))) {
    return Response.json({ error: 'unauthorized', requestId: traceId }, { status: 401 });
  }

  const { requestId } = await params;
  const run = await getRunStore().getRun(requestId);

  if (!run) {
    return Response.json({ error: 'run_not_found', requestId: traceId }, { status: 404 });
  }

  return Response.json({ requestId: traceId, run }, { status: 200 });
}
