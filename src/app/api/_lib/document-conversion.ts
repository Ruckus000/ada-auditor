import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  summarise,
  withConformance,
  type RemediationSummary,
} from '../../../domain/document-remediation';
import { contentChanges } from '../../../domain/document-structure';
import { convertSourceToPdf, type ConvertOptions } from '../../../integrations/documents/convert';
import { finishDocument } from '../../../integrations/documents/finish';
import { inspectDocument } from '../../../integrations/documents/inspect';
import { checkUa1 } from '../../../integrations/documents/verapdf';
import { logWarn } from '../../../services/logger';
import { planRepair } from '../../../services/document-repair';
import type { UploadRefusal } from './document-upload';

/** What `repairPdfBytes` needs: the stage plumbing, plus the client-facing name. */
export type RepairOptions = Pick<ConvertOptions, 'javaRuntime' | 'root' | 'env' | 'timeoutMs' | 'sourceName'>;

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
    // The second instrument, on the delivered bytes. `checker: 'none'` on a
    // host without it — visible as "not checked", never as clean.
    const conformance = await checkUa1(output, {
      ...(options.root === undefined ? {} : { root: options.root }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.javaRuntime === undefined ? {} : { runtime: options.javaRuntime }),
    });
    return { ok: true, pdf, summary: withConformance(summarise(result.provenance), conformance) };
  } finally {
    // Every path, including a throw inside the conversion. `convertSourceToPdf`
    // cleans its own working directory; this is ours.
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Repair a PDF in place: write back what it already states, and nothing else.
 *
 * The sibling of `remediateWordBytes`, deliberately in the same file and the
 * same shape, because the routes offer them side by side and two files would
 * drift on the parts that must not differ — the temp-path rule, the refusal
 * shape, the cleanup.
 *
 * Four steps, and the fourth is the one that makes it safe to deliver:
 *
 * 1. read the document;
 * 2. decide what may be written (`planRepair` — untagged refuses here);
 * 3. write it (`Finish`, whose every key is a transcription);
 * 4. **read the result back and prove no content changed.** `contentChanges`
 *    compares headings, tables, lists, figures and reading order before and
 *    after. Repair adds catalog facts; if any of those moved, something
 *    inferred rather than transcribed, and the repair is discarded rather
 *    than delivered.
 */
export async function repairPdfBytes(
  bytes: Uint8Array,
  requestId: string,
  options: RepairOptions = {},
): Promise<ConversionOutcome> {
  const work = await mkdtemp(join(tmpdir(), 'ada-repair-'));
  const source = `${work}/${requestId}.pdf`;
  const output = `${work}/${requestId}-repaired.pdf`;
  const stageOptions = {
    ...(options.javaRuntime === undefined ? {} : { runtime: options.javaRuntime }),
    ...(options.root === undefined ? {} : { root: options.root }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };

  try {
    await writeFile(source, bytes);

    const before = await inspectDocument(source, stageOptions);
    if (!before.ok) {
      logWarn('document_repair_failed', { requestId, step: 'read', failure: before.failure.kind });
      return {
        ok: false,
        refusal: { status: 422, error: 'repair_failed', detail: before.failure.kind },
      };
    }

    const decision = planRepair(before.value, options.sourceName);
    if (!decision.repairable) {
      // Not an error: a true answer about this document. The operator screen
      // renders the reason, and the punch list is still delivered by the
      // inspection that produced it.
      logWarn('document_repair_refused', { requestId, reason: decision.refusal.kind });
      return {
        ok: false,
        refusal: {
          status: 422,
          error: 'repair_refused',
          detail: decision.refusal.kind,
          message: decision.refusal.reason,
        },
      };
    }

    const finished = await finishDocument(
      {
        inputPath: source,
        outputPath: output,
        language: decision.plan.language,
        ...(decision.plan.title.kind === 'no-heading-to-copy'
          ? {}
          : { title: decision.plan.title.title }),
      },
      stageOptions,
    );
    if (!finished.ok) {
      logWarn('document_repair_failed', { requestId, step: 'finish', failure: finished.failure.kind });
      return {
        ok: false,
        refusal: { status: 422, error: 'repair_failed', detail: finished.failure.kind },
      };
    }

    const after = await inspectDocument(output, stageOptions);
    if (!after.ok) {
      logWarn('document_repair_failed', { requestId, step: 'verify', failure: after.failure.kind });
      return {
        ok: false,
        refusal: { status: 422, error: 'repair_failed', detail: after.failure.kind },
      };
    }

    const changed = contentChanges(before.value, after.value);
    if (changed.length > 0) {
      // The claim this stage makes about itself, checked rather than trusted.
      // A metadata pass that moved content is not a repair, and the original
      // is better than a file we cannot vouch for.
      logWarn('document_repair_altered_content', { requestId, fields: changed });
      return {
        ok: false,
        refusal: { status: 422, error: 'repair_failed', detail: 'content-changed' },
      };
    }

    const pdf = await readFile(output);
    const conformance = await checkUa1(output, {
      ...(options.root === undefined ? {} : { root: options.root }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.javaRuntime === undefined ? {} : { runtime: options.javaRuntime }),
    });
    return {
      ok: true,
      pdf,
      summary: withConformance(
        summarise({
          title: decision.plan.title,
          sourceLanguage: decision.plan.language,
          structure: after.value,
        }),
        conformance,
      ),
    };
  } finally {
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
