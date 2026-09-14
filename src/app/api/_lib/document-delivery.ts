import type { DeliveryBundle } from '../../../domain/document-delivery';
import { getPlatformStore } from '../../../integrations/persistence';
import { getArtifactStore } from '../../../integrations/artifacts/blob-store';
import { verifyPdfBytes } from '../../../integrations/documents/verapdf';
import { createDeliveryArchive } from '../../../integrations/documents/archive';
import { DeliveryRefusal, type DeliveryDependencies } from '../../../services/document-delivery';
import { logWarn } from '../../../services/logger';
import { documentBudgetRefusal } from './budget-refusal';

/**
 * The two stages delivery spawns — veraPDF for a legacy sign-off, the Archive
 * JVM for a bundle — charge the document budget at the moment they run, the
 * rule every other document door follows. Charged here, at the seam that
 * spawns them, rather than per route: the legacy re-verify is the only sign-off
 * that launches anything, and only this wrapper knows it is happening.
 */
async function charged(): Promise<void> {
  const capped = await documentBudgetRefusal();
  if (capped) throw new DeliveryRefusal(capped.error, capped.status, capped.message);
}

export function deliveryDependencies(): DeliveryDependencies {
  return {
    platform: getPlatformStore(),
    artifacts: getArtifactStore(),
    verify: async (bytes) => { await charged(); return verifyPdfBytes(bytes); },
    archive: async (entries) => { await charged(); return createDeliveryArchive(entries); },
  };
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
  return Response.json({error: refusal.code, requestId, retry: refusal.code === 'document_changed' ? 'refresh' : 'none',
    ...(refusal.sentence ? {message: refusal.sentence} : {})}, {status: refusal.status});
}
