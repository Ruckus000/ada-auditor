/** Public delivery state, deliberately independent of private artifact records. */
export type DeliveryRow = {
  documentId: string; url: string; reason: string | null; excluded: boolean;
  exclusionReason?: string; signedOff: boolean; delivered: boolean; eligible: boolean;
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
export function deliveryError(code: string, requestId?: string): string {
  const messages: Record<string, string> = {
    document_changed: 'The documents changed. Refresh and review the current evidence before trying again.',
    signoff_not_eligible: 'This output is not eligible. Apply outstanding answers and verify the remediated file first.',
    artifact_not_stored: 'An evidence file is unavailable. Remediate again to retain the output and verification.',
    artifact_hash_mismatch: 'An evidence file does not match its recorded identity. Read and remediate it again.',
    bundle_too_large: 'This selection exceeds the bundle limit. Split it into smaller deliveries.',
    bundle_selection_invalid: 'Choose between 1 and 100 signed-off documents.',
    verification_unavailable: 'Verification could not establish eligibility. Try verification again before signing off.',
    unauthorized: 'Your session expired. Sign in again.',
    network: 'Could not reach the server. Check your connection and try again.',
  };
  return `${messages[code] ?? 'The action could not be completed. Refresh and try again.'} (${code}${requestId ? `; request ${requestId}` : ''})`;
}
