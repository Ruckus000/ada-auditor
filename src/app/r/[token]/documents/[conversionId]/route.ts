import { getArtifactStore } from '../../../../../integrations/artifacts/blob-store';
import { getPlatformStore } from '../../../../../integrations/persistence';
import { createRequestId } from '../../../../api/_lib/request-id';

/**
 * The remediated file, from a shared report — delivery, behind the token.
 *
 * The report snapshot is what authorises this: the token resolves the report
 * (revocation kills it, exactly as it kills the page), and the requested
 * conversion must appear in THAT report's own pinned documents section. A
 * conversion id from some other client's report — or from this client after
 * revocation — answers 404 like everything else here, because telling an
 * unauthenticated holder of a URL which ids exist is information they have
 * not earned.
 *
 * The blob URL never crosses the wire: the record holds it, the server
 * streams through it.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; conversionId: string }> },
) {
  const requestId = createRequestId();
  const { token, conversionId } = await params;
  const platform = getPlatformStore();

  const report = await platform.getReportByToken(token);
  if (!report) {
    return Response.json({ error: 'not_found', requestId }, { status: 404 });
  }

  // The PINNED snapshot is the authorisation list: only conversions the
  // issued report itself offered are reachable through its token. A
  // conversion made after issue is not on the page and not through this door.
  const offered = report.documents?.entries.some(
    (entry) => entry.conversionId === conversionId,
  );
  if (!offered) {
    return Response.json({ error: 'not_found', requestId }, { status: 404 });
  }

  const conversion = await platform.getDocumentConversion(conversionId);
  if (!conversion || conversion.artifactUrl === undefined) {
    return Response.json({ error: 'not_found', requestId }, { status: 404 });
  }

  const artifact = await getArtifactStore().read(conversion.artifactUrl);
  if (artifact.status !== 'ok') {
    return Response.json({ error: 'not_found', requestId }, { status: 404 });
  }

  return new Response(artifact.body, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="remediated-${conversionId}.pdf"`,
      'x-request-id': requestId,
      /**
       * The page above this route says `noindex` through Next's `metadata`,
       * which emits a `<meta>` tag. A PDF cannot carry one, so the only way to
       * say it here is the header — and without it the one response in this
       * subtree that IS a client's document was the one crawlable thing behind
       * the token. `schema.sql` claimed this header already existed; it did not.
       */
      'x-robots-tag': 'noindex, nofollow',
      // Same as `report.pdf` and the artifacts route: a client's document is
      // fetched with a credential and must not be retained by anything between.
      'cache-control': 'private, no-store',
    },
  });
}
