import { z } from 'zod';
import { deliveryBytes, issueDelivery, DeliveryRefusal } from '../../../../../../../services/document-delivery';
import { bundleResponse, deliveryDependencies, deliveryFailure } from '../../../../../_lib/document-delivery';
import { authorizePrincipal } from '../../../../../_lib/authorize';
import { createRequestId } from '../../../../../_lib/request-id';
export const runtime = 'nodejs';
export const maxDuration = 300;
type Context = {params: Promise<{clientId: string; bundleId: string}>};
export async function GET(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    if (!await authorizePrincipal(request)) throw new DeliveryRefusal('unauthorized', 401);
    const {clientId, bundleId} = await context.params;
    const deps = deliveryDependencies();
    const bundle = await deps.platform.getDeliveryBundle(bundleId);
    if (!bundle || bundle.clientId !== clientId) throw new DeliveryRefusal('delivery_not_found', 404);
    const bytes = await deliveryBytes(deps.artifacts, bundle.artifactUrl, bundle.sha256);
    return new Response(new Uint8Array(bytes), {headers: {'content-type': 'application/zip', 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="delivery-${bundle.id}.zip"`, 'x-request-id': requestId}});
  } catch (error) { return deliveryFailure(error, requestId); }
}
const actionSchema = z.object({action: z.enum(['issue', 'revoke'])}).strict();
export async function POST(request: Request, context: Context) {
  const requestId = createRequestId();
  try {
    const actor = await authorizePrincipal(request);
    if (!actor) throw new DeliveryRefusal('unauthorized', 401);
    if (actor.kind !== 'operator') throw new DeliveryRefusal('operator_required', 403);
    const input = actionSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new DeliveryRefusal('invalid_request_body', 400);
    const {clientId, bundleId} = await context.params;
    const deps = deliveryDependencies();
    const bundle = await deps.platform.getDeliveryBundle(bundleId);
    if (!bundle || bundle.clientId !== clientId) throw new DeliveryRefusal('delivery_not_found', 404);
    if (input.data.action === 'issue') {
      return Response.json({bundle: bundleResponse(await issueDelivery(deps, bundle, actor)), requestId});
    }
    await deps.platform.revokeDeliveryBundle(bundleId, new Date().toISOString());
    await deps.platform.recordEvent({clientId, actor: actor.name, actorOperatorId: actor.id, action: 'delivery.revoked', subject: bundleId});
    return Response.json({bundle: bundleResponse((await deps.platform.getDeliveryBundle(bundleId))!), requestId});
  } catch (error) { return deliveryFailure(error, requestId); }
}
