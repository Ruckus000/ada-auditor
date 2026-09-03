import { z } from 'zod';

import { isWordDocument, logSafe } from '../../../../domain/document-remediation';
import { resolveLibreOffice } from '../../../../integrations/documents/libreoffice-runtime';
import { resolveJavaRuntime } from '../../../../integrations/documents/java-runtime';
import { hostnameOf } from '../../../../services/safe-url';
import { logInfo } from '../../../../services/logger';
import { authorizePrincipal } from '../../_lib/authorize';
import { documentBudgetRefusal } from '../../_lib/document-budget';
import { fetchDocumentBytes } from '../../_lib/document-fetch';
import { remediateWordBytes, remediationResponse } from '../../_lib/document-conversion';
import { refusalResponse } from '../../_lib/document-upload';
import { createRequestId } from '../../_lib/request-id';

/**
 * Remediate a Word document where it lives, by URL.
 *
 * The upload route serves a document an operator already has; this serves the
 * ones discovery finds on a client's site — which is most of them, and the
 * reason the capability exists. Same pipeline, same summary, same rules.
 *
 * The guarded fetch lives in `_lib/document-fetch.ts`, shared with the
 * inspection routes; the conversion core in `_lib/document-conversion.ts`,
 * shared with the upload route. Two copies of either is how one ends up
 * weaker, and the weaker one is the one that gets found.
 *
 * An authenticated operator can make this server fetch an arbitrary public
 * URL. That is not new power — `/api/platform/discover` navigates a full
 * browser to arbitrary public URLs under the same auth.
 *
 * ## Where this runs
 *
 * Where the toolchain is: a JVM and LibreOffice. A serverless function has no
 * LibreOffice, so this route answers **503** there — before fetching anything,
 * because there is no point pulling a document this host cannot convert. The
 * screen learns the same fact up front from `GET /api/documents/remediate`.
 *
 * ## Logs
 *
 * The hostname only, never the full URL. Municipal document paths routinely
 * name people, and a log line persists and travels. The response's
 * `content-disposition` name is generated for the same reason.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

const bodySchema = z
  .object({
    url: z
      .string()
      .max(2048)
      .pipe(z.url({ protocol: /^https?$/ })),
  })
  .strict();

const WORD_ACCEPT_HEADER =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,*/*';

export async function POST(request: Request) {
  const requestId = createRequestId();

  if (!(await authorizePrincipal(request))) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  // Before the toolchain probe and the fetch: a caller past the ceiling costs
  // this function nothing but the answer.
  const capped = await documentBudgetRefusal(requestId);
  if (capped) return refusalResponse(capped, requestId);

  // Both halves named separately, because the fixes differ: install
  // LibreOffice, or install a JDK. Checked before the fetch — no point
  // pulling a document this host cannot convert.
  const soffice = resolveLibreOffice();
  if (!soffice.available) {
    return Response.json(
      { error: 'converter_unavailable', detail: soffice.reason, requestId },
      { status: 503 },
    );
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

  const fetched = await fetchDocumentBytes(url, requestId, {
    accept: isWordDocument,
    acceptHeader: WORD_ACCEPT_HEADER,
  });
  if (!fetched.ok) {
    return refusalResponse(fetched.refusal, requestId);
  }

  const outcome = await remediateWordBytes(fetched.bytes, fetched.kind, requestId, {
    // The URL's last segment is the author-published name of this document.
    sourceName: decodeURIComponent(new URL(url).pathname.split('/').pop() ?? ''),
    javaRuntime: java,
    runtime: soffice,
  });
  if (!outcome.ok) {
    return refusalResponse(outcome.refusal, requestId);
  }

  logInfo('document_remediated', {
    requestId,
    host: hostnameOf(url),
    ...logSafe(outcome.summary),
  });

  return remediationResponse({ pdf: outcome.pdf, summary: outcome.summary, requestId });
}
