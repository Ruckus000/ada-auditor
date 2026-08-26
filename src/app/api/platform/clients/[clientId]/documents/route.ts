import { z } from 'zod';

import { isPdf, logSafe } from '../../../../../../domain/document-remediation';
import { documentLinkKind } from '../../../../../../domain/discovery';
import type {
  ClientDocumentRecord,
  StoredDocumentConversion,
  StoredDocumentInspection,
} from '../../../../../../domain/platform';
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
 * A client's documents — the inventory, and the inspect actions that feed it.
 *
 * The entity here is `client_documents`: one row per document per client,
 * with a lifecycle (`firstSeenAt`/`lastSeenAt`) the crawl refreshes and the
 * latest inspection and conversion attached. Scans merge through the sibling
 * `documents/discover` route; conversions run through `documents/convert`.
 * `/api/documents/inspect*` stay the client-unscoped instruments.
 *
 * - **GET** lists the inventory: every document with the latest word on it,
 *   most recently seen first, capped by the store.
 * - **POST** `{ url, foundOn? }` fetches and inspects a document where it
 *   lives, then persists the reading against the document's row — creating
 *   the row if the inventory has never heard of the URL (a pasted address).
 * - **PUT** (multipart, a `file` part) inspects a PDF the operator already
 *   has, same persistence, `source: 'upload'`.
 *
 * A failed inspection persists nothing — not even a document row. The store
 * holds what the instrument said, a refusal is the instrument saying
 * nothing, and an inventory row minted for a URL that refused to fetch would
 * be a record of a typo.
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
    documentId: record.documentId,
    url: record.url,
    ...(record.foundOn === undefined ? {} : { foundOn: record.foundOn }),
    source: record.source,
    summary: record.summary,
    inspectedAt: record.inspectedAt,
  };
}

function conversionResponse(record: StoredDocumentConversion) {
  return {
    id: record.id,
    documentId: record.documentId,
    summary: record.summary,
    inputSha256: record.inputSha256,
    outputSha256: record.outputSha256,
    convertedAt: record.convertedAt,
  };
}

function documentResponse(record: ClientDocumentRecord) {
  return {
    id: record.id,
    url: record.url,
    kind: record.kind,
    source: record.source,
    ...(record.foundOn === undefined ? {} : { foundOn: record.foundOn }),
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    ...(record.latestInspection === undefined
      ? {}
      : { latestInspection: inspectionResponse(record.latestInspection) }),
    ...(record.latestConversion === undefined
      ? {}
      : { latestConversion: conversionResponse(record.latestConversion) }),
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

  const documents = await platform.listClientDocuments(clientId);

  return Response.json(
    {
      requestId,
      documents: documents.map(documentResponse),
      count: documents.length,
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
    // Nothing persisted — not even a document row. See the header.
    return refusalResponse(outcome.refusal, requestId);
  }

  const now = new Date().toISOString();
  // After the inspection succeeded, so a refusal minted nothing. The bytes
  // just proved themselves a PDF, whatever the URL's extension claimed —
  // an extensionless address that served a PDF is still a PDF row.
  const document = await platform.ensureClientDocument(
    clientId,
    {
      url: parsed.data.url,
      kind: documentLinkKind(parsed.data.url) ?? 'pdf',
      source: 'crawl',
      ...(parsed.data.foundOn === undefined ? {} : { foundOn: parsed.data.foundOn }),
    },
    now,
  );

  const record: StoredDocumentInspection = {
    id: requestId,
    clientId,
    documentId: document.id,
    url: parsed.data.url,
    ...(parsed.data.foundOn === undefined ? {} : { foundOn: parsed.data.foundOn }),
    source: 'crawl',
    summary: outcome.summary,
    inspectedAt: now,
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

  const now = new Date().toISOString();
  const document = await platform.ensureClientDocument(
    clientId,
    { url: name, kind: 'pdf', source: 'upload' },
    now,
  );

  const record: StoredDocumentInspection = {
    id: requestId,
    clientId,
    documentId: document.id,
    url: name,
    source: 'upload',
    summary: outcome.summary,
    inspectedAt: now,
  };
  await platform.saveDocumentInspection(record);

  // No host and no name: an upload has no URL, and the filename is as much a
  // path as a path is.
  logInfo('document_inspected', { requestId, clientId, ...logSafe(outcome.summary) });

  return Response.json({ requestId, inspection: inspectionResponse(record) }, { status: 201 });
}
