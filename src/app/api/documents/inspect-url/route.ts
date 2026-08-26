import { z } from 'zod';

import { logSafe } from '../../../../domain/document-remediation';
import { resolveJavaRuntime } from '../../../../integrations/documents/java-runtime';
import { hostnameOf } from '../../../../services/safe-url';
import { logInfo } from '../../../../services/logger';
import { authorizePrincipal } from '../../_lib/authorize';
import { fetchAndInspectDocumentUrl } from '../../_lib/document-inspection';
import { refusalResponse } from '../../_lib/document-upload';
import { createRequestId } from '../../_lib/request-id';

/**
 * Inspect a document where it lives, by URL.
 *
 * The upload route serves a document an operator already has; this serves the
 * ones discovery finds on a client's site — which is most of them, and the
 * reason the capability exists. Same instrument, same summary, same rules.
 *
 * The fetch-guard-inspect sequence lives in `_lib/document-inspection.ts`,
 * shared with the client-scoped persisting route: two copies of an SSRF guard
 * is how one ends up weaker, and the weaker one is the one that gets found.
 * Its header records what guards the fetch and what honestly does not —
 * including the residual DNS-rebinding window a plain `fetch` cannot close.
 *
 * An authenticated operator can make this server fetch an arbitrary public
 * URL. That is not new power — `/api/platform/discover` navigates a full
 * browser to arbitrary public URLs under the same auth.
 *
 * ## Logs
 *
 * The hostname only, never the full URL. Municipal document paths routinely
 * name people (`/minutes/objection-of-j-doe.pdf`), and a log line persists and
 * travels. The response echoes the URL — the caller supplied it.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z
  .object({
    url: z
      .string()
      .max(2048)
      .pipe(z.url({ protocol: /^https?$/ })),
  })
  .strict();

export async function POST(request: Request) {
  const requestId = createRequestId();

  if (!(await authorizePrincipal(request))) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const java = resolveJavaRuntime();
  if (!java.available) {
    return Response.json(
      { error: 'document_toolchain_unavailable', detail: java.reason, requestId },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'expected_json_body', requestId }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_url', detail: parsed.error.issues[0]?.message, requestId },
      { status: 400 },
    );
  }
  const url = parsed.data.url;

  const outcome = await fetchAndInspectDocumentUrl(url, requestId);
  if (!outcome.ok) {
    return refusalResponse(outcome.refusal, requestId);
  }

  logInfo('document_inspected', {
    requestId,
    host: hostnameOf(url),
    ...logSafe(outcome.summary),
  });

  return Response.json({ requestId, url, ...outcome.summary });
}
