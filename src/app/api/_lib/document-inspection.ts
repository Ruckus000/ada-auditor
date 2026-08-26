import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isPdf, summarise } from '../../../domain/document-remediation';
import type { RemediationSummary } from '../../../domain/document-remediation';
import { inspectDocument } from '../../../integrations/documents/inspect';
import {
  assertSafeTargetUrl,
  UnsafeTargetError,
} from '../../../integrations/browser/target-url';
import { hostnameOf } from '../../../services/safe-url';
import { logWarn } from '../../../services/logger';
import { maxDocumentBytes, type UploadRefusal } from './document-upload';

/**
 * The fetch-guard-inspect core two routes share.
 *
 * `/api/documents/inspect-url` is the client-unscoped tool; the client-scoped
 * `POST /api/platform/clients/<id>/documents` performs the same inspection and
 * then persists it. Two copies of this sequence is how one of them ends up
 * with the SSRF guard subtly weaker, and the weaker one is the one that gets
 * found — the exact drift `readDocumentUpload` exists to prevent on the upload
 * side.
 *
 * The order is the security-relevant part and must not be rearranged:
 *
 * 1. `assertSafeTargetUrl` with the URL's **own** hostname — the host check is
 *    trivially self-consistent, and what remains (scheme, literal-IP ranges,
 *    every resolved address) is the part that matters for a server-side fetch.
 * 2. `redirect: 'manual'`, and a redirect **refused**, never chased — each hop
 *    would need the whole check again, and silently following one defeats it.
 * 3. The size cap applied to the *stream* with a running total, so an
 *    over-limit document costs at most the cap plus one chunk, not an
 *    unbounded buffer the cap then measures.
 * 4. `isPdf` before any JVM is started for the bytes.
 * 5. A temp file named by the request id only — never anything the remote end
 *    chose.
 *
 * ## Logs
 *
 * The hostname only, never the full URL. Municipal document paths routinely
 * name people (`/minutes/objection-of-j-doe.pdf`), and a log line persists and
 * travels. Responses may echo the URL — the caller supplied it.
 */

export type InspectionOutcome =
  | { ok: true; summary: RemediationSummary }
  | { ok: false; refusal: UploadRefusal };

/**
 * Writes PDF bytes to a temp file named by the request id, runs the
 * instrument, and summarises. Shared by the URL path below and both upload
 * routes, so every caller describes a document with the same words.
 *
 * Template literal rather than `join` for the dynamic half of the path —
 * Turbopack compiles an unresolvable `path.join` into a file pattern, which
 * once made the build walk the entire project. `work` is absolute from
 * `mkdtemp` and the name has no separators.
 */
export async function inspectPdfBytes(
  bytes: Uint8Array,
  requestId: string,
  tmpPrefix = 'ada-inspect-',
): Promise<InspectionOutcome> {
  const work = await mkdtemp(join(tmpdir(), tmpPrefix));
  const source = `${work}/${requestId}.pdf`;

  try {
    await writeFile(source, bytes);

    const result = await inspectDocument(source);
    if (!result.ok) {
      logWarn('document_inspect_failed', { requestId, failure: result.failure.kind });
      return {
        ok: false,
        refusal: { status: 422, error: 'inspect_failed', detail: result.failure.kind },
      };
    }

    // A reading has no source document to compare against, so the two fields
    // that describe provenance are answered from the file itself: the title
    // it carries, and the language it declares. Neither is inferred.
    const summary = summarise({
      title:
        result.value.title === null
          ? { kind: 'no-heading-to-copy' }
          : { kind: 'already-titled', title: result.value.title },
      sourceLanguage: result.value.lang,
      structure: result.value,
    });

    return { ok: true, summary };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Fetches a document from where it lives and inspects it. See the header. */
export async function fetchAndInspectDocumentUrl(
  url: string,
  requestId: string,
): Promise<InspectionOutcome> {
  try {
    await assertSafeTargetUrl(url, [new URL(url).hostname]);
  } catch (error) {
    if (error instanceof UnsafeTargetError) {
      logWarn('document_fetch_refused', { requestId, host: hostnameOf(url) });
      return {
        ok: false,
        refusal: { status: 400, error: 'unsafe_url', detail: error.message },
      };
    }
    throw error;
  }

  const limit = maxDocumentBytes();

  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
      headers: { accept: 'application/pdf,*/*' },
    });
  } catch (error) {
    logWarn('document_fetch_failed', { requestId, host: hostnameOf(url) });
    return {
      ok: false,
      refusal: { status: 502, error: 'fetch_failed', detail: String(error).split('\n')[0] },
    };
  }

  if (response.status >= 300 && response.status < 400) {
    // Refused, not followed — see the header note.
    return {
      ok: false,
      refusal: {
        status: 502,
        error: 'redirected',
        detail: `the document URL answered ${response.status}`,
      },
    };
  }

  if (!response.ok || !response.body) {
    return {
      ok: false,
      refusal: {
        status: 502,
        error: 'fetch_failed',
        detail: `the document URL answered ${response.status}`,
      },
    };
  }

  // Streamed with a running total, so an over-limit document costs at most the
  // cap plus one chunk — not an unbounded buffer that the cap then measures.
  const chunks: Uint8Array[] = [];
  let received = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limit) {
        await reader.cancel();
        return {
          ok: false,
          refusal: {
            status: 413,
            error: 'document_too_large',
            detail: `limit is ${limit} bytes`,
          },
        };
      }
      chunks.push(value);
    }
  } catch (error) {
    return {
      ok: false,
      refusal: { status: 502, error: 'fetch_failed', detail: String(error).split('\n')[0] },
    };
  }

  const bytes = Buffer.concat(chunks);

  const check = isPdf(bytes);
  if (!check.ok) {
    return {
      ok: false,
      refusal: { status: 415, error: 'unsupported_document', detail: check.reason },
    };
  }

  return inspectPdfBytes(bytes, requestId, 'ada-inspect-url-');
}
