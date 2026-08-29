import { z } from 'zod';
import { getPlatformStore } from '../../../../integrations/persistence';
import { logInfo } from '../../../../services/logger';
import { isSameOriginConsoleRequest } from '../../_lib/same-origin';
import { createRequestId } from '../../_lib/request-id';
import { requireOperator } from './_lib/shared';

/**
 * Listing and removing an operator's own passkeys.
 *
 * Neither goes through `passkeyContext`: these manage rows that already exist,
 * so they work whether or not the relying party is configured — an operator
 * who has passkeys and then loses the config must still be able to see and
 * delete them. They need only a session, and the writes need same-origin.
 *
 * `publicKey` is never returned. It is not a secret, but a management screen
 * has no use for it and the smallest response that does the job is the one
 * that cannot leak anything later.
 */

export async function GET(request: Request) {
  const requestId = createRequestId();

  const principal = await requireOperator(request);
  if (!principal || principal.kind !== 'operator') {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const passkeys = await getPlatformStore().listOperatorPasskeys(principal.id);

  return Response.json(
    {
      requestId,
      passkeys: passkeys.map((passkey) => ({
        credentialId: passkey.credentialId,
        label: passkey.label,
        createdAt: passkey.createdAt,
        ...(passkey.lastUsedAt ? { lastUsedAt: passkey.lastUsedAt } : {}),
      })),
    },
    { status: 200 },
  );
}

const deleteSchema = z.object({ credentialId: z.string().min(1).max(512) });

export async function DELETE(request: Request) {
  const requestId = createRequestId();

  if (!isSameOriginConsoleRequest(request)) {
    return Response.json({ error: 'console_same_origin_required', requestId }, { status: 403 });
  }

  const principal = await requireOperator(request);
  if (!principal || principal.kind !== 'operator') {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request', requestId }, { status: 400 });
  }

  // Scoped by operator in the query itself, so removing someone else's
  // credential is not a thing this endpoint can be talked into doing. A
  // credential that was not theirs simply deletes nothing, and the response
  // does not distinguish the cases — that would answer "does this id exist?".
  await getPlatformStore().deleteOperatorPasskey(
    principal.id,
    parsed.data.credentialId,
  );
  logInfo('passkey_removed', { operatorId: principal.id, requestId });

  return Response.json({ requestId, removed: true }, { status: 200 });
}
