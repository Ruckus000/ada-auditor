import { isWordDocument, logSafe } from '../../../../domain/document-remediation';
import { readDocumentUpload, refusalResponse } from '../../_lib/document-upload';
import { remediateWordBytes, remediationResponse } from '../../_lib/document-conversion';
import { resolveLibreOffice } from '../../../../integrations/documents/libreoffice-runtime';
import { resolveJavaRuntime } from '../../../../integrations/documents/java-runtime';
import { authorizePrincipal } from '../../_lib/authorize';
import { logInfo } from '../../../../services/logger';
import { createRequestId } from '../../_lib/request-id';

/**
 * Remediate one Word document.
 *
 * The first thing in the product that can invoke the document pipeline. Until
 * now three stages ran from `src/` under the gates and nothing could call them,
 * which is the difference between a capability and a feature.
 *
 * Synchronous on purpose. A conversion measures ~15s against a 300s ceiling, so
 * a job model would be machinery around a problem this does not have. When
 * retrieval is needed — a client-facing flow, an audit trail — the shape will be
 * known rather than guessed, and the response contract below will change. That
 * is a decision for then, recorded here so it is not a surprise.
 *
 * ## Where this runs
 *
 * Where the toolchain is: a JVM and LibreOffice. A serverless function has
 * neither, so this route answers **503** there — not 500. A deployment without
 * LibreOffice is not broken; it cannot do this one thing.
 *
 * ## GET: can this host convert at all?
 *
 * The screen that offers a Convert button needs the answer *before* an
 * operator clicks, and no other surface can give it honestly: on Vercel every
 * route is its own function, so `/api/ready` answers for its own instance, not
 * this one. A GET on the same route file is served by the same function as the
 * POST, so its answer is true for the instance that would do the converting.
 * (`/api/documents/remediate-url` is a separate function, but conversion needs
 * LibreOffice, which no deployment bundles anywhere — the answer cannot differ
 * between them.)
 */

// Spawns LibreOffice and a JVM. Neither is bundled — they are host binaries —
// so this needs no `outputFileTracingIncludes` entry, unlike the browser routes.
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request) {
  const requestId = createRequestId();

  if (!(await authorizePrincipal(request))) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const soffice = resolveLibreOffice();
  const java = resolveJavaRuntime();

  if (soffice.available && java.available) {
    return Response.json({ requestId, available: true });
  }

  // Each missing half named, because the fixes differ: install LibreOffice,
  // or install a JDK.
  const reasons = [
    ...(soffice.available ? [] : [soffice.reason]),
    ...(java.available ? [] : [java.reason]),
  ];
  return Response.json({ requestId, available: false, reason: reasons.join('; ') });
}

export async function POST(request: Request) {
  const requestId = createRequestId();

  // Shared with `/api/documents/inspect`, deliberately. Two upload endpoints
  // with two validations is how one of them ends up weaker, and the weaker one
  // is the one that gets found. `readDocumentUpload` owns the order that
  // matters: authorise before buffering, cheap length check, toolchain, real
  // size, then container shape.
  const upload = await readDocumentUpload(request, {
    accept: isWordDocument,
    // Both halves named separately, because the fixes differ: install
    // LibreOffice, or install a JDK.
    requires: [
      { error: 'converter_unavailable', check: () => resolveLibreOffice() },
      { error: 'document_toolchain_unavailable', check: () => resolveJavaRuntime() },
    ],
  });

  if (!upload.ok) {
    return refusalResponse(upload.refusal, requestId);
  }

  const soffice = resolveLibreOffice();
  const java = resolveJavaRuntime();
  if (!soffice.available || !java.available) {
    // Unreachable: `requires` above already refused this. Present so the
    // narrowing below is real rather than asserted.
    return refusalResponse({ status: 503, error: 'document_toolchain_unavailable' }, requestId);
  }

  // The upload's own filename never reaches the filesystem — the shared core
  // names the temp files by request id, which is all a temp path needs.
  const outcome = await remediateWordBytes(upload.bytes, upload.kind, requestId, {
    // The client-facing name, for filename-derived titles; the temp path the
    // converter sees is a requestId and says nothing.
    sourceName: upload.filename,
    javaRuntime: java,
    runtime: soffice,
  });

  if (!outcome.ok) {
    return refusalResponse(outcome.refusal, requestId);
  }

  // Counts and outcomes only. `DocumentStructure` carries the document's own
  // words — headings, reading order, every table cell — and these are
  // municipal records naming real people. A log line persists and travels;
  // `logSafe` drops even the title, which the response is allowed to echo
  // because the caller supplied the file.
  logInfo('document_remediated', { requestId, ...logSafe(outcome.summary) });

  return remediationResponse({ pdf: outcome.pdf, summary: outcome.summary, requestId });
}
