/**
 * What to call a page's evidence, in words that say which problem it has.
 *
 * `evidenceStatus` is one word for two different failures. A page missing a
 * screenshot and a page that came back 500 both read `degraded`, and they need
 * different people to do different things: one is our capture breaking, the
 * other is the client's site returning an error. Printing the status alone
 * repeats the mistake the phase before this one fixed — `failureReason` was
 * stored, classified and read by nothing, so every failure rendered `?
 * INCONCLUSIVE` and told an operator nothing they could act on.
 *
 * One function rather than three, because three screens show this — the
 * console, the platform client page and the public share page — and a phrase
 * duplicated three ways is three chances to describe the same state
 * differently. It is a pure string helper with no React in it, so all three
 * can reach it and the fast unit suite can test it.
 */

/**
 * A status code is only worth printing when it explains something.
 *
 * A code beside "complete" is noise: `createEvidenceBundle` only calls a page
 * complete when the status is under 400, so the number cannot be telling the
 * reader anything they do not already have from the word. (Under 400, not
 * exactly 200 — an unfollowed 3xx is complete too.) The code earns its place
 * exactly when it is the reason the page cannot be judged.
 */
export function describePageEvidence(evidenceStatus: string, statusCode?: number): string {
  if (evidenceStatus === 'complete') return 'evidence complete';

  // Absent is not 200 and not an error: a `file://` run has no HTTP status,
  // and neither has any page recorded before the status column existed. Those
  // pages are degraded for the older reason, so say that rather than inventing
  // a code to blame.
  if (statusCode === undefined) return `evidence ${evidenceStatus}`;

  if (statusCode >= 400) return `served ${statusCode} — not usable as evidence`;

  // Degraded despite an ordinary status: the capture is what failed, not the
  // page. Saying so stops an operator hunting for a server problem that is not
  // there.
  return `evidence ${evidenceStatus} (page returned ${statusCode})`;
}
