/**
 * Why a document action did not deliver, in words an operator can act on.
 *
 * The screen used to print the code — `repair_refused`, `content-changed`,
 * `document_toolchain_unavailable` — in a `role="alert"` paragraph. Each code
 * the three document routes and their shared cores can answer with gets one
 * sentence and one next step, and every next step is doable from this screen:
 * none sends anyone to a log they cannot open.
 *
 * A `switch`, never an object lookup, for the reason `discovery-copy.ts`
 * records: these codes arrive off a parsed JSON body, and `__proto__` looked
 * up on an object literal resolves to something truthy and not a string.
 *
 * `message` is the route's own prose where it has one — the repair refusals
 * already say what is in the way — and this adds only what to do next.
 */
export type DocumentRefusal = {
  error?: string;
  detail?: string;
  message?: string;
  status?: number;
};

const TRY_AGAIN = 'Run it again; if it repeats, this document needs a person.';

function remediationStep(detail: string | undefined): string {
  const [kind, step] = (detail ?? '').split('/');
  switch (kind) {
    case 'converter-failed':
    case 'no-output':
      switch (step) {
        case 'source-to-fodt':
        case 'fodt-to-pdf':
          return 'LibreOffice could not open or export this file. Open it in Word and save it again as .docx, then convert that.';
        case 'finish':
          return `Our own finishing stage refused the converted file. ${TRY_AGAIN}`;
        case 'verify':
          return `The converted file could not be read back. ${TRY_AGAIN}`;
        default:
          return `The converter stopped. ${TRY_AGAIN}`;
      }
    case 'not-tagged':
      return 'The conversion produced no structure tree — an untagged file, which nothing here would deliver. Check the source opens as a real Word document.';
    case 'unavailable':
      return 'This deployment has no converter. Nothing here is wrong with the document.';
    default:
      return `The conversion stopped. ${TRY_AGAIN}`;
  }
}

function repairStep(detail: string | undefined): string {
  switch (detail) {
    case 'content-changed':
      return 'The repair moved content it was only meant to label, so the original was kept and nothing was delivered. Run it again; if it repeats, this document needs a person.';
    case 'invalid-language':
      return 'The language this document declares is not a usable tag, and nothing here guesses one. Name the language in its answers and run it again.';
    case 'unavailable':
      return 'This deployment has no document toolchain. Nothing here is wrong with the document.';
    case 'failed':
    case 'invalid-output':
    default:
      return 'The reading stopped partway — the file may be damaged. Open it locally; if it opens, run it again.';
  }
}

export function describeDocumentRefusal(refusal: DocumentRefusal): string {
  switch (refusal.error) {
    case 'unauthorized':
      return 'Your session has ended. Sign in again and retry.';
    case 'client_not_found':
      return 'This client no longer exists.';
    case 'expected_json_body':
    case 'invalid_request_body':
    case 'expected_multipart_form_data':
    case 'missing_file_field':
      return 'The request was not in the shape the server accepts. Reload the page and try again.';
    case 'document_too_large':
      return 'The file is larger than the limit this deployment accepts. Ask the client for a smaller export, or split it.';
    case 'unsupported_document':
      return 'That is not a PDF or Word document. If you have the file, add it by upload.';
    case 'invalid_url':
      return 'That is not a web address. Paste the full https:// link to the document.';
    case 'unsafe_url':
      return 'That address points somewhere this server refuses to fetch from — a private or local host. If you have the file, add it by upload.';
    case 'fetch_failed':
      return 'The document could not be fetched from that address. Check it opens in a browser; if you have the file, add it by upload.';
    case 'redirected':
      return 'That address redirects elsewhere, and redirects are not followed. Paste the address it redirects to.';
    case 'document_toolchain_unavailable':
      return 'This deployment has no document toolchain, so nothing here can read a PDF. Nothing is wrong with the document.';
    case 'converter_unavailable':
      return 'This deployment has no LibreOffice, so Word documents cannot be converted here. Nothing is wrong with the document.';
    case 'inspect_failed':
      return repairStep(refusal.detail);
    case 'remediation_failed':
      return remediationStep(refusal.detail);
    case 'repair_failed':
      return repairStep(refusal.detail);
    case 'repair_refused':
      return `${refusal.message ?? 'This PDF cannot be repaired here'}. Mark it requested from the client below, and attach the new file when it arrives.`;
    case 'conversion_not_found':
      return 'That delivered file is no longer on record.';
    case 'artifact_not_stored':
      return 'The delivered file was never stored — no file store was configured when it was made. Run it again to store this one.';
    case 'document_budget_exceeded':
      // The route's sentence names the ceiling and says when it resets.
      return (
        refusal.message ??
        'Document work is capped for now and this window is spent. Try again later — the hourly ceiling resets on the hour.'
      );
    case undefined:
      return `The action stopped: http ${refusal.status ?? 0}.`;
    default:
      // A code with no entry here is one the routes grew and this map did not.
      // Printing it is ugly and true; inventing a sentence for it is neither.
      return `The action stopped: ${refusal.error}.`;
  }
}
