import { logWarn } from '../../../../../../../../services/logger';
import { allDeliveryDocuments } from '../../../../../../../../services/document-delivery';
import { getPlatformStore } from '../../../../../../../../integrations/persistence';
import { getArtifactStore } from '../../../../../../../../integrations/artifacts/blob-store';
import { isPdf } from '../../../../../../../../domain/document-remediation';
import { pairDocuments } from '../../../../../../../../services/document-pairing';
import { latestReading } from '../../../../../../../../services/document-state';
import { authorizePrincipal } from '../../../../../../_lib/authorize';
import { createRequestId } from '../../../../../../_lib/request-id';
import { fetchDocumentBytes } from '../../../../../../_lib/document-fetch';
import { maxDocumentBytes, readDocumentUpload, refusalResponse } from '../../../../../../_lib/document-upload';
import { previewHeaders, previewPage, previewPdfBytes } from '../../../../../../_lib/document-preview';

export const runtime = 'nodejs';
export const maxDuration = 60;
type Context = { params: Promise<{ clientId: string; documentId: string }> };
async function preview(request: Request, { params }: Context) {
  const requestId = createRequestId();
  const fail = (error: string, status: number) => Response.json({ error, requestId }, { status, headers: previewHeaders });
  try {
  if (!(await authorizePrincipal(request))) return fail('unauthorized', 401);
  const page = previewPage(request);
  if (page === null) return fail('invalid_page', 400);
  const { clientId, documentId } = await params;
  const store = getPlatformStore();
  if (!(await store.getClient(clientId))) return fail('client_not_found', 404);
  const universe = await allDeliveryDocuments(store, clientId);
  const document = universe.find((row) => row.id === documentId);
  if (!document) return fail('document_not_found', 404);
  const source = pairDocuments(universe).get(documentId);
  const reading = latestReading(document, source ? universe.find((row) => row.id === source.id) : undefined);
  if (!reading?.inputSha256) return fail('reading_has_no_bytes', 409);
  // A refreshed workbench may have a different reading. Never place its old
  // asks against that new page merely because the document id stayed the same.
  if (new URL(request.url).searchParams.get('reading') !== reading.at) return fail('preview_reading_changed', 409);
  if (reading.conversionId) {
    const conversion = await store.getDocumentConversion(reading.conversionId);
    if (!conversion?.artifactUrl || conversion.clientId !== clientId) return fail('artifact_not_stored', 404);
    const artifact = await getArtifactStore().read(conversion.artifactUrl);
    if (artifact.status !== 'ok') return fail('artifact_not_stored', 404);
    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = artifact.body.getReader();
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > maxDocumentBytes()) { await reader.cancel(); return fail('file_too_large', 413); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    return previewPdfBytes(Buffer.concat(chunks), page, requestId, conversion.outputSha256);
  }
  if (request.method === 'POST') {
    const upload = await readDocumentUpload(request, { requestId, accept: isPdf, requires: [] });
    if (!upload.ok) return refusalResponse(upload.refusal, requestId);
    return previewPdfBytes(upload.bytes, page, requestId, reading.inputSha256);
  }
  if (document.source !== 'crawl' || document.kind !== 'pdf') return fail('preview_source_required', 409);
  const fetched = await fetchDocumentBytes(document.url, requestId, { accept: isPdf, acceptHeader: 'application/pdf' });
  if (!fetched.ok) return refusalResponse(fetched.refusal, requestId);
  return previewPdfBytes(fetched.bytes, page, requestId, reading.inputSha256);
  } catch {
    logWarn('document_preview_failed', { requestId, failure: 'preview_route_exception' });
    return fail('preview_unavailable', 503);
  }
}
export const GET = preview;
export const POST = preview;
