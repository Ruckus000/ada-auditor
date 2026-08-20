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
 * The same reduction, applied to URLs found *inside* a message.
 *
 * `settledLocation` assumes the whole string is a URL, which is true when the
 * runner composes the sentence and interpolates `page.url()` itself. It is not
 * true of the other half of the runner's failures: `attemptStep` builds its
 * sentence from `error.message.split('\n')[0]`, and Chromium's navigation
 * errors carry the destination in that line — `net::ERR_ABORTED at
 * https://client.example/callback?code=…`. A click wraps its navigation
 * settle, so that line lands in a *click*'s failure message.
 *
 * That mattered more than it looks. The sentence matches the anchor
 * `classifyRunFailure` keys on, so it was echoed to the operator as `detail`
 * by the journey preview route, and written verbatim into the structured log
 * by `audit-run-handler`. The `expect` path had been sanitised for precisely
 * this reason and its twin never was, which is the failure mode of guarding a
 * value at one call site instead of at the thing that formats it.
 *
 * Prose is preserved. An operator fixing a stale selector needs Playwright's
 * sentence; they do not need the query string in it.
 */
const URL_IN_TEXT = /\b(?:https?|file):\/\/[^\s"'<>]+/gi;

/** Punctuation that ends the runner's sentence rather than the site's URL. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

export function withUrlsReduced(text: string): string {
  return text.replace(URL_IN_TEXT, (raw) => {
    // A URL at the end of the interpolated part is followed by the template's
    // own full stop. Swallowed into the match, `new URL` parses it as the last
    // character of the path and prints it back inside the reduced URL.
    const trailing = raw.match(TRAILING_PUNCTUATION)?.[0] ?? '';
    const url = trailing ? raw.slice(0, -trailing.length) : raw;
    return `${settledLocation(url)}${trailing}`;
  });
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
