import { isRunAuthorized } from '../../../../_lib/auth';
import { createRequestId } from '../../../../_lib/request-id';
import { getRunStore } from '../../../../../../integrations/persistence';
import { renderPdf } from '../../../../../../integrations/browser/render-pdf';
import { renderRunReport } from '../../../../../../services/report-html';

/** Rendering the report launches Chromium, so this needs the Node runtime. */
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * The client-facing deliverable: a stored run as a PDF.
 *
 * Rendered through the same Chromium that runs the audit, so this costs no new
 * dependency and no third-party rendering service.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const traceId = createRequestId();

  if (!isRunAuthorized(request)) {
    return Response.json({ error: 'unauthorized', requestId: traceId }, { status: 401 });
  }

  const { requestId } = await params;
  const run = await getRunStore().getRun(requestId);

  if (!run) {
    return Response.json({ error: 'run_not_found', requestId: traceId }, { status: 404 });
  }

  const pdf = await renderPdf(renderRunReport(run));

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="accessibility-report-${run.journeyId}.pdf"`,
      // The report contains findings from a client's site. It is fetched with a
      // credential and must not be retained by anything in between.
      'cache-control': 'private, no-store',
    },
  });
}
