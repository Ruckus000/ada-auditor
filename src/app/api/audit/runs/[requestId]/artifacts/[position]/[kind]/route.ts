import type { StoredArtifacts } from '../../../../../../../../domain/artifacts';
import { getArtifactStore } from '../../../../../../../../integrations/artifacts/blob-store';
import { getRunStore } from '../../../../../../../../integrations/persistence';
import { authorizePrincipal } from '../../../../../../_lib/authorize';
import { createRequestId } from '../../../../../../_lib/request-id';

/**
 * Serve one piece of a run's evidence.
 *
 * Evidence was write-only. Screenshots, DOM snapshots and accessibility trees
 * went to a private Blob store correctly, their URLs were recorded on the run,
 * and then nothing ever read them back — no route, no screen, no link. An
 * evidence-first product that cannot show you the evidence is only half a
 * claim.
 *
 * ## The database read is mandatory
 *
 * `upload` stores with `addRandomSuffix`, so the URL it produced is the only
 * handle that exists — it cannot be reconstructed from a requestId and a page.
 * That is a constraint, and it is also the security property: this route takes
 * a run id, a page position and a kind, and finds the URL itself. No
 * caller-supplied string reaches the fetch, so there is no request-forgery
 * surface here at all.
 *
 * ## Streamed, never redirected
 *
 * A redirect would hand the browser a URL that outlives the session and can be
 * forwarded out of band. These are screenshots of a client's *authenticated*
 * pages; the point of storing them privately is that possession of a link is
 * not authorisation.
 */

export const runtime = 'nodejs';

const KINDS = {
  screenshot: 'screenshotUrl',
  dom: 'domSnapshotUrl',
  axtree: 'axTreeUrl',
} as const satisfies Record<string, keyof StoredArtifacts>;

type Kind = keyof typeof KINDS;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ requestId: string; position: string; kind: string }> },
) {
  const traceId = createRequestId();

  // One organisation, so being authenticated *is* the authorization for
  // reading a run. Do not add ownership scoping here without changing the
  // product decision it follows from — every operator sees every client.
  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId: traceId }, { status: 401 });
  }

  const { requestId, position, kind } = await params;

  if (!(kind in KINDS)) {
    return Response.json({ error: 'unknown_artifact_kind', requestId: traceId }, { status: 404 });
  }

  const index = Number(position);
  if (!Number.isInteger(index) || index < 0) {
    return Response.json({ error: 'unknown_page', requestId: traceId }, { status: 404 });
  }

  const run = await getRunStore().getRun(requestId);
  const page = run?.pages?.[index];
  if (!run || !page) {
    return Response.json({ error: 'run_not_found', requestId: traceId }, { status: 404 });
  }

  const url = page.artifacts?.[KINDS[kind as Kind]];
  if (!url) {
    return Response.json({ error: 'artifact_not_captured', requestId: traceId }, { status: 404 });
  }

  const artifact = await getArtifactStore().read(url);
  if (artifact.status === 'pruned') {
    // 410, not 404. The run existed and its evidence aged out of the retention
    // window — `prune-artifacts` deletes blobs on a schedule, so this is the
    // system working. Reporting "not found" would send someone hunting a bug.
    return Response.json({ error: 'evidence_pruned', requestId: traceId }, { status: 410 });
  }

  /**
   * A DOM snapshot is markup captured from someone else's site.
   *
   * Served inline from our own origin it would execute there — stored XSS on
   * the auditor, using the client's own page as the payload. `attachment`
   * plus `nosniff` plus a sandbox CSP means the browser downloads it instead
   * of running it. Screenshots and JSON are safe to view inline.
   */
  const isMarkup = kind === 'dom';

  return new Response(artifact.body, {
    status: 200,
    headers: {
      'content-type': artifact.contentType,
      'content-disposition': isMarkup
        ? `attachment; filename="${requestId}-${index}.html"`
        : 'inline',
      'x-content-type-options': 'nosniff',
      'content-security-policy': 'sandbox',
      // Same as the PDF route: evidence must not sit in a shared cache.
      'cache-control': 'private, no-store',
    },
  });
}
