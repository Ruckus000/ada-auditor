import { getArtifactStore } from '../../../../../../../../integrations/artifacts/blob-store';
import { getPlatformStore } from '../../../../../../../../integrations/persistence';
import { authorizePrincipal } from '../../../../../../_lib/authorize';
import { createRequestId } from '../../../../../../_lib/request-id';

/**
 * Re-download one stored converted document — the operator's copy of exactly
 * the file that was delivered.
 *
 * The bytes come out of the blob store through the server (`read` streams via
 * the token; the blob URL itself never crosses the wire), against the URL the
 * conversion record holds — never one a caller supplied. Ownership is the
 * `clientId` in the path against the record's own, same as every other
 * client-scoped read.
 *
 * 404 covers a conversion that does not exist and one that is not this
 * client's — distinguishing them tells a caller which ids exist. A conversion
 * whose file was never stored (no blob store at conversion time) answers 404
 * with its own code: the record is real, the file is honestly absent, and the
 * hashes still prove what it was.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientId: string; conversionId: string }> },
) {
  const requestId = createRequestId();

  if (!(await authorizePrincipal(request))) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId, conversionId } = await params;
  const platform = getPlatformStore();

  if (!(await platform.getClient(clientId))) {
    return Response.json({ error: 'client_not_found', requestId }, { status: 404 });
  }

  const conversion = await platform.getDocumentConversion(conversionId);
  if (!conversion || conversion.clientId !== clientId) {
    return Response.json({ error: 'conversion_not_found', requestId }, { status: 404 });
  }

  if (conversion.artifactUrl === undefined) {
    return Response.json({ error: 'artifact_not_stored', requestId }, { status: 404 });
  }

  const artifact = await getArtifactStore().read(conversion.artifactUrl);
  if (artifact.status !== 'ok') {
    // Never pruned by policy (`documents/` is outside the sweeper), so this
    // is a store-side surprise — but the honest answer is the same.
    return Response.json({ error: 'artifact_not_stored', requestId }, { status: 404 });
  }

  return new Response(artifact.body, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      // A generated name, same reason as the conversion response's own.
      'content-disposition': `attachment; filename="remediated-${conversionId}.pdf"`,
      'x-request-id': requestId,
    },
  });
}
