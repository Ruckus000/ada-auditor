import type { DeliveryBundle } from '../../../domain/document-delivery';
import { getPlatformStore } from '../../../integrations/persistence';
import { getArtifactStore } from '../../../integrations/artifacts/blob-store';
import { verifyPdfBytes } from '../../../integrations/documents/verapdf';
import { createDeliveryArchive } from '../../../integrations/documents/archive';
import { DeliveryRefusal } from '../../../services/document-delivery';
import { logWarn } from '../../../services/logger';

export function deliveryDependencies() {
  return {platform: getPlatformStore(), artifacts: getArtifactStore(), verify: verifyPdfBytes, archive: createDeliveryArchive};
}

/** Only the operator-facing shape. Private artifact handles never leave the server. */
export function bundleResponse(bundle: DeliveryBundle) {
  return {id: bundle.id, clientName: bundle.clientName, entries: bundle.entries, omissions: bundle.omissions,
    preparedAt: bundle.preparedAt, preparedBy: bundle.preparedBy, bytes: bundle.bytes, sha256: bundle.sha256,
    ...(bundle.issuedAt ? {issuedAt: bundle.issuedAt} : {}), ...(bundle.token ? {token: bundle.token} : {}),
    ...(bundle.revokedAt ? {revokedAt: bundle.revokedAt} : {})};
}
export function deliveryFailure(error: unknown, requestId: string): Response {
  const refusal = error instanceof DeliveryRefusal ? error : new DeliveryRefusal('delivery_failed', 500);
  logWarn('document_delivery_failed', {requestId, code: refusal.code});
  return Response.json({error: refusal.code, requestId, retry: refusal.code === 'document_changed' ? 'refresh' : 'none'}, {status: refusal.status});
}
