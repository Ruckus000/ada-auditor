/** Public delivery state, deliberately independent of private artifact records. */
export type DeliveryRow = {
  documentId: string; url: string; reason: string | null; excluded: boolean;
  exclusionReason?: string; signedOff: boolean; delivered: boolean; eligible: boolean;
  /** The state this row was shown in; a sign-off must name it. */
  fingerprint: string;
  /** Fidelity items that travel with the file. Count-only sentences. */
  knownDifferences: Array<{criterion: string; detail: string}>;
};
export type DeliveryQueue = 'all' | 'work' | 'signoff' | 'delivery' | 'delivered' | 'excluded';
export function inDeliveryQueue(row: DeliveryRow, queue: DeliveryQueue): boolean {
  if (queue === 'all') return true;
  if (queue === 'excluded') return row.excluded;
  if (row.excluded) return false;
  if (queue === 'delivered') return row.delivered;
  if (queue === 'delivery') return row.eligible && row.signedOff && !row.delivered;
  if (queue === 'signoff') return row.eligible && !row.signedOff;
  return !row.eligible;
}
export function selectableForDelivery(row: DeliveryRow): boolean {
  return row.eligible && row.signedOff && !row.excluded;
}
/** A refused or failed response, as the panel received it. */
export type DeliveryRefusal = { error?: string; message?: string; status?: number };

/**
 * Why a delivery action did not happen, in words an operator can act on.
 *
 * A `switch`, never an object lookup, for the reason `discovery-copy.ts`
 * records: the code arrives off a parsed JSON body, and `__proto__` looked up
 * on an object literal resolves to something that is not a sentence. This was
 * a `Record` with nine entries; the doors send twenty-one codes, so most fell
 * through to "Refresh and try again" with the raw code and a request id
 * appended — "try again" on refusals that repeating cannot change.
 *
 * "Try again" appears only where repeating can change the answer. Where the
 * state that refused is still there, the sentence says what to change instead.
 * `tests/services/document-delivery-presentation.test.ts` reads every code off
 * the routes and holds each one to a sentence here.
 */
export function deliveryError(refusal: DeliveryRefusal): string {
  switch (refusal.error) {
    case 'unauthorized':
      return 'Your session has ended. Sign in again and retry.';
    case 'operator_required':
      return 'Only a signed-in operator can do this. A machine token cannot sign off, exclude or deliver.';
    case 'invalid_request_body':
      return 'The server did not accept the shape of that request. Reload the page, then do it again.';
    case 'client_not_found':
      return 'This client no longer exists.';
    case 'document_not_found':
      return 'That document is no longer in this client\'s inventory. Refresh to see what is.';
    case 'exclusion_not_found':
      return 'That document is not excluded any more, so there was nothing to reopen. Refresh to see its state.';
    case 'inventory_incomplete':
      return 'The inventory could not be read to the end, so nothing was changed. Refresh and try again.';
    case 'document_changed':
      // Two situations share this code. A sign-off or exclusion saw an older
      // state than the one now stored: refreshing and acting again works. A
      // bundle is issued only against the revision it was prepared at, and any
      // sign-off, exclusion or crawl since moves that on for good: refreshing
      // and issuing again refuses forever, so the sentence names the way out.
      return 'The documents changed after this was shown or prepared, so nothing was recorded. Refresh and review what is current. A bundle prepared before the change cannot be issued; prepare a new bundle.';
    case 'signoff_not_eligible':
      return 'An output is not eligible: it must be verified, have no open gaps, have its answers applied and not be excluded, and a bundle takes only signed-off outputs. Refresh to see what it still needs.';
    case 'verification_unavailable':
      return 'veraPDF did not confirm the stored output, so nothing was signed. Remediate the document again, then sign off.';
    case 'artifact_not_stored':
      // Thrown when a file was never stored, when storing the bundle ZIP or a
      // verification report failed — usually the store being briefly
      // unavailable — and when a bundle's own ZIP cannot be read back.
      return 'A file this needs could not be stored or read, so nothing was recorded. Try again; if it repeats, remediate the document to store its output again, or prepare a new bundle.';
    case 'artifact_hash_mismatch':
      return 'A stored file no longer matches the fingerprint recorded for it, so it was not used. Remediate the document again, or prepare a new bundle if the file was the bundle\'s own.';
    case 'bundle_too_large':
      // Also thrown at sign-off, for a single output over the limit.
      return 'The files are over the 100 MB delivery limit. Deliver the selection as smaller bundles; a single output over the limit cannot be delivered here.';
    case 'bundle_selection_invalid':
      return 'Choose between 1 and 100 documents, each once.';
    case 'duplicate_delivery_output':
      return 'Two chosen rows deliver the same output file. Keep one of them in the selection.';
    case 'work_log_too_large':
      return 'The activity log for this selection is too long for one bundle. Deliver it as smaller bundles.';
    case 'delivery_not_found':
      return 'That bundle is no longer on record for this client. Refresh to see the current bundles.';
    case 'delivery_revoked':
      return 'This bundle\'s link was revoked, and a revoked bundle is not issued again. Prepare a new bundle.';
    case 'delivery_not_issued':
      return 'This bundle was never issued, so there is no link to revoke.';
    case 'delivery_failed':
      return 'The server failed partway and did not say why. Refresh to see whether anything changed before doing it again.';
    case 'document_budget_exceeded':
      // A spent budget is an answer, not a failure: the route's sentence says
      // when the window resets.
      return refusal.message ?? 'Document work is capped for now and this window is spent. Try again once the window resets.';
    case undefined:
      // A status with no code is a response that was not ours to shape — a
      // platform 502, an HTML error page. The server was reached, so whatever
      // was asked may have happened.
      if (refusal.status !== undefined) {
        return `The server answered http ${refusal.status} without saying why. Refresh to see whether it took effect.`;
      }
      return 'The server could not be reached. Once the connection is back, refresh to see whether it took effect.';
    default:
      // A code with no entry is one the routes grew and this did not. Printing
      // it is ugly and true; inventing a sentence for it is neither.
      return `The action stopped: ${refusal.error}.`;
  }
}
