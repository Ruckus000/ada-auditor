import { logWarn } from '../../../../services/logger';
import { isPdf } from '../../../../domain/document-remediation';
import { readDocumentUpload, refusalResponse } from '../../_lib/document-upload';
import { createRequestId } from '../../_lib/request-id';
import { previewHeaders, previewPage, previewPdfBytes } from '../../_lib/document-preview';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  const requestId = createRequestId();
  try {
  const page = previewPage(request);
  if (page === null) return Response.json({ error: 'invalid_page', requestId }, { status: 400, headers: previewHeaders });
  const upload = await readDocumentUpload(request, { requestId, accept: isPdf, requires: [] });
  if (!upload.ok) return refusalResponse(upload.refusal, requestId);
  return previewPdfBytes(upload.bytes, page, requestId);
  } catch {
    logWarn('document_preview_failed', { requestId, failure: 'preview_route_exception' });
    return Response.json({ error: 'preview_unavailable', requestId }, { status: 503, headers: previewHeaders });
  }
}
