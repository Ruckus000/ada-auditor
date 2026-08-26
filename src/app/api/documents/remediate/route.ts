import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isWordDocument,
  logSafe,
  summarise,
  type RemediationSummary,
} from '../../../../domain/document-remediation';
import { readDocumentUpload, refusalResponse } from '../../_lib/document-upload';
import { convertSourceToPdf } from '../../../../integrations/documents/convert';
import { resolveLibreOffice } from '../../../../integrations/documents/libreoffice-runtime';
import { resolveJavaRuntime } from '../../../../integrations/documents/java-runtime';
import { logInfo, logWarn } from '../../../../services/logger';
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
 */

// Spawns LibreOffice and a JVM. Neither is bundled — they are host binaries —
// so this needs no `outputFileTracingIncludes` entry, unlike the browser routes.
export const runtime = 'nodejs';
export const maxDuration = 300;

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

  const bytes = upload.bytes;
  const check = { kind: upload.kind };

  // The upload's own filename never reaches the filesystem. It is
  // attacker-controlled, and a request id plus a fixed extension is all a temp
  // path needs.
  const work = await mkdtemp(join(tmpdir(), 'ada-remediate-'));

  // Template literals rather than `join`, and that is not a style choice.
  // Turbopack hooks `path.join` looking for module paths, and a call whose
  // arguments it cannot resolve becomes a file *pattern*: `join(work,
  // `${id}.${kind}`)` compiled to a pattern matching 16,642 files across the
  // project, which made the build walk `.claude/worktrees/**` and fail on a
  // Python venv symlink pointing outside the project root.
  //
  // Safe to concatenate here because neither half needs normalising: `work` is
  // an absolute path straight from `mkdtemp`, and the filename is a generated
  // request id plus a known extension, with no separators in either.
  const source = `${work}/${requestId}.${check.kind}`;
  const output = `${work}/${requestId}.pdf`;

  try {
    await writeFile(source, bytes);

    const result = await convertSourceToPdf(source, output, {
      javaRuntime: java,
      runtime: soffice,
    });

    if (!result.ok) {
      logWarn('document_remediation_failed', { requestId, failure: result.failure.kind });
      return refusalResponse(
        { status: 422, error: 'remediation_failed', detail: result.failure.kind },
        requestId,
      );
    }

    const summary: RemediationSummary = summarise(result.provenance);

    // Counts and outcomes only. `DocumentStructure` carries the document's own
    // words — headings, reading order, every table cell — and these are
    // municipal records naming real people. A log line persists and travels;
    // `logSafe` drops even the title, which the response is allowed to echo
    // because the caller supplied the file.
    logInfo('document_remediated', { requestId, ...logSafe(summary) });

    const pdf = await readFile(output);

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        // A generated name, for the same reason the temp path is generated.
        'content-disposition': `attachment; filename="remediated-${requestId}.pdf"`,
        'x-remediation-summary': JSON.stringify(summary),
        'x-request-id': requestId,
      },
    });
  } finally {
    // Every path, including a refusal above and a throw inside the conversion.
    // `convertSourceToPdf` cleans its own working directory; this is ours.
    await rm(work, { recursive: true, force: true });
  }
}
