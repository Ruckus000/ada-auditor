import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  INSTRUMENT_VERSION,
  isPdf,
  isWordDocument,
  logSafe,
} from '../../../../../../../domain/document-remediation';
import { actorFields, type Principal } from '../../../../../../../domain/operator';
import type { StoredDocumentConversion } from '../../../../../../../domain/platform';
import { resolveLibreOffice } from '../../../../../../../integrations/documents/libreoffice-runtime';
import { resolveJavaRuntime } from '../../../../../../../integrations/documents/java-runtime';
import { getPlatformStore } from '../../../../../../../integrations/persistence';
import { getArtifactStore } from '../../../../../../../integrations/artifacts/blob-store';
import type { DeclaredAnswers } from '../../../../../../../domain/document-answers';
import type { StoredClientDocument, StoredDocumentAnswer } from '../../../../../../../domain/platform';
import { pairDocuments } from '../../../../../../../services/document-pairing';
import { hostnameOf } from '../../../../../../../services/safe-url';
import { logInfo, logWarn } from '../../../../../../../services/logger';
import { authorizePrincipal } from '../../../../../_lib/authorize';
import { documentBudgetRefusal } from '../../../../../_lib/budget-refusal';
import { fetchDocumentBytes } from '../../../../../_lib/document-fetch';
import {
  remediateWordBytes,
  remediationResponse,
  repairPdfBytes,
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

const WORD_OR_PDF_ACCEPT_HEADER =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/pdf,*/*';

/**
 * Word or PDF, and the answer says which — a conversion or a repair.
 *
 * Identical to the acceptor on `/api/documents/remediate`, and deliberately
 * not shared: that one guards an upload and this one guards a fetch, and the
 * two have drifted apart before. What must not differ is the ORDER — Word
 * first, so a container that is both (there is no such thing, but a check
 * that assumed so would be the bug) resolves the same way on both doors.
 */
function isWordOrPdf(bytes: Uint8Array) {
  const word = isWordDocument(bytes);
  if (word.ok) return word;

  const pdf = isPdf(bytes);
  if (pdf.ok) return pdf;

  return word;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The delivered bytes into the blob store, under `documents/` — a prefix the
 * evidence pruner (`prefix: 'runs/'`) never sweeps, because a delivered
 * document is the product, not evidence with a window: it lives until its
 * rows do. `null` from the store (no blob configured) or a throw records
 * honest absence — the response already carries the bytes and the record
 * carries their hash, so storage failing must not fail the conversion.
 *
 * Path from generated ids only, per the standing rule.
 */
async function storeConvertedPdf(
  clientId: string,
  requestId: string,
  pdf: Buffer,
): Promise<{ artifactUrl: string } | Record<string, never>> {
  try {
    const stored = await getArtifactStore().storeBytes(
      `documents/${clientId}/${requestId}.pdf`,
      pdf,
      'application/pdf',
    );
    return stored === null ? {} : { artifactUrl: stored.url };
  } catch {
    logWarn('document_artifact_store_failed', { requestId, clientId });
    return {};
  }
}

/**
 * The trail, by document id and never by address — a document path
 * routinely names a person, and the feed is rendered to every operator.
 */
async function recordConversionEvent(
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

/**
 * The declared answers on record for THESE bytes, shaped for the pipeline.
 *
 * Answers attach to the row that was answered. A Word source's conversion is
 * the remediation of the PDFs paired with it, so those PDFs' answers count
 * too — and the sha keying decides which apply: only rows keyed to the bytes
 * about to be run are consumed, never one given for an earlier version.
 * Returns the ids consumed so the conversion row can record them.
 */
async function answersFor(
  platform: ReturnType<typeof getPlatformStore>,
  clientId: string,
  document: StoredClientDocument | undefined,
  inputSha256: string,
): Promise<{ answers?: DeclaredAnswers; answerIds: string[] }> {
  if (document === undefined) return { answerIds: [] };
  const universe = (await platform.listClientDocuments(clientId)).documents;
  const pairs = pairDocuments(universe);
  const ids = [
    document.id,
    ...universe.filter((doc) => pairs.get(doc.id)?.id === document.id).map((doc) => doc.id),
  ];
  const rows = (await platform.latestDocumentAnswers(clientId, ids)).filter(
    (row): row is StoredDocumentAnswer & { disposition: 'declared' } =>
      row.disposition === 'declared' && row.inputSha256 === inputSha256,
  );
  if (rows.length === 0) return { answerIds: [] };

  const language = rows.find((row) => row.kind === 'language')?.value;
  const figures = rows.flatMap((row) =>
    row.kind === 'figure' && row.target !== undefined && 'ordinal' in row.target && row.value !== undefined
      ? [{ ...row.target, alt: row.value }]
      : [],
  );
  return {
    answers: { inputSha256, ...(language === undefined ? {} : { language }), figures },
    answerIds: rows.map((row) => row.id),
  };
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

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  // Before the toolchain probe and the fetch: a caller past the ceiling costs
  // this function nothing but the answer.
  const capped = await documentBudgetRefusal(requestId);
  if (capped) return refusalResponse(capped, requestId);

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
    accept: isWordOrPdf,
    acceptHeader: WORD_OR_PDF_ACCEPT_HEADER,
  });
  if (!fetched.ok) {
    return refusalResponse(fetched.refusal, requestId);
  }

  // The client-facing name, for a filename-derived title. The temp path the
  // stages see is a request id and says nothing.
  const sourceName = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
  const repairing = fetched.kind === 'pdf';
  const inputSha256 = sha256(fetched.bytes);

  // What a person declared for these bytes, if the row is on record. Read
  // rather than ensured: a failed run must mint nothing.
  const known = await platform.findClientDocument(clientId, url);
  const declared = await answersFor(platform, clientId, known ?? undefined, inputSha256);

  const outcome = repairing
    ? await repairPdfBytes(fetched.bytes, requestId, { sourceName, ...declared })
    : await remediateWordBytes(fetched.bytes, fetched.kind, requestId, { sourceName, ...declared });
  if (!outcome.ok) {
    // Nothing persisted, but the trail says the run was refused and why —
    // a signed PDF an operator keeps clicking on must not stay invisible.
    await recordConversionEvent(
      platform, clientId, principal,
      repairing ? 'document_repair_failed' : 'document_conversion_failed',
      known?.id,
      { detail: outcome.refusal.detail ?? outcome.refusal.error },
    );
    if (outcome.refusal.detail === 'answer-mismatch' && known !== null) {
      // The bytes just read are recorded on the row it already has, so the
      // answers read as stale rather than silently unapplied. Nothing is
      // minted: the row existed.
      await platform.ensureClientDocument(
        clientId,
        { url: known.url, kind: known.kind, source: known.source, contentSha256: inputSha256 },
        new Date().toISOString(),
      );
    }
    return refusalResponse(outcome.refusal, requestId);
  }

  const now = new Date().toISOString();
  const document = await platform.ensureClientDocument(
    clientId,
    {
      url,
      // The byte check's verdict, not the extension's — the bytes are in
      // hand, and the acceptor admits exactly these three containers.
      kind: repairing ? 'pdf' : fetched.kind === 'doc' ? 'doc' : 'docx',
      source: 'crawl',
      ...(parsed.data.foundOn === undefined ? {} : { foundOn: parsed.data.foundOn }),
      contentSha256: inputSha256,
    },
    now,
  );

  const record: StoredDocumentConversion = {
    id: requestId,
    clientId,
    documentId: document.id,
    summary: outcome.summary,
    inputSha256,
    outputSha256: sha256(outcome.pdf),
    ...(repairing ? { kind: 'repair' as const } : {}),
    instrumentVersion: INSTRUMENT_VERSION,
    ...(await storeConvertedPdf(clientId, requestId, outcome.pdf)),
    ...(declared.answerIds.length === 0 ? {} : { answerIds: declared.answerIds }),
    convertedAt: now,
  };
  await platform.saveDocumentConversion(record);

  logInfo(repairing ? 'document_repaired' : 'document_converted', {
    requestId,
    clientId,
    host: hostnameOf(url),
    stored: record.artifactUrl !== undefined,
    ...logSafe(outcome.summary),
  });
  await recordConversionEvent(
    platform, clientId, principal,
    repairing ? 'document_repaired' : 'document_converted',
    document.id,
    { conversionId: record.id, gaps: outcome.summary.gaps.length, needs: outcome.summary.needs?.length ?? 0 },
  );

  return remediationResponse({ pdf: outcome.pdf, summary: outcome.summary, requestId });
}

export async function PUT(
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

  const upload = await readDocumentUpload(request, {
    requestId,
    accept: isWordOrPdf,
    // Only the JVM of every caller: a repair needs no LibreOffice, and
    // demanding it here would refuse work this host can do. The converter is
    // checked below, once the container shape says the work is a conversion.
    requires: [{ error: 'document_toolchain_unavailable', check: () => resolveJavaRuntime() }],
  });

  if (!upload.ok) {
    return refusalResponse(upload.refusal, requestId);
  }

  // A new version of a row already on record lands on that row, under its
  // own address — see the documents route for the reasoning. Resolved before
  // any stage runs.
  const existing =
    upload.documentId === undefined
      ? undefined
      : (await platform.listClientDocuments(clientId)).documents.find(
          (doc) => doc.id === upload.documentId,
        );
  if (upload.documentId !== undefined && existing === undefined) {
    return Response.json({ error: 'document_not_found', requestId }, { status: 404 });
  }
  const rowFor = (fallback: { url: string; kind: 'pdf' | 'docx' | 'doc' }, contentSha256: string) =>
    existing === undefined
      ? { ...fallback, source: 'upload' as const, contentSha256 }
      : {
          url: existing.url,
          kind: existing.kind,
          source: existing.source,
          ...(existing.foundOn === undefined ? {} : { foundOn: existing.foundOn }),
          contentSha256,
        };

  if (upload.kind === 'pdf') {
    return repairUploadedPdf(upload, clientId, requestId, platform, principal, rowFor, existing);
  }

  const soffice = resolveLibreOffice();
  if (!soffice.available) {
    return refusalResponse(
      { status: 503, error: 'converter_unavailable', detail: soffice.reason },
      requestId,
    );
  }

  const name = upload.filename.trim().slice(0, MAX_UPLOAD_NAME) || 'upload.docx';
  const inputSha256 = sha256(upload.bytes);
  // The row the answers hang off: the one named, else the one this filename
  // already has. An upload the inventory has never seen has no answers.
  const known = existing ?? (await platform.findClientDocument(clientId, name)) ?? undefined;
  const declared = await answersFor(platform, clientId, known, inputSha256);

  const outcome = await remediateWordBytes(upload.bytes, upload.kind, requestId, {
    sourceName: upload.filename,
    ...declared,
  });
  if (!outcome.ok) {
    await recordConversionEvent(platform, clientId, principal, 'document_conversion_failed', known?.id, {
      detail: outcome.refusal.detail ?? outcome.refusal.error,
    });
    return refusalResponse(outcome.refusal, requestId);
  }

  const now = new Date().toISOString();
  const document = await platform.ensureClientDocument(
    clientId,
    rowFor({ url: name, kind: upload.kind === 'doc' ? 'doc' : 'docx' }, inputSha256),
    now,
  );

  const record: StoredDocumentConversion = {
    id: requestId,
    clientId,
    documentId: document.id,
    summary: outcome.summary,
    inputSha256,
    outputSha256: sha256(outcome.pdf),
    instrumentVersion: INSTRUMENT_VERSION,
    ...(await storeConvertedPdf(clientId, requestId, outcome.pdf)),
    ...(declared.answerIds.length === 0 ? {} : { answerIds: declared.answerIds }),
    convertedAt: now,
  };
  await platform.saveDocumentConversion(record);

  // No host and no name: an upload has no URL, and the filename is as much a
  // path as a path is.
  logInfo('document_converted', {
    requestId,
    clientId,
    stored: record.artifactUrl !== undefined,
    ...logSafe(outcome.summary),
  });
  await recordConversionEvent(platform, clientId, principal, 'document_converted', document.id, {
    conversionId: record.id, gaps: outcome.summary.gaps.length, needs: outcome.summary.needs?.length ?? 0,
  });

  return remediationResponse({ pdf: outcome.pdf, summary: outcome.summary, requestId });
}

/**
 * An uploaded PDF, repaired rather than converted.
 *
 * The same record, the same blob store, the same audit trail as a conversion
 * — and `kind: 'repair'`, because every surface says "Converted to tagged
 * PDF" and nobody converted this one.
 */
async function repairUploadedPdf(
  upload: { bytes: Uint8Array; filename: string },
  clientId: string,
  requestId: string,
  platform: ReturnType<typeof getPlatformStore>,
  principal: Principal,
  rowFor: (
    fallback: { url: string; kind: 'pdf' },
    contentSha256: string,
  ) => Parameters<ReturnType<typeof getPlatformStore>['ensureClientDocument']>[1],
  existing?: StoredClientDocument,
): Promise<Response> {
  const name = upload.filename.trim().slice(0, MAX_UPLOAD_NAME) || 'upload.pdf';
  const inputSha256 = sha256(upload.bytes);
  const known = existing ?? (await platform.findClientDocument(clientId, name)) ?? undefined;
  const declared = await answersFor(platform, clientId, known, inputSha256);

  const outcome = await repairPdfBytes(upload.bytes, requestId, {
    sourceName: upload.filename,
    ...declared,
  });
  if (!outcome.ok) {
    await recordConversionEvent(platform, clientId, principal, 'document_repair_failed', known?.id, {
      detail: outcome.refusal.detail ?? outcome.refusal.error,
    });
    if (outcome.refusal.detail === 'answer-mismatch' && known !== undefined) {
      await platform.ensureClientDocument(
        clientId,
        { url: known.url, kind: known.kind, source: known.source, contentSha256: inputSha256 },
        new Date().toISOString(),
      );
    }
    return refusalResponse(outcome.refusal, requestId);
  }

  const now = new Date().toISOString();
  const document = await platform.ensureClientDocument(
    clientId,
    rowFor({ url: name, kind: 'pdf' }, inputSha256),
    now,
  );

  const record: StoredDocumentConversion = {
    id: requestId,
    clientId,
    documentId: document.id,
    summary: outcome.summary,
    inputSha256,
    outputSha256: sha256(outcome.pdf),
    kind: 'repair',
    instrumentVersion: INSTRUMENT_VERSION,
    ...(await storeConvertedPdf(clientId, requestId, outcome.pdf)),
    ...(declared.answerIds.length === 0 ? {} : { answerIds: declared.answerIds }),
    convertedAt: now,
  };
  await platform.saveDocumentConversion(record);

  logInfo('document_repaired', {
    requestId,
    clientId,
    stored: record.artifactUrl !== undefined,
    ...logSafe(outcome.summary),
  });
  await recordConversionEvent(platform, clientId, principal, 'document_repaired', document.id, {
    conversionId: record.id, gaps: outcome.summary.gaps.length, needs: outcome.summary.needs?.length ?? 0,
  });

  return remediationResponse({ pdf: outcome.pdf, summary: outcome.summary, requestId });
}
