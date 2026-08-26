import {
  assertSafeTargetUrl,
  UnsafeTargetError,
} from '../../../integrations/browser/target-url';
import type { UploadCheck } from '../../../domain/document-remediation';
import { hostnameOf } from '../../../services/safe-url';
import { logWarn } from '../../../services/logger';
import { maxDocumentBytes, type UploadRefusal } from './document-upload';

/**
 * The guarded fetch every by-URL document route makes, in one copy.
 *
 * Inspection and conversion both start the same way: an operator names a URL,
 * and this server goes and gets the bytes. Two copies of this sequence is how
 * one of them ends up with the SSRF guard subtly weaker, and the weaker one is
 * the one that gets found — the same rule `readDocumentUpload` enforces on the
 * upload side, applied to the fetch side.
 *
 * The order is the security-relevant part and must not be rearranged:
 *
 * 1. `assertSafeTargetUrl` with the URL's **own** hostname — the host check is
 *    trivially self-consistent, and what remains (scheme, literal-IP ranges,
 *    every resolved address) is the part that matters for a server-side fetch.
 *    The residual DNS-rebinding window stays open honestly: the browser path
 *    closes it by checking the *connected* peer, and a plain `fetch` cannot.
 * 2. `redirect: 'manual'`, and a redirect **refused**, never chased — each hop
 *    would need the whole check again, and silently following one defeats it.
 * 3. The size cap applied to the *stream* with a running total, so an
 *    over-limit document costs at most the cap plus one chunk, not an
 *    unbounded buffer the cap then measures.
 * 4. The container check on the bytes, before any external process is started
 *    for them — passed in as a function for the same reason
 *    `readDocumentUpload` takes one: a third document type cannot forget it.
 *
 * ## Logs
 *
 * The hostname only, never the full URL. Municipal document paths routinely
 * name people (`/minutes/objection-of-j-doe.pdf`), and a log line persists and
 * travels. Responses may echo the URL — the caller supplied it.
 */

export type DocumentFetchResult =
  | { ok: true; bytes: Buffer; kind: string }
  | { ok: false; refusal: UploadRefusal };

export type DocumentFetchOptions = {
  /** The container check — `isPdf` or `isWordDocument`. */
  accept: (bytes: Uint8Array) => UploadCheck;
  /** Sent as the `accept` header, naming what the caller hopes to receive. */
  acceptHeader: string;
};

export async function fetchDocumentBytes(
  url: string,
  requestId: string,
  options: DocumentFetchOptions,
): Promise<DocumentFetchResult> {
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
      headers: { accept: options.acceptHeader },
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

  const check = options.accept(bytes);
  if (!check.ok) {
    return {
      ok: false,
      refusal: { status: 415, error: 'unsupported_document', detail: check.reason },
    };
  }

  return { ok: true, bytes, kind: check.kind };
}
