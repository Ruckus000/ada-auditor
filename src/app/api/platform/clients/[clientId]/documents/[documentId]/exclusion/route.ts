import { z } from 'zod';
import { deliveryOverview, DeliveryRefusal } from '../../../../../../../../services/document-delivery';
import { deliveryDependencies, deliveryFailure } from '../../../../../../_lib/document-delivery';
import { authorizePrincipal } from '../../../../../../_lib/authorize';
import { createRequestId } from '../../../../../../_lib/request-id';
export const runtime = 'nodejs';
export const maxDuration = 300;
const bodySchema = z.union([z.object({reason: z.string().trim().min(1).max(2000)}).strict(), z.object({reverse: z.literal(true)}).strict()]);
export async function POST(request: Request, {params}: {params: Promise<{clientId: string; documentId: string}>}) {
  const requestId = createRequestId();
  try {
    const actor = await authorizePrincipal(request);
    if (!actor) throw new DeliveryRefusal('unauthorized', 401);
    if (actor.kind !== 'operator') throw new DeliveryRefusal('operator_required', 403);
    const input = bodySchema.safeParse(await request.json().catch(() => null));
    if (!input.success) throw new DeliveryRefusal('invalid_request_body', 400);
    const {clientId, documentId} = await params;
    const deps = deliveryDependencies();
    const view = await deliveryOverview(deps.platform, clientId);
    const row = view.rows.find(r => r.record.id === documentId);
    if (!row) throw new DeliveryRefusal('document_not_found', 404);
    const at = new Date().toISOString();
    const record = 'reverse' in input.data
      ? row.exclusion && {...row.exclusion, reversedAt: at}
      : {documentId, reason: input.data.reason, actor: actor.name, operatorId: actor.id, at};
    if (!record) throw new DeliveryRefusal('exclusion_not_found', 404);
    if (!await deps.platform.saveDocumentExclusion(clientId, record, view.revision)) throw new DeliveryRefusal('document_changed');
    await deps.platform.recordEvent({clientId, actor: actor.name, actorOperatorId: actor.id,
      action: 'reverse' in input.data ? 'document.exclusion-reversed' : 'document.excluded', subject: documentId});
    return Response.json({exclusion: record, requestId});
  } catch (error) { return deliveryFailure(error, requestId); }
}
