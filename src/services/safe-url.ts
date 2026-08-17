/**
 * A URL reduced to what is safe to put in a message: origin and path.
 *
 * The query and fragment of the page a journey came to rest on are exactly
 * where a session token lives — an SSO `?code=`, a magic link, a
 * password-reset token. The runner's `expect` failure names where the page
 * actually was, that message reaches the structured log verbatim, and none of
 * the discarded part is anything an operator acts on: "it was at /login, not
 * /dashboard" is the whole diagnostic and it survives intact.
 *
 * In `services` rather than beside the runner that calls it, so the fast unit
 * suite can test it — anything imported from `integrations/browser` drags
 * `playwright-core` in with it.
 */
export function settledLocation(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    // `protocol` + `host`, not `origin`. For a `file:` URL `origin` is the
    // *string* "null", so building from it printed `null/tmp/fixtures/...` —
    // and a fixture run is what every browser-suite journey settles on, so
    // that would have been the common case rather than the odd one. `host` is
    // empty for `file:`, which gives back the `file://` the protocol needs,
    // and carries the port for everything else.
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    // Never the raw input. An unparseable URL is the case where guessing which
    // part is safe to print is least defensible.
    return '(unparseable URL)';
  }
}

/**
 * Just the host, for the times when even the path is more than is wanted.
 *
 * The runner logs a line each time a journey passes through a host it is not
 * auditing, and the pass-through host in an SSO flow is the one whose URLs
 * carry the authorization code — in the query on the way out and, for some
 * providers, in the path on the way back. The only thing that line is for is
 * naming *which* host, so nothing else needs to be in it.
 */
export function hostnameOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return '(unparseable URL)';
  }
}
