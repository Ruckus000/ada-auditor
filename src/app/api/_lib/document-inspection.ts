import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  isPdf,
  isPlaceholderTitle,
  isWordDocument,
  summarise,
  withConformance,
  withExcerpt,
  withRepairability,
} from '../../../domain/document-remediation';
import type { RemediationSummary } from '../../../domain/document-remediation';
import { inspectDocument } from '../../../integrations/documents/inspect';
import { checkUa1 } from '../../../integrations/documents/verapdf';
import { planRepair } from '../../../services/document-repair';
import { logWarn } from '../../../services/logger';
import { fetchDocumentBytes } from './document-fetch';
import type { UploadRefusal } from './document-upload';

/**
 * The inspection core two routes share.
 *
 * `/api/documents/inspect-url` is the client-unscoped tool; the client-scoped
 * `POST /api/platform/clients/<id>/documents` performs the same inspection and
 * then persists it. The guarded fetch itself lives in `document-fetch.ts`,
 * shared with the conversion route — its header records the order that
 * matters and what honestly is not closed.
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
      // A placeholder reads as no title here too. An inspection that reported
      // "Microsoft Word - Document1.docx" as `already-titled` would tell an
      // operator there is no title work to do, and then the repair of the same
      // file would replace it — two surfaces disagreeing about one document,
      // which is the failure `presentation/verdict.ts` exists to prevent.
      title:
        result.value.title === null || isPlaceholderTitle(result.value.title)
          ? { kind: 'no-heading-to-copy' }
          : { kind: 'already-titled', title: result.value.title },
      sourceLanguage: result.value.lang,
      structure: result.value,
    });

    // The second instrument reads the same temp file the first did. Then the
    // repair decision, so a signed or untagged PDF is on the record from its
    // first reading rather than at the moment somebody clicks Repair — and
    // the excerpt, so the operator who answers a figure sees its context.
    return {
      ok: true,
      summary: withExcerpt(
        withRepairability(
          withConformance(summary, await checkUa1(source)),
          planRepair(result.value, undefined),
        ),
        result.value,
      ),
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Fetches a document from where it lives and inspects it. */
export async function fetchAndInspectDocumentUrl(
  url: string,
  requestId: string,
): Promise<InspectionOutcome> {
  const fetched = await fetchDocumentBytes(url, requestId, {
    accept: isPdf,
    acceptHeader: 'application/pdf,*/*',
  });
  if (!fetched.ok) {
    return fetched;
  }

  return inspectPdfBytes(fetched.bytes, requestId, 'ada-inspect-url-');
}

export type ClassifiedDocumentFetch =
  | { ok: true; bytes: Buffer; kind: 'pdf' | 'docx' | 'doc' }
  | { ok: false; refusal: UploadRefusal };

/**
 * One guarded fetch, either container accepted — for the route that catalogs
 * whatever a URL turns out to be. The extension is not consulted at all:
 * municipal sites serve documents from extensionless download endpoints, and
 * the bytes in hand are the only honest classifier. Anything that is neither
 * container refuses 415 through the shared check, exactly as the
 * single-container paths do.
 */
export async function fetchAndClassifyDocumentUrl(
  url: string,
  requestId: string,
): Promise<ClassifiedDocumentFetch> {
  const fetched = await fetchDocumentBytes(url, requestId, {
    accept: (bytes) => {
      const pdf = isPdf(bytes);
      return pdf.ok ? pdf : isWordDocument(bytes);
    },
    acceptHeader:
      'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,*/*',
  });
  if (!fetched.ok) {
    return fetched;
  }
  return { ok: true, bytes: fetched.bytes, kind: fetched.kind as 'pdf' | 'docx' | 'doc' };
}
