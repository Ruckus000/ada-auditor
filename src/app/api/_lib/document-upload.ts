import type { UploadCheck } from '../../../domain/document-remediation';
import { authorizePrincipal } from './authorize';
import { documentBudgetRefusal } from './budget-refusal';

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
export const DEFAULT_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export function maxDocumentBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.AUDITOR_MAX_DOCUMENT_BYTES);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_DOCUMENT_BYTES;
}

export type UploadRefusal = {
  status: number;
  error: string;
  /** The machine-readable kind. Stable; screens and tests key on it. */
  detail?: string;
  /**
   * Prose for the operator, when the refusal is a true answer about the
   * document rather than a failure — "this PDF has no structure tree, so
   * there is nothing to transcribe". A kind alone tells somebody that
   * nothing happened; this tells them what to do instead.
   */
  message?: string;
};

export type ReadUploadResult =
  | {
      ok: true;
      bytes: Uint8Array;
      kind: string;
      /**
       * The upload's own name, verbatim. It is the only handle an upload has,
       * so the persisting route stores it — but it is caller-controlled, and
       * the standing rules still apply: it never reaches the filesystem (temp
       * files are named by request id) and never reaches a log line.
       */
      filename: string;
      /**
       * The inventory row this file is a new version OF, when the operator
       * said so. A client sends a re-signed or re-exported file back under
       * any name; without this the upload would mint a second row named
       * after the file and leave the first one asking forever. Caller-
       * controlled and unverified here — the persisting route checks it
       * belongs to the client.
       */
      documentId?: string;
      /**
       * A person's declared answers for these bytes, as the caller sent them
       * (the `answers` part, JSON text). Unparsed here: the route that runs
       * the pipeline validates the shape, because that is where the refusal
       * has a name. Bounded so a hostile part cannot make this hold more
       * than a page of descriptions.
       */
      answersJson?: string;
    }
  | { ok: false; refusal: UploadRefusal };

/**
 * The most an `answers` part may weigh, in UTF-8 bytes.
 *
 * Sized from the schema it carries, not from the sidecars seen so far:
 * `declaredAnswersSchema` allows five hundred figures of a thousand
 * characters each, which is ~564 KB in ASCII and ~1.5 MB in CJK. The old cap
 * was 64 KB measured in UTF-16 units — room for fifty-six descriptions, and
 * over-counting or under-counting by up to three times depending on the
 * script — and a part over it was dropped silently, so the run delivered a
 * file as if the person had said nothing. Two mebibytes fits the schema's own
 * maximum; the platform's 4.5 MB body ceiling sits above it.
 */
export const MAX_ANSWERS_BYTES = 2 * 1024 * 1024;

/** Ids are `doc-<clientId>-<uuid>`, under a hundred characters; this is a ceiling. */
const MAX_DOCUMENT_ID_CHARS = 128;

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
  /** For the budget refusal's log line, so it can be found with the request. */
  requestId?: string;
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

  // Second, and before `Content-Length` is even read: a caller past the
  // ceiling must not be able to make this process buffer a body on the way
  // to hearing no. After authorisation, so an unauthenticated caller cannot
  // spend it.
  const capped = await documentBudgetRefusal(options.requestId);
  if (capped) return { ok: false, refusal: capped };

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

  // The two optional parts are refused when out of bounds, never dropped. A
  // dropped `documentId` made the upload look like one sent without any and
  // minted a second row, leaving the row that asked forever asking; a dropped
  // `answers` delivered a file as if the person had said nothing. Absent is
  // fine; present and wrong is the caller's to hear about.
  const documentId = form.get('documentId');
  if (documentId !== null) {
    if (typeof documentId !== 'string' || documentId.length === 0 || documentId.length > MAX_DOCUMENT_ID_CHARS) {
      return refuse(400, 'invalid_document_id', `expected 1 to ${MAX_DOCUMENT_ID_CHARS} characters`);
    }
  }

  const answers = form.get('answers');
  if (answers !== null) {
    if (typeof answers !== 'string') {
      return refuse(400, 'invalid_answers', 'expected a text part');
    }
    if (Buffer.byteLength(answers, 'utf8') > MAX_ANSWERS_BYTES) {
      return refuse(413, 'answers_too_large', `limit is ${MAX_ANSWERS_BYTES} bytes`);
    }
  }

  return {
    ok: true,
    bytes,
    kind: check.kind,
    filename: file.name,
    ...(documentId === null ? {} : { documentId }),
    ...(answers === null ? {} : { answersJson: answers }),
  };
}

/** The refusal as a response, so a route does not restate the envelope. */
export function refusalResponse(refusal: UploadRefusal, requestId: string): Response {
  return Response.json(
    {
      error: refusal.error,
      detail: refusal.detail,
      ...(refusal.message === undefined ? {} : { message: refusal.message }),
      requestId,
    },
    { status: refusal.status },
  );
}
