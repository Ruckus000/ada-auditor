import { createHash } from 'node:crypto';
import { z } from 'zod';

import { isWordDocument, logSafe } from '../../../../../../../domain/document-remediation';
import type { StoredDocumentConversion } from '../../../../../../../domain/platform';
import { resolveLibreOffice } from '../../../../../../../integrations/documents/libreoffice-runtime';
import { resolveJavaRuntime } from '../../../../../../../integrations/documents/java-runtime';
import { getPlatformStore } from '../../../../../../../integrations/persistence';
import { hostnameOf } from '../../../../../../../services/safe-url';
import { logInfo } from '../../../../../../../services/logger';
import { authorizePrincipal } from '../../../../../_lib/authorize';
import { fetchDocumentBytes } from '../../../../../_lib/document-fetch';
import {
  remediateWordBytes,
  remediationResponse,
} from '../../../../../_lib/document-conversion';
import { readDocumentUpload, refusalResponse } from '../../../../../_lib/document-upload';
import { createRequestId } from '../../../../../_lib/request-id';

/**
 * Convert a client's Word document to tagged PDF — and remember doing it.
 *
 * The client-scoped sibling of `/api/documents/remediate-url` (POST, by URL)
 * and `/api/documents/remediate` (PUT, upload), built from the same shared
 * cores: `_lib/document-fetch.ts` guards the fetch, `_lib/document-conversion`
 * runs the pipeline and shapes the response. What this route adds is the
 * audit trail: a `document_conversions` row holding the pipeline's account
 * and the SHA-256 of the bytes in and the bytes out — so "the file we
 * delivered is exactly the file this row describes" is checkable by anyone
 * holding the file, without the store ever holding document bytes. The
 * document's inventory row is ensured on the way, so a conversion is never
 * an orphaned record.
 *
 * A failed conversion persists nothing — not even a document row — for the
 * same reason a failed inspection doesn't.
 *
 * Capability is still asked of `GET /api/documents/remediate`: the answer is
 * a property of the host, not of the client.
 *
 * ## Logs
 *
 * The hostname for a by-URL conversion, nothing for an upload, `logSafe`
 * always. The response's `content-disposition` name is generated.
 */
export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_UPLOAD_NAME = 256;

const convertUrlSchema = z
  .object({
    url: z
      .string()
      .max(2048)
      .pipe(z.url({ protocol: /^https?$/ })),
    foundOn: z
      .string()
      .max(2048)
      .pipe(z.url({ protocol: /^https?$/ }))
      .optional(),
  })
  .strict();

const WORD_ACCEPT_HEADER =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,*/*';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Both halves named separately, because the fixes differ. */
function refuseWithoutToolchain(requestId: string): Response | null {
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
  return null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const requestId = createRequestId();

  if (!(await authorizePrincipal(request))) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  // Before the fetch — no point pulling a document this host cannot convert.
  const refused = refuseWithoutToolchain(requestId);
  if (refused) return refused;

  const { clientId } = await params;
  const platform = getPlatformStore();

  if (!(await platform.getClient(clientId))) {
    return Response.json({ error: 'client_not_found', requestId }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'expected_json_body', requestId }, { status: 400 });
  }

  const parsed = convertUrlSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }
  const url = parsed.data.url;

  const fetched = await fetchDocumentBytes(url, requestId, {
    accept: isWordDocument,
    acceptHeader: WORD_ACCEPT_HEADER,
  });
  if (!fetched.ok) {
    return refusalResponse(fetched.refusal, requestId);
  }

  const outcome = await remediateWordBytes(fetched.bytes, fetched.kind, requestId);
  if (!outcome.ok) {
    return refusalResponse(outcome.refusal, requestId);
  }

  const now = new Date().toISOString();
  const document = await platform.ensureClientDocument(
    clientId,
    {
      url,
      // The byte check's verdict, not the extension's — the bytes are in
      // hand, and `isWordDocument` admits exactly these two containers.
      kind: fetched.kind === 'doc' ? 'doc' : 'docx',
      source: 'crawl',
      ...(parsed.data.foundOn === undefined ? {} : { foundOn: parsed.data.foundOn }),
    },
    now,
  );

  const record: StoredDocumentConversion = {
    id: requestId,
    clientId,
    documentId: document.id,
    summary: outcome.summary,
    inputSha256: sha256(fetched.bytes),
    outputSha256: sha256(outcome.pdf),
    convertedAt: now,
  };
  await platform.saveDocumentConversion(record);

  logInfo('document_converted', {
    requestId,
    clientId,
    host: hostnameOf(url),
    ...logSafe(outcome.summary),
  });

  return remediationResponse({ pdf: outcome.pdf, summary: outcome.summary, requestId });
}

export async function PUT(
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

  const upload = await readDocumentUpload(request, {
    accept: isWordDocument,
    requires: [
      { error: 'converter_unavailable', check: () => resolveLibreOffice() },
      { error: 'document_toolchain_unavailable', check: () => resolveJavaRuntime() },
    ],
  });

  if (!upload.ok) {
    return refusalResponse(upload.refusal, requestId);
  }

  const outcome = await remediateWordBytes(upload.bytes, upload.kind, requestId);
  if (!outcome.ok) {
    return refusalResponse(outcome.refusal, requestId);
  }

  const name = upload.filename.trim().slice(0, MAX_UPLOAD_NAME) || 'upload.docx';

  const now = new Date().toISOString();
  const document = await platform.ensureClientDocument(
    clientId,
    { url: name, kind: upload.kind === 'doc' ? 'doc' : 'docx', source: 'upload' },
    now,
  );

  const record: StoredDocumentConversion = {
    id: requestId,
    clientId,
    documentId: document.id,
    summary: outcome.summary,
    inputSha256: sha256(upload.bytes),
    outputSha256: sha256(outcome.pdf),
    convertedAt: now,
  };
  await platform.saveDocumentConversion(record);

  // No host and no name: an upload has no URL, and the filename is as much a
  // path as a path is.
  logInfo('document_converted', { requestId, clientId, ...logSafe(outcome.summary) });

  return remediationResponse({ pdf: outcome.pdf, summary: outcome.summary, requestId });
}
