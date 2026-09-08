import { z } from 'zod';
import { signDocument, DeliveryRefusal } from '../../../../../../../../services/document-delivery';
import { deliveryDependencies, deliveryFailure } from '../../../../../../_lib/document-delivery';
import { authorizePrincipal } from '../../../../../../_lib/authorize';
import { createRequestId } from '../../../../../../_lib/request-id';
export const runtime = 'nodejs';
export const maxDuration = 300;
const bodySchema = z.object({note: z.string().trim().max(2000).optional()}).strict();
export async function POST(request: Request, {params}: {params: Promise<{clientId: string; documentId: string}>}) {
  const requestId = createRequestId();
  try {
    const actor = await authorizePrincipal(request);
    if (!actor) throw new DeliveryRefusal('unauthorized', 401);
    if (actor.kind !== 'operator') throw new DeliveryRefusal('operator_required', 403);
    const input = bodySchema.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new DeliveryRefusal('invalid_request_body', 400);
    const {clientId, documentId} = await params;
    const signed = await signDocument(deliveryDependencies(), clientId, documentId, actor, input.data.note);
    return Response.json({signoff: {id: signed.id, documentId, actor: signed.actor, signedAt: signed.signedAt}, requestId});
  } catch (error) { return deliveryFailure(error, requestId); }
}
