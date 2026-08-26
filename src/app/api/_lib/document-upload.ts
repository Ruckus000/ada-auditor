import type { UploadCheck } from '../../../domain/document-remediation';
import { authorizePrincipal } from './authorize';

/**
 * Everything two document endpoints must agree on before a file is trusted.
 *
 * There are two upload routes — one that converts a Word source, one that
 * inspects a PDF — and the failure this exists to prevent is them drifting:
 * two endpoints with two validations is how one of them ends up weaker, and
 * the weaker one is the one that gets found.
 *
 * The order below is the security-relevant part and is not cosmetic:
 *
 * 1. **Authorise first**, before a single byte is buffered. An unauthenticated
 *    caller must not be able to make this process hold 25MB of their choosing.
 * 2. **`Content-Length` next**, which is the cheap rejection. It can lie, so it
 *    is not the real check.
 * 3. **The toolchain**, because there is no point buffering a document this
 *    host cannot process.
 * 4. **The real size**, once the body is in hand — the check `Content-Length`
 *    could not be trusted to make.
 * 5. **The container shape**, last, because it is the only step that needs the
 *    bytes.
 */

/** 25MB. A municipal agenda is tens of kilobytes; this is a ceiling. */
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

export function maxDocumentBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.AUDITOR_MAX_DOCUMENT_BYTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_BYTES;
}

export type UploadRefusal = {
  status: number;
  error: string;
  detail?: string;
};

export type ReadUploadResult =
  | { ok: true; bytes: Uint8Array; kind: string }
  | { ok: false; refusal: UploadRefusal };

export type ReadUploadOptions = {
  /**
   * What this endpoint accepts, as the container check itself.
   *
   * Passed in rather than switched on a string, so adding a third document type
   * cannot forget to add a case here. `isWordDocument` and `isPdf` both fit.
   */
  accept: (bytes: Uint8Array) => UploadCheck;
  /**
   * Reasons this host cannot process the upload at all, evaluated in order and
   * reported as **503** rather than 500.
   *
   * Absence of a toolchain is a state, not an error: a deployment without
   * LibreOffice is not broken, it cannot do one thing. Each entry names its own
   * cause because the fixes differ — install a JDK, or install LibreOffice —
   * and one generic message would make a person guess.
   */
  requires?: { error: string; check: () => { available: true } | { available: false; reason: string } }[];
  env?: NodeJS.ProcessEnv;
};

export async function readDocumentUpload(
  request: Request,
  options: ReadUploadOptions,
): Promise<ReadUploadResult> {
  const refuse = (status: number, error: string, detail?: string): ReadUploadResult => ({
    ok: false,
    refusal: { status, error, detail },
  });

  if (!(await authorizePrincipal(request))) {
    return refuse(401, 'unauthorized');
  }

  const limit = maxDocumentBytes(options.env);

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    return refuse(413, 'document_too_large', `limit is ${limit} bytes`);
  }

  for (const requirement of options.requires ?? []) {
    const state = requirement.check();
    if (!state.available) {
      return refuse(503, requirement.error, state.reason);
    }
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse(400, 'expected_multipart_form_data');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return refuse(400, 'missing_file_field', 'expected a `file` part');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > limit) {
    return refuse(413, 'document_too_large', `limit is ${limit} bytes`);
  }

  // The tools cannot be trusted to reject a mislabelled file. `[V]` LibreOffice
  // sniffs content rather than trusting the extension, so a text file named
  // `.docx` converts successfully — a successful conversion is not evidence the
  // input was what it claimed. The gate is here, deliberately.
  //
  // It proves the container shape, not that the document is well-formed. That
  // is a gate against mislabelled input, not a scanner.
  const check = options.accept(bytes);
  if (!check.ok) {
    return refuse(415, 'unsupported_document', check.reason);
  }

  return { ok: true, bytes, kind: check.kind };
}

/** The refusal as a response, so a route does not restate the envelope. */
export function refusalResponse(refusal: UploadRefusal, requestId: string): Response {
  return Response.json(
    { error: refusal.error, detail: refusal.detail, requestId },
    { status: refusal.status },
  );
}
