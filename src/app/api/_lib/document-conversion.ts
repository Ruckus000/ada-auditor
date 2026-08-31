import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  boundSummary,
  summarise,
  withConformance,
  withContrast,
  type Conformance,
  type RemediationSummary,
} from '../../../domain/document-remediation';
import { contentChanges, type DocumentStructure } from '../../../domain/document-structure';
import { convertSourceToPdf, type ConvertOptions } from '../../../integrations/documents/convert';
import { measureContrast } from '../../../integrations/documents/contrast';
import { finishDocument, type FinishRequest } from '../../../integrations/documents/finish';
import { inspectDocument } from '../../../integrations/documents/inspect';
import { checkUa1 } from '../../../integrations/documents/verapdf';
import { logWarn } from '../../../services/logger';
import { planRepair } from '../../../services/document-repair';
import type { UploadRefusal } from './document-upload';

/**
 * Write the PDF/UA-1 identifier only onto a document that earned it.
 *
 * The identifier is an assertion of conformance, and the stage that writes it
 * runs BEFORE the checker that could justify it. Written unconditionally, 49 of
 * 68 documents in the blind corpus asserted PDF/UA-1 in their own XMP while our
 * own verdict beside them said they did not conform. Downstream, the bytes win.
 *
 * So the file is finished without the claim and then measured. Withholding it
 * costs exactly one clause — `5-1`, "the document does not carry the PDF/UA
 * identifier" — and nothing else: measured on a conformant document, removing
 * the identifier turns `compliant: true, []` into `compliant: false, ['5-1']`.
 * That makes the inverse test exact rather than approximate: if `5-1` is the
 * ONLY thing failing, the identifier is the only thing missing, and writing it
 * is a true claim.
 *
 * The stamped file is built beside the honest one and moved into place only
 * after it re-validates. A second pass that failed halfway would otherwise
 * leave a corrupt document where a correct one had been, and the correct one is
 * always the better thing to deliver.
 *
 * The returned verdict always describes the bytes on disk when this returns —
 * which is what keeps an independent reading of the delivered file in agreement
 * with the report travelling beside it.
 */
async function earnUaIdentifier(
  verdict: Conformance,
  request: FinishRequest,
  /** The structure of the unstamped file, to prove the stamp moved nothing. */
  unstamped: DocumentStructure,
  stageOptions: Parameters<typeof finishDocument>[1],
  checkOptions: Parameters<typeof checkUa1>[1],
): Promise<Conformance> {
  if (verdict.checker !== 'verapdf-ua1' || verdict.compliant) return verdict;
  const onlyIdentifierMissing =
    verdict.failingClauses.length === 1 && verdict.failingClauses[0].startsWith('5-1');
  if (!onlyIdentifierMissing) return verdict;

  // The extension matters: veraPDF exits 4 on a file that does not end `.pdf`,
  // and this helper's own guard would then read that as "the identifier did not
  // work" and silently discard every stamp. It did exactly that, and the run
  // still passed — no answer key asserts conformance, so nothing noticed the
  // product had stopped being able to certify anything at all.
  const staged = request.outputPath.replace(/\.pdf$/i, '') + '-ua.pdf';
  const stamped = await finishDocument(
    { ...request, outputPath: staged, claimUa1: true },
    stageOptions,
  );
  if (!stamped.ok) {
    // Safe direction — an unstamped honest file beats a stamped one we cannot
    // vouch for — but never a quiet one. A silent bail-out here is how the
    // product lost the ability to certify anything and still ran green.
    logWarn('document_identifier_not_earned', { step: 'finish', failure: stamped.failure.kind });
    await rm(staged, { force: true });
    return verdict;
  }

  // The stamped file is a SECOND Finish pass, and it is the one that ships. The
  // content gate that ran on the unstamped file proves nothing about it, so it
  // is proven here instead — otherwise the only documents delivered without a
  // fidelity check would be the ones certified as conformant. Applies to both
  // lanes: the Word path has no `contentChanges` gate of its own at all.
  const restamped = await inspectDocument(staged, stageOptions);
  const moved = restamped.ok ? contentChanges(unstamped, restamped.value) : ['unreadable'];
  if (moved.length > 0) {
    logWarn('document_identifier_not_earned', { step: 'fidelity', fields: moved });
    await rm(staged, { force: true });
    return verdict;
  }

  const rechecked = await checkUa1(staged, checkOptions);
  if (rechecked.checker !== 'verapdf-ua1' || !rechecked.compliant) {
    // The identifier did not do what the clause said it would. Keep the file we
    // can defend, and report what it actually is — loudly, because this means a
    // document that should have been certifiable was not.
    logWarn('document_identifier_not_earned', {
      step: 'recheck',
      checker: rechecked.checker,
      ...(rechecked.checker === 'verapdf-ua1' && !rechecked.compliant
        ? { clauses: rechecked.failingClauses }
        : {}),
    });
    await rm(staged, { force: true });
    return verdict;
  }

  await rename(staged, request.outputPath);
  return rechecked;
}

