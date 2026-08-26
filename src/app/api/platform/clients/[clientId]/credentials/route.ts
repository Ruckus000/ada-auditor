import { getPlatformStore } from '../../../../../../integrations/persistence';
import { authorizePrincipal } from '../../../../_lib/authorize';
import { createRequestId } from '../../../../_lib/request-id';

/**
 * Which credentials are stored for this client. Presence only.
 *
 * The one read the credential surface has, and it is deliberately the least
 * it could be: ref, which fields are set, when it changed. No endpoint on
 * this surface returns a value — the store is write-only from the outside,
 * and the run path decrypts through `getClientCredentialValues`, which no
 * route calls.
 *
 * Works without `AUDITOR_CREDENTIAL_KEY` on purpose: presence is decided in
 * SQL without decrypting, and an operator whose deployment lost the key needs
 * this listing to know what to re-enter.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId } = await params;
  const platform = getPlatformStore();

  if (!(await platform.getClient(clientId))) {
    return Response.json({ error: 'client_not_found', requestId }, { status: 404 });
  }

  const credentials = await platform.listClientCredentialRefs(clientId);

  return Response.json({ requestId, credentials }, { status: 200 });
}
