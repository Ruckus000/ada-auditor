import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isWordDocument,
  logSafe,
  summarise,
  type RemediationSummary,
} from '../../../../domain/document-remediation';
import { convertSourceToPdf } from '../../../../integrations/documents/convert';
import { resolveLibreOffice } from '../../../../integrations/documents/libreoffice-runtime';
import { resolveJavaRuntime } from '../../../../integrations/documents/java-runtime';
import { logInfo, logWarn } from '../../../../services/logger';
import { authorizePrincipal } from '../../_lib/authorize';
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

/** 25MB. A municipal agenda is tens of kilobytes; this is a ceiling. */
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

function maxBytes(): number {
  const raw = Number(process.env.AUDITOR_MAX_DOCUMENT_BYTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_BYTES;
}

function refuse(status: number, error: string, requestId: string, detail?: string) {
  return Response.json({ error, detail, requestId }, { status });
}

export async function POST(request: Request) {
  const requestId = createRequestId();

  // First, and before anything is buffered. An unauthenticated caller must not
  // be able to make this process hold 25MB of their choosing.
  const principal = await authorizePrincipal(request);
  if (!principal) {
    return refuse(401, 'unauthorized', requestId);
  }

  const limit = maxBytes();

  // `Content-Length` can lie, so this is the cheap rejection and not the real
  // one; the actual size is checked again once the body is in hand.
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    return refuse(413, 'document_too_large', requestId, `limit is ${limit} bytes`);
  }

  // Asked before reading the upload: there is no point buffering a document
  // this host cannot convert. Both halves are named separately because the
  // fixes are different — install a JDK, or install LibreOffice.
  const soffice = resolveLibreOffice();
  if (!soffice.available) {
    return refuse(503, 'converter_unavailable', requestId, soffice.reason);
  }
  const java = resolveJavaRuntime();
  if (!java.available) {
    return refuse(503, 'document_toolchain_unavailable', requestId, java.reason);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse(400, 'expected_multipart_form_data', requestId);
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return refuse(400, 'missing_file_field', requestId, 'expected a `file` part');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > limit) {
    return refuse(413, 'document_too_large', requestId, `limit is ${limit} bytes`);
  }

  // The converter cannot be trusted to reject this: `[V]` LibreOffice sniffs
  // content rather than trusting the extension, so a text file named `.docx`
  // converts successfully. A successful conversion is not evidence the input
  // was a Word document, so the gate is here.
  const check = isWordDocument(bytes);
  if (!check.ok) {
    return refuse(415, 'unsupported_document', requestId, check.reason);
  }

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
      return refuse(422, 'remediation_failed', requestId, result.failure.kind);
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