/**
 * Contrast on the delivered bytes, folded in when the pass could run.
 *
 * Never refuses. Contrast is a source-design problem this pipeline cannot fix —
 * changing a client's colours is changing their design — so the commitment was
 * "detected and flagged", not "repaired". It is also the one detector with a
 * known false-positive class, decorative text being indistinguishable from a
 * running head, and a refusal on a false positive costs the client the document.
 *
 * A stage that cannot run leaves the field absent, which every surface renders
 * as "not checked" rather than clean.
 */
async function withMeasuredContrast(
  summary: RemediationSummary,
  pdfPath: string,
  stageOptions: Parameters<typeof measureContrast>[1],
): Promise<RemediationSummary> {
  const reading = await measureContrast(pdfPath, stageOptions);
  if (!reading.ok) {
    logWarn('document_contrast_not_measured', { failure: reading.failure.kind });
    return summary;
  }
  return withContrast(summary, reading.value);
}

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

    // The second instrument, on the delivered bytes. `checker: 'none'` on a
    // host without it — visible as "not checked", never as clean.
    const checkOptions = {
      ...(options.root === undefined ? {} : { root: options.root }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.javaRuntime === undefined ? {} : { runtime: options.javaRuntime }),
    };
    const stageOptions = {
      ...(options.javaRuntime === undefined ? {} : { runtime: options.javaRuntime }),
      ...(options.root === undefined ? {} : { root: options.root }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    };
    // Re-finished from the converted file rather than the source: everything
    // else is already written, and the only thing this pass adds is the claim.
    const { title, sourceLanguage } = result.provenance;
    const conformance = await earnUaIdentifier(
      await checkUa1(output, checkOptions),
      {
        inputPath: output,
        outputPath: output,
        language: sourceLanguage,
        ...(title.kind === 'no-heading-to-copy' ? {} : { title: title.title }),
      },
      result.provenance.structure,
      stageOptions,
      checkOptions,
    );
    // Read after the decision, so the verdict describes these exact bytes.
    const pdf = await readFile(output);
    const summary = await withMeasuredContrast(
      withConformance(summarise(result.provenance), conformance),
      output,
      stageOptions,
    );
    return { ok: true, pdf, summary };
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

    const finishRequest = {
      inputPath: source,
      outputPath: output,
      language: decision.plan.language,
      ...(decision.plan.title.kind === 'no-heading-to-copy'
        ? {}
        : { title: decision.plan.title.title }),
    };
    // Written WITHOUT the PDF/UA-1 identifier, because at this point nobody
    // knows whether the claim would be true. It is earned back below.
    const finished = await finishDocument({ ...finishRequest, claimUa1: false }, stageOptions);
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

    const checkOptions = {
      ...(options.root === undefined ? {} : { root: options.root }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.javaRuntime === undefined ? {} : { runtime: options.javaRuntime }),
    };
    const conformance = await earnUaIdentifier(
      await checkUa1(output, checkOptions),
      finishRequest,
      after.value,
      stageOptions,
      checkOptions,
    );
    // Read AFTER the identifier decision, and after the re-check. The verdict
    // this function returns has to describe the bytes it returns beside it: an
    // independent checker reading the delivered file must reach the same list,
    // or the report and the document disagree about the same document.
    const pdf = await readFile(output);
    const summary = await withMeasuredContrast(
      withConformance(
        summarise({
          title: decision.plan.title,
          sourceLanguage: decision.plan.language,
          structure: after.value,
        }),
        conformance,
      ),
      output,
      stageOptions,
    );
    return { ok: true, pdf, summary };
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
  // Bounded HERE rather than where the summary is built, because the limit is a
  // property of this transport and not of the vocabulary: the same summary
  // handed to any other consumer should be whole. `asciiJson` is the measure
  // because it is the encoding that actually goes on the wire — a title with an
  // em-dash costs six bytes there and one in `JSON.stringify`.
  const summary = boundSummary(outcome.summary, (value) => asciiJson(value).length);

  return new Response(new Uint8Array(outcome.pdf), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      // A generated name, for the same reason the temp path is generated.
      'content-disposition': `attachment; filename="remediated-${outcome.requestId}.pdf"`,
      'x-remediation-summary': asciiJson(summary),
      'x-request-id': outcome.requestId,
    },
  });
}
