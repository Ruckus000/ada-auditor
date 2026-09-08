/** Converts common platform error codes into a sentence an operator can act on. */
const COPY: Record<string, string> = {
  unauthorized: 'Your session expired. Sign in again, then retry.',
  client_not_found: 'This client is no longer available. Refresh the page.',
  journey_not_found: 'This audit plan is no longer available. Refresh the page.',
  report_not_found: 'This report link is no longer available. Refresh the page.',
  invalid_request_body: 'Some information was missing or invalid. Check the form and try again.',
  action_not_allowed_here: 'This action is not allowed in the selected environment.',
  invalid_journey_steps: 'These saved steps cannot run. Check them and try again.',
  journey_has_no_steps: 'Add at least one step before saving this audit plan.',
  journey_not_runnable: 'Add a website address before running this audit plan.',
};

export function describePlatformError(code: string | undefined, status?: number): string {
  if (code && Object.hasOwn(COPY, code)) return COPY[code];
  return status ? `The change could not be saved (error ${status}). Try again.` : 'The change could not be saved. Try again.';
}
