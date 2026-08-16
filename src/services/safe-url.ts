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
