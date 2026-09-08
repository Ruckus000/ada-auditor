import { getPlatformStore } from '../../../../integrations/persistence';
import { getArtifactStore } from '../../../../integrations/artifacts/blob-store';
import { deliveryBytes, DeliveryRefusal } from '../../../../services/document-delivery';
import { createRequestId } from '../../../api/_lib/request-id';
import { logWarn } from '../../../../services/logger';
export const runtime = 'nodejs';
export const maxDuration = 300;
const headers = {'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer'};
export async function GET(_request: Request, {params}: {params: Promise<{token: string}>}) {
  const requestId = createRequestId();
  const {token} = await params;
  const platform = getPlatformStore();
  const bundle = /^[a-f0-9]{64}$/.test(token) ? await platform.getDeliveryByToken(token) : null;
  if (!bundle) return Response.json({error: 'delivery_not_found', requestId}, {status: 404, headers});
  try {
    const bytes = await deliveryBytes(getArtifactStore(), bundle.artifactUrl, bundle.sha256);
    if (!await platform.getDeliveryByToken(token)) return Response.json({error: 'delivery_not_found', requestId}, {status: 404, headers});
    return new Response(new Uint8Array(bytes), {headers: {...headers, 'content-type': 'application/zip',
      'content-disposition': `attachment; filename="delivery-${bundle.id}.zip"`, 'x-request-id': requestId}});
  } catch (error) {
    const code = error instanceof DeliveryRefusal ? error.code : 'delivery_unavailable';
    logWarn('delivery_download_failed', {requestId, bundleId: bundle.id, code});
    return Response.json({error: 'delivery_unavailable', requestId}, {status: 503, headers});
  }
}
