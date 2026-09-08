import { z } from 'zod';
import { deliveryOverview, prepareDelivery, DeliveryRefusal } from '../../../../../../services/document-delivery';
import { bundleResponse, deliveryDependencies, deliveryFailure } from '../../../../_lib/document-delivery';
import { authorizePrincipal } from '../../../../_lib/authorize';
import { createRequestId } from '../../../../_lib/request-id';
export const runtime = 'nodejs';
export const maxDuration = 300;
type Context = {params: Promise<{clientId: string}>};
const selection = z.object({documentIds: z.array(z.string().min(1).max(128)).min(1).max(100)}).strict();
export async function GET(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    if (!await authorizePrincipal(request)) throw new DeliveryRefusal('unauthorized', 401);
    const {clientId} = await context.params;
    const deps = deliveryDependencies();
    if (!await deps.platform.getClient(clientId)) throw new DeliveryRefusal('client_not_found', 404);
    const v = await deliveryOverview(deps.platform, clientId);
    return Response.json({rows: v.rows.map(r => ({documentId: r.record.id, url: r.record.url, reason: r.reason,
      excluded: Boolean(r.exclusion), exclusionReason: r.exclusion?.reason,
      signedOff: Boolean(r.signoff && !r.reason && !r.exclusion), delivered: r.delivered,
      eligible: !r.reason && !r.exclusion})), counts: {signedOff: v.signedOff, delivered: v.delivered, excluded: v.excluded, eligible: v.eligible},
      bundles: v.bundles.map(bundleResponse)}, {headers: {'cache-control': 'no-store'}});
  } catch (error) { return deliveryFailure(error, requestId); }
}
export async function POST(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const actor = await authorizePrincipal(request);
    if (!actor) throw new DeliveryRefusal('unauthorized', 401);
    if (actor.kind !== 'operator') throw new DeliveryRefusal('operator_required', 403);
    const input = selection.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new DeliveryRefusal('bundle_selection_invalid', 400);
    const {clientId} = await context.params;
    const bundle = await prepareDelivery(deliveryDependencies(), clientId, input.data.documentIds, actor);
    return Response.json({bundle: bundleResponse(bundle), requestId}, {status: 201});
  } catch (error) { return deliveryFailure(error, requestId); }
}
