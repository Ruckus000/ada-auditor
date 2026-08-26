import { isPdf, logSafe } from '../../../../domain/document-remediation';
import { resolveJavaRuntime } from '../../../../integrations/documents/java-runtime';
import { logInfo } from '../../../../services/logger';
import { inspectPdfBytes } from '../../_lib/document-inspection';
import { readDocumentUpload, refusalResponse } from '../../_lib/document-upload';
import { createRequestId } from '../../_lib/request-id';

/**
 * Report what a PDF's structure actually contains, and what it is missing.
 *
 * **This writes nothing.** It reads a document and answers with counts,
 * outcomes and the gaps a human still has to close, each naming its WCAG
 * criterion. Nothing is claimed, nothing is repaired, and no bytes go back.
 * The client-scoped route (`PUT /api/platform/clients/<id>/documents`) is the
 * one that persists; this stays the client-unscoped instrument.
 *
 * ## Why this one runs on Vercel when the converter does not
 *
 * The pipeline needs two runtimes and they are not the same problem. Measured:
 * a `jlink`-assembled Java runtime is **40MB** and LibreOffice is **794MB**.
 * Only the first fits beside a function, and reading a PDF needs only the
 * first. `scripts/prepare-jvm.ts` assembles it during a Vercel build.
 *
 * `[V]` Proven on a preview deployment rather than assumed: the runtime ships
 * (`/var/task/vendor/jre`), it execs, and `Inspect` returns correct results in
 * ~730ms warm. `next.config.mjs` carries the tracing entry that puts it there,
 * and `tests/deploy/browser-routes-are-packaged.test.ts` fails if a route that
 * spawns a JVM ever loses it.
 *
 * ## Why not the repair stages too
 *
 * `Finish` closes veraPDF `6.2-1`, `7.1-8`, `7.1-10` and `7.2-34`, and only the
 * last maps to a WCAG criterion. The blockers on real documents are 1.1.1 (alt
 * text) and 2.4.2 (title), and it can touch neither on a PDF — it copies a
 * title from DocInfo, and the documents blocked on a title do not have one.
 * Shipping it would produce a file that scores better on machine checks and is
 * no more accessible, which is the "98% of machine-checkable failures removed
 * is not 98% of the work" trap this project already named.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const requestId = createRequestId();

  const upload = await readDocumentUpload(request, {
    accept: isPdf,
    // Only the JVM. This route never converts, so LibreOffice being absent —
    // which it always is on a deployment — must not stop it.
    requires: [{ error: 'document_toolchain_unavailable', check: () => resolveJavaRuntime() }],
  });

  if (!upload.ok) {
    return refusalResponse(upload.refusal, requestId);
  }

  // The upload's own filename never reaches the filesystem: it is
  // attacker-controlled, and a request id plus a known extension is all a temp
  // path needs. `inspectPdfBytes` is the shared core that keeps that true for
  // every route that touches document bytes.
  const outcome = await inspectPdfBytes(upload.bytes, requestId);
  if (!outcome.ok) {
    return refusalResponse(outcome.refusal, requestId);
  }

  // Counts and outcomes only. `DocumentStructure` carries the document's own
  // words — headings, reading order, every table cell — and these are
  // municipal records naming real people. `logSafe` drops even the title,
  // which the response may echo because the caller supplied the file.
  logInfo('document_inspected', { requestId, ...logSafe(outcome.summary) });

  return Response.json({ requestId, ...outcome.summary });
}
