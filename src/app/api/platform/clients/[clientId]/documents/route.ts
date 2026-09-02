import { createHash } from 'node:crypto';
import { z } from 'zod';

import { INSTRUMENT_VERSION, isPdf, logSafe } from '../../../../../../domain/document-remediation';
import { actorFields, type Principal } from '../../../../../../domain/operator';
import type {
  ClientDocumentRecord,
  StoredDocumentConversion,
  StoredDocumentInspection,
} from '../../../../../../domain/platform';
import { resolveJavaRuntime } from '../../../../../../integrations/documents/java-runtime';
import { getPlatformStore } from '../../../../../../integrations/persistence';
import { compareDocumentInspections } from '../../../../../../services/document-regression';
import { pairDocuments } from '../../../../../../services/document-pairing';
import {
  DOCUMENT_STATES,
  countByState,
  documentState,
  latestReading,
  type DocumentState,
} from '../../../../../../services/document-state';
import { hostnameOf } from '../../../../../../services/safe-url';
import { logInfo } from '../../../../../../services/logger';
import { authorizePrincipal } from '../../../../_lib/authorize';
import {
  fetchAndClassifyDocumentUrl,
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
 * - **POST** `{ url, foundOn? }` fetches whatever the URL actually serves —
 *   the bytes decide, never the extension, which is what makes this the way
 *   an operator catalogs an extensionless download endpoint. A PDF is
 *   inspected and the reading persisted; a Word document becomes an
 *   inventory row whose action is conversion. Rows are created only on
 *   success (a pasted address the fetch refuses mints nothing).
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
    // A flag, never the blob URL: that handle stays server-side, and the
    // download route re-reads it from the record.
    stored: record.artifactUrl !== undefined,
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

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isDocumentState(value: string): value is DocumentState {
  return (DOCUMENT_STATES as readonly string[]).includes(value);
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

  // Filters and the cursor arrive as query params, applied SERVER-SIDE by
  // the store — a filter that only sifted the first page would hide exactly
  // the rows past the cap an operator is filtering to find.
  const search = new URL(request.url).searchParams;
  const kindParam = search.get('kind');
  if (kindParam !== null && !['pdf', 'docx', 'doc'].includes(kindParam)) {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }
  const stateParam = search.get('state');
  if (stateParam !== null && !isDocumentState(stateParam)) {
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }
  const beforeAt = search.get('beforeLastSeenAt');
  const beforeId = search.get('beforeId');
  if ((beforeAt === null) !== (beforeId === null)) {
    // Half a cursor selects the wrong page silently; refuse instead.
    return Response.json({ error: 'invalid_request_body', requestId }, { status: 400 });
  }

  const page = await platform.listClientDocuments(clientId, {
    ...(kindParam === null ? {} : { kind: kindParam as 'pdf' | 'docx' | 'doc' }),
    ...(search.get('hasGaps') === 'true' ? { hasGaps: true as const } : {}),
    ...(search.get('unreviewed') === 'true' ? { unreviewed: true as const } : {}),
    ...(beforeAt === null || beforeId === null
      ? {}
      : { before: { lastSeenAt: beforeAt, id: beforeId } }),
  });

  // The document pipeline's own regression — latest two readings per
  // document, diffed by criterion. Computed here rather than stored: it is a
  // view over inspection history, and a stored copy would be one more thing
  // free to disagree with the rows it summarises.
  const diffs = compareDocumentInspections(await platform.listDocumentInspections(clientId));
  const diffByDocument = new Map(diffs.map((diff) => [diff.documentId, diff]));

  // Pairing, state and the counts all read the UNFILTERED inventory: a
  // filtered page would miss the sibling that fell outside it, and a count
  // over one page is not a count. One page of 200 covers every crawlable
  // inventory (the per-kind caps top out at 150); an inventory beyond that
  // pairs and counts within its first page, a bound worth widening only when
  // a real client exceeds it.
  const universe = await platform.listClientDocuments(clientId);
  const pairs = pairDocuments(universe.documents);
  const byId = new Map(universe.documents.map((record) => [record.id, record]));
  for (const record of page.documents) byId.set(record.id, record);

  // State is derived, never stored, so the filter for it is applied here
  // over the same universe the counts come from — two queries for 200 rows.
  const answers = await platform.latestDocumentAnswers(clientId, [...byId.keys()]);
  const answersByDocument = new Map<string, typeof answers>();
  for (const answer of answers) {
    const held = answersByDocument.get(answer.documentId) ?? [];
    held.push(answer);
    answersByDocument.set(answer.documentId, held);
  }
  const standingOf = (record: ClientDocumentRecord) => {
    const source = pairs.get(record.id);
    return documentState(
      record,
      latestReading(record, source === undefined ? undefined : byId.get(source.id)),
      answersByDocument.get(record.id) ?? [],
    );
  };
  const standings = new Map([...byId.values()].map((record) => [record.id, standingOf(record)]));
  const counts = countByState(
    universe.documents.map((record) => standings.get(record.id)!.state),
  );

  const documents =
    stateParam === null
      ? page.documents
      : universe.documents.filter(
          (record) =>
            standings.get(record.id)!.state === stateParam &&
            (kindParam === null || record.kind === kindParam),
        );

  return Response.json(
    {
      requestId,
      hasMore: stateParam === null ? page.hasMore : false,
      counts,
      documents: documents.map((record) => {
        const diff = diffByDocument.get(record.id);
        const source = pairs.get(record.id);
        const standing = standings.get(record.id)!;
        return {
          ...documentResponse(record),
          state: standing.state,
          open: standing.open.length,
          waiting: standing.waiting.length,
          expired: standing.expired,
          ...(source === undefined ? {} : { sourceAvailable: source }),
          ...(diff === undefined || diff.status === 'first-reading'
            ? {}
            : {
                regression: {
                  status: diff.status,
                  newGaps: diff.newGaps,
                  resolvedGaps: diff.resolvedGaps,
                  unchangedCount: diff.unchangedCount,
                  baselineAt: diff.baselineAt,
                },
              }),
        };
      }),
      count: documents.length,
    },
    { status: 200 },
  );
}

/**
 * The trail, by document id and never by address: the feed is rendered to
 * every operator and a document path routinely names a person. The name
 * `document_recorded`/`document_inspected` matches the log line beside it.
 */
async function recordDocumentEvent(
  platform: ReturnType<typeof getPlatformStore>,
  clientId: string,
  principal: Principal,
  action: string,
  subject: string | undefined,
  metadata: Record<string, unknown>,
): Promise<void> {
  await platform.recordEvent({
    clientId,
    ...actorFields(principal),
    action,
    ...(subject === undefined ? {} : { subject }),
    metadata,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
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

  // One guarded fetch, either container: the bytes decide what this URL is,
  // never its extension — municipal sites serve documents from extensionless
  // download endpoints, and this route is how an operator catalogs one.
  const fetched = await fetchAndClassifyDocumentUrl(parsed.data.url, requestId);
  if (!fetched.ok) {
    // Nothing persisted — not even a document row. See the header.
    return refusalResponse(fetched.refusal, requestId);
  }

  const now = new Date().toISOString();

  if (fetched.kind !== 'pdf') {
    // A Word document: a byte-verified sighting the inventory records, with
    // no inspection row — the PDF instrument did not read it, and the store
    // holds only what an instrument said. Its action is conversion, which
    // the screen offers on the row this creates. No JVM was needed, which is
    // why the toolchain guard lives in the PDF branch below rather than at
    // the top: a JVM-less host can still catalog.
    const document = await platform.ensureClientDocument(
      clientId,
      {
        url: parsed.data.url,
        kind: fetched.kind,
        source: 'crawl',
        ...(parsed.data.foundOn === undefined ? {} : { foundOn: parsed.data.foundOn }),
      },
      now,
    );

    logInfo('document_recorded', {
      requestId,
      clientId,
      host: hostnameOf(parsed.data.url),
      kind: fetched.kind,
    });
    await recordDocumentEvent(platform, clientId, principal, 'document_recorded', document.id, {
      kind: fetched.kind,
    });

    return Response.json(
      { requestId, document: documentResponse(document) },
      { status: 201 },
    );
  }

  // The toolchain guard sits here, after the fetch — the kind is not known
  // until the bytes are, so a JVM-less host pays one guarded fetch before
  // refusing a PDF. Stated as the trade it is.
  const java = resolveJavaRuntime();
  if (!java.available) {
    return Response.json(
      { error: 'document_toolchain_unavailable', detail: java.reason, requestId },
      { status: 503 },
    );
  }

  const outcome = await inspectPdfBytes(fetched.bytes, requestId, 'ada-inspect-url-');
  if (!outcome.ok) {
    // Nothing persisted — not even a document row. See the header. The trail
    // still says a reading was attempted and refused, or a document nobody
    // can read stays invisible.
    await recordDocumentEvent(platform, clientId, principal, 'document_inspection_failed', undefined, {
      detail: outcome.refusal.detail ?? outcome.refusal.error,
    });
    return refusalResponse(outcome.refusal, requestId);
  }

  // After the inspection succeeded, so a refusal minted nothing. The bytes
  // proved themselves a PDF, whatever the URL's extension claimed — and they
  // are recorded on the row, so a later reading of different bytes is known
  // to be one.
  const inputSha256 = sha256(fetched.bytes);
  const document = await platform.ensureClientDocument(
    clientId,
    {
      url: parsed.data.url,
      kind: 'pdf',
      source: 'crawl',
      ...(parsed.data.foundOn === undefined ? {} : { foundOn: parsed.data.foundOn }),
      contentSha256: inputSha256,
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
    instrumentVersion: INSTRUMENT_VERSION,
    inputSha256,
    inspectedAt: now,
  };
  await platform.saveDocumentInspection(record);

  logInfo('document_inspected', {
    requestId,
    clientId,
    host: hostnameOf(parsed.data.url),
    ...logSafe(outcome.summary),
  });
  await recordDocumentEvent(platform, clientId, principal, 'document_inspected', document.id, {
    gaps: outcome.summary.gaps.length,
    needs: outcome.summary.needs?.length ?? 0,
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
  const principal = await authorizePrincipal(request);
  if (!principal) {
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
    await recordDocumentEvent(platform, clientId, principal, 'document_inspection_failed', undefined, {
      detail: outcome.refusal.detail ?? outcome.refusal.error,
    });
    return refusalResponse(outcome.refusal, requestId);
  }

  // The filename is the only handle an upload has, so the record keeps it —
  // in `url`, the same column a crawl record's address lives in. It is
  // caller-controlled: fine to store (the database holds client DOM snippets
  // in `findings`), never to log, and it never reached the filesystem — the
  // temp file inside `inspectPdfBytes` is named by the request id.
  const name = upload.filename.trim().slice(0, MAX_UPLOAD_NAME) || 'upload.pdf';

  const now = new Date().toISOString();
  const inputSha256 = sha256(upload.bytes);
  const document = await platform.ensureClientDocument(
    clientId,
    { url: name, kind: 'pdf', source: 'upload', contentSha256: inputSha256 },
    now,
  );

  const record: StoredDocumentInspection = {
    id: requestId,
    clientId,
    documentId: document.id,
    url: name,
    source: 'upload',
    summary: outcome.summary,
    instrumentVersion: INSTRUMENT_VERSION,
    inputSha256,
    inspectedAt: now,
  };
  await platform.saveDocumentInspection(record);

  // No host and no name: an upload has no URL, and the filename is as much a
  // path as a path is.
  logInfo('document_inspected', { requestId, clientId, ...logSafe(outcome.summary) });
  await recordDocumentEvent(platform, clientId, principal, 'document_inspected', document.id, {
    gaps: outcome.summary.gaps.length,
    needs: outcome.summary.needs?.length ?? 0,
  });

  return Response.json({ requestId, inspection: inspectionResponse(record) }, { status: 201 });
}
