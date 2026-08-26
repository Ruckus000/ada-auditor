import { z } from 'zod';

import { discoveryRequestSchema } from '../../../../../../../domain/discovery';
import { getPlatformStore } from '../../../../../../../integrations/persistence';
import { logInfo } from '../../../../../../../services/logger';
import { authorizePrincipal } from '../../../../../_lib/authorize';
import { attemptDiscovery, discoveryResponseBody } from '../../../../../_lib/discovery';
import { createRequestId } from '../../../../../_lib/request-id';

/**
 * Scan a site for a client, and remember what was seen.
 *
 * The same crawl as `/api/platform/discover` — one implementation, in
 * `_lib/discovery.ts`, because the refusal mapping's branch order is
 * load-bearing — plus the half that route deliberately does not do: the
 * documents the crawl saw are MERGED into the client's inventory
 * (`client_documents`), so a scan builds on the last one instead of starting
 * from nothing. New URLs get rows; known URLs get `lastSeenAt` refreshed.
 *
 * The merge counts come back beside the crawl result: "42 documents" alone
 * cannot tell an operator whether a scan found anything new.
 *
 * Pages are returned but not persisted — page discovery remains an authoring
 * aid for journeys, and this route's inventory is documents.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const requestId = createRequestId();

  if (!(await authorizePrincipal(request))) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId } = await params;
  const platform = getPlatformStore();

  if (!(await platform.getClient(clientId))) {
    return Response.json({ error: 'client_not_found', requestId }, { status: 404 });
  }

  let parsed: z.infer<typeof discoveryRequestSchema>;
  try {
    parsed = discoveryRequestSchema.parse(await request.json());
  } catch {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }

  const attempt = await attemptDiscovery(parsed.targetUrl, requestId);
  if (!attempt.ok) {
    return attempt.response;
  }

  const merge = await platform.recordDocumentSightings(
    clientId,
    attempt.result.documents.map((doc) => ({
      url: doc.url,
      kind: doc.kind,
      source: 'crawl' as const,
      foundOn: doc.foundOn,
    })),
    new Date().toISOString(),
  );

  // Counts only — a document URL is a path, and paths name people.
  logInfo('client_documents_merged', {
    requestId,
    clientId,
    sighted: attempt.result.documents.length,
    ...merge,
  });

  return Response.json(
    { requestId, ...discoveryResponseBody(attempt.result), merge },
    { status: 200 },
  );
}
