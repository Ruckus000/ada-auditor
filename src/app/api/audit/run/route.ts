import { isRunAuthorized } from '../../_lib/auth';
import { handleAuditRun } from '../../_lib/audit-run-handler';
import { createRequestId } from '../../_lib/request-id';

/** Chromium needs a real Node runtime; the edge runtime cannot spawn it. */
export const runtime = 'nodejs';

/**
 * A run launches a browser, walks a journey, and scans each page, so it needs
 * far more than the historic serverless default.
 *
 * 300s is the ceiling on Hobby and the default everywhere, so this value is
 * portable across plans. Pro and Enterprise allow up to 800s if a journey
 * grows past what this covers — raise it here, not in vercel.json, so the
 * limit sits next to the code that consumes it.
 */
export const maxDuration = 300;

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
