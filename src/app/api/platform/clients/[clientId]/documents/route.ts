import { z } from 'zod';

import { isPdf, logSafe } from '../../../../../../domain/document-remediation';
import type { StoredDocumentInspection } from '../../../../../../domain/platform';
import { resolveJavaRuntime } from '../../../../../../integrations/documents/java-runtime';
import { getPlatformStore } from '../../../../../../integrations/persistence';
import { hostnameOf } from '../../../../../../services/safe-url';
import { logInfo } from '../../../../../../services/logger';
import { authorizePrincipal } from '../../../../_lib/authorize';
import {
  fetchAndInspectDocumentUrl,
  inspectPdfBytes,
} from '../../../../_lib/document-inspection';
import { readDocumentUpload, refusalResponse } from '../../../../_lib/document-upload';
import { createRequestId } from '../../../../_lib/request-id';

/**
 * A client's document inspections: read them back, or make one that persists.
 *
 * `/api/documents/inspect-url` and `/api/documents/inspect` stay the
 * client-unscoped instruments — same inspection, nothing stored. These are the
 * variants an operator working a client's Documents screen uses, because an
 * inspection worth a fetch and a JVM run is worth keeping: before this route
 * the result lived exactly as long as the browser tab.
 *
 * - **GET** lists the stored inspections, newest first, capped by the store.
 * - **POST** `{ url, foundOn? }` fetches and inspects a document a crawl
 *   found, then persists it with `source: 'crawl'`. The fetch-guard-inspect
 *   core is `_lib/document-inspection.ts`, shared with `inspect-url` so the
 *   SSRF guard cannot fork.
 * - **PUT** (multipart, a `file` part) inspects a PDF the operator already
 *   has and persists it with `source: 'upload'`. PUT rather than a second
 *   POST because one path owns a client's documents and the verb is what
 *   distinguishes the byte-carrying variant.
 *
 * A failed inspection persists nothing: the store holds what the instrument
 * said, and a refusal is the instrument saying nothing.
 *
 * ## Logs
 *
 * The hostname for a crawl record, no URL at all for an upload, and
 * `logSafe(summary)` always — the database may hold `titleText` and the
 * operator's filename; a log line may hold neither.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * How much of an upload's filename is kept. The name is display-only — it
 * never reaches the filesystem — so trimming a pathological one is a storage
 * courtesy, not a security boundary.
 */
const MAX_UPLOAD_NAME = 256;

const inspectUrlSchema = z
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

/**
 * Field by field rather than spreading the stored row, per the lesson
 * `journeyResponse` records: a response built by spreading publishes every
 * column somebody adds later. `clientId` is omitted — it is in the URL the
 * caller just used.
 */
function inspectionResponse(record: StoredDocumentInspection) {
  return {
    id: record.id,
    url: record.url,
    ...(record.foundOn === undefined ? {} : { foundOn: record.foundOn }),
    source: record.source,
    summary: record.summary,
    inspectedAt: record.inspectedAt,
  };
}

export async function GET(
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

  const inspections = await platform.listDocumentInspections(clientId);

  return Response.json(
    {
      requestId,
      inspections: inspections.map(inspectionResponse),
      count: inspections.length,
    },
    { status: 200 },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const requestId = createRequestId();

  if (!(await authorizePrincipal(request))) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  // Before the body, matching `inspect-url`: there is no point parsing a
  // request this host cannot serve, and the fix — install a toolchain — has
  // nothing to do with what was sent.
  const java = resolveJavaRuntime();
  if (!java.available) {
    return Response.json(
      { error: 'document_toolchain_unavailable', detail: java.reason, requestId },
      { status: 503 },
    );
  }

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

  const parsed = inspectUrlSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }

  const outcome = await fetchAndInspectDocumentUrl(parsed.data.url, requestId);
  if (!outcome.ok) {
    // Nothing persisted: a refusal is the instrument saying nothing.
    return refusalResponse(outcome.refusal, requestId);
  }

  const record: StoredDocumentInspection = {
    id: requestId,
    clientId,
    url: parsed.data.url,
    ...(parsed.data.foundOn === undefined ? {} : { foundOn: parsed.data.foundOn }),
    source: 'crawl',
    summary: outcome.summary,
    inspectedAt: new Date().toISOString(),
  };
  await platform.saveDocumentInspection(record);

  logInfo('document_inspected', {
    requestId,
    clientId,
    host: hostnameOf(parsed.data.url),
    ...logSafe(outcome.summary),
  });

  return Response.json({ requestId, inspection: inspectionResponse(record) }, { status: 201 });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const requestId = createRequestId();

  // `readDocumentUpload` authorises too, but the client check has to sit
  // between authorisation and the body — an unknown client must answer 404
  // before this process buffers 25MB for it.
  if (!(await authorizePrincipal(request))) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId } = await params;
  const platform = getPlatformStore();

  if (!(await platform.getClient(clientId))) {
    return Response.json({ error: 'client_not_found', requestId }, { status: 404 });
  }

  const upload = await readDocumentUpload(request, {
    accept: isPdf,
    // Only the JVM, as in `/api/documents/inspect`: this route never converts.
    requires: [{ error: 'document_toolchain_unavailable', check: () => resolveJavaRuntime() }],
  });

  if (!upload.ok) {
    return refusalResponse(upload.refusal, requestId);
  }

  const outcome = await inspectPdfBytes(upload.bytes, requestId);
  if (!outcome.ok) {
    return refusalResponse(outcome.refusal, requestId);
  }

  // The filename is the only handle an upload has, so the record keeps it —
  // in `url`, the same column a crawl record's address lives in. It is
  // caller-controlled: fine to store (the database holds client DOM snippets
  // in `findings`), never to log, and it never reached the filesystem — the
  // temp file inside `inspectPdfBytes` is named by the request id.
  const name = upload.filename.trim().slice(0, MAX_UPLOAD_NAME) || 'upload.pdf';

  const record: StoredDocumentInspection = {
    id: requestId,
    clientId,
    url: name,
    source: 'upload',
    summary: outcome.summary,
    inspectedAt: new Date().toISOString(),
  };
  await platform.saveDocumentInspection(record);

  // No host and no name: an upload has no URL, and the filename is as much a
  // path as a path is.
  logInfo('document_inspected', { requestId, clientId, ...logSafe(outcome.summary) });

  return Response.json({ requestId, inspection: inspectionResponse(record) }, { status: 201 });
}
