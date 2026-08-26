import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { summarise, type RemediationSummary } from '../../../domain/document-remediation';
import { convertSourceToPdf, type ConvertOptions } from '../../../integrations/documents/convert';
import { logWarn } from '../../../services/logger';
import type { UploadRefusal } from './document-upload';

/**
 * The conversion core two routes share.
 *
 * `/api/documents/remediate` converts a document an operator already has;
 * `/api/documents/remediate-url` converts the ones discovery finds on a
 * client's site. Same pipeline, same summary, same rules — one copy, for the
 * same reason `document-inspection.ts` and `document-fetch.ts` are one copy.
 */

export type ConversionOutcome =
  | { ok: true; pdf: Buffer; summary: RemediationSummary }
  | { ok: false; refusal: UploadRefusal };

/**
 * Writes Word bytes to a temp file named by the request id, runs the
 * conversion pipeline, and reads the result back. The caller's name for the
 * document — a filename or a URL — never reaches the filesystem; both are
 * attacker-controlled, and a request id plus a known extension is all a temp
 * path needs.
 *
 * Template literals rather than `join` for the dynamic halves — Turbopack
 * compiles an unresolvable `path.join` into a file pattern, which once made
 * the build walk the entire project. `work` is absolute from `mkdtemp` and
 * the names have no separators.
 */
export async function remediateWordBytes(
  bytes: Uint8Array,
  kind: string,
  requestId: string,
  options: ConvertOptions = {},
): Promise<ConversionOutcome> {
  const work = await mkdtemp(join(tmpdir(), 'ada-remediate-'));
  const source = `${work}/${requestId}.${kind}`;
  const output = `${work}/${requestId}.pdf`;

  try {
    await writeFile(source, bytes);

    const result = await convertSourceToPdf(source, output, options);
    if (!result.ok) {
      logWarn('document_remediation_failed', { requestId, failure: result.failure.kind });
      return {
        ok: false,
        refusal: { status: 422, error: 'remediation_failed', detail: result.failure.kind },
      };
    }

    const pdf = await readFile(output);
    return { ok: true, pdf, summary: summarise(result.provenance) };
  } finally {
    // Every path, including a throw inside the conversion. `convertSourceToPdf`
    // cleans its own working directory; this is ours.
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * JSON with every non-ASCII character `\u`-escaped, so it can live in an HTTP
 * header. Header values are ByteStrings: the `Response` constructor throws on
 * a code point above U+00FF, so a title with an em-dash — municipal agendas
 * have them — would turn a successful conversion into a 500 at the very last
 * step. Escaping keeps the value both valid JSON and pure ASCII; surrogate
 * halves escape separately, which is exactly the JSON escape form for
 * characters outside the BMP.
 */
export function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/**
 * The response both conversion routes return: the remediated bytes, with the
 * summary riding in a header so a single request yields both the file and the
 * account of it.
 */
export function remediationResponse(outcome: {
  pdf: Buffer;
  summary: RemediationSummary;
  requestId: string;
}): Response {
  return new Response(new Uint8Array(outcome.pdf), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      // A generated name, for the same reason the temp path is generated.
      'content-disposition': `attachment; filename="remediated-${outcome.requestId}.pdf"`,
      'x-remediation-summary': asciiJson(outcome.summary),
      'x-request-id': outcome.requestId,
    },
  });
}
