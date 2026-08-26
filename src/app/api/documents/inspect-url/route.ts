import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { isPdf, logSafe, summarise } from '../../../../domain/document-remediation';
import { inspectDocument } from '../../../../integrations/documents/inspect';
import { resolveJavaRuntime } from '../../../../integrations/documents/java-runtime';
import {
  assertSafeTargetUrl,
  UnsafeTargetError,
} from '../../../../integrations/browser/target-url';
import { hostnameOf } from '../../../../services/safe-url';
import { logInfo, logWarn } from '../../../../services/logger';
import { authorizePrincipal } from '../../_lib/authorize';
import { maxDocumentBytes } from '../../_lib/document-upload';
import { createRequestId } from '../../_lib/request-id';

/**
 * Inspect a document where it lives, by URL.
 *
 * The upload route serves a document an operator already has; this serves the
 * ones discovery finds on a client's site — which is most of them, and the
 * reason the capability exists. Same instrument, same summary, same rules.
 *
 * ## What guards the fetch, and what honestly does not
 *
 * `assertSafeTargetUrl` checks the scheme, range-checks a literal IP, and
 * resolves the hostname to check **every** address immediately before the
 * request. Redirects are not followed (`redirect: 'manual'`) — a redirect off
 * the checked host is refused, not chased, because each hop would need the
 * whole check again and silently following one defeats it.
 *
 * **DNS rebinding is not fully closed here.** The browser path closes it by
 * checking the address the socket actually connected to; a plain `fetch`
 * exposes no such thing. The residual window is between our resolution and the
 * fetch's own — the same standard `assertHostResolves` already applies to
 * crawl-discovered links, and the same honesty: named, not hand-waved.
 *
 * An authenticated operator can make this server fetch an arbitrary public
 * URL. That is not new power — `/api/platform/discover` navigates a full
 * browser to arbitrary public URLs under the same auth.
 *
 * ## Logs
 *
 * The hostname only, never the full URL. Municipal document paths routinely
 * name people (`/minutes/objection-of-j-doe.pdf`), and a log line persists and
 * travels. The response echoes the URL — the caller supplied it.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

const bodySchema = z
  .object({
    url: z
      .string()
      .max(2048)
      .pipe(z.url({ protocol: /^https?$/ })),
  })
  .strict();

export async function POST(request: Request) {
  const requestId = createRequestId();

  if (!(await authorizePrincipal(request))) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const java = resolveJavaRuntime();
  if (!java.available) {
    return Response.json(
      { error: 'document_toolchain_unavailable', detail: java.reason, requestId },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'expected_json_body', requestId }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_url', detail: parsed.error.issues[0]?.message, requestId },
      { status: 400 },
    );
  }
  const url = parsed.data.url;

  try {
    // The URL's own host as the allowlist: the host check is trivially
    // self-consistent, and what remains — scheme, literal-IP ranges, every
    // resolved address — is the part that matters for a server-side fetch.
    await assertSafeTargetUrl(url, [new URL(url).hostname]);
  } catch (error) {
    if (error instanceof UnsafeTargetError) {
      logWarn('document_fetch_refused', { requestId, host: hostnameOf(url) });
      return Response.json(
        { error: 'unsafe_url', detail: error.message, requestId },
        { status: 400 },
      );
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
    return Response.json(
      { error: 'fetch_failed', detail: String(error).split('\n')[0], requestId },
      { status: 502 },
    );
  }

  if (response.status >= 300 && response.status < 400) {
    // Refused, not followed — see the header note.
    return Response.json(
      { error: 'redirected', detail: `the document URL answered ${response.status}`, requestId },
      { status: 502 },
    );
  }

  if (!response.ok || !response.body) {
    return Response.json(
      { error: 'fetch_failed', detail: `the document URL answered ${response.status}`, requestId },
      { status: 502 },
    );
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
        return Response.json(
          { error: 'document_too_large', detail: `limit is ${limit} bytes`, requestId },
          { status: 413 },
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    return Response.json(
      { error: 'fetch_failed', detail: String(error).split('\n')[0], requestId },
      { status: 502 },
    );
  }

  const bytes = Buffer.concat(chunks);

  const check = isPdf(bytes);
  if (!check.ok) {
    return Response.json(
      { error: 'unsupported_document', detail: check.reason, requestId },
      { status: 415 },
    );
  }

  const work = await mkdtemp(join(tmpdir(), 'ada-inspect-url-'));
  const source = `${work}/${requestId}.pdf`;

  try {
    await writeFile(source, bytes);

    const result = await inspectDocument(source);
    if (!result.ok) {
      logWarn('document_inspect_failed', { requestId, failure: result.failure.kind });
      return Response.json(
        { error: 'inspect_failed', detail: result.failure.kind, requestId },
        { status: 422 },
      );
    }

    const summary = summarise({
      title:
        result.value.title === null
          ? { kind: 'no-heading-to-copy' }
          : { kind: 'already-titled', title: result.value.title },
      sourceLanguage: result.value.lang,
      structure: result.value,
    });

    logInfo('document_inspected', { requestId, host: hostnameOf(url), ...logSafe(summary) });

    return Response.json({ requestId, url, ...summary });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
