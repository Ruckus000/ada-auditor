/**
 * The Content-Security-Policy this app serves, as a pure function.
 *
 * Pure and framework-free on purpose: `proxy.ts` imports `next/server`, and a
 * policy that could only be read back through a request object would be tested
 * by nothing in the fast suite. Same reasoning `services/safe-url.ts` states
 * for living outside `integrations/browser`, and it sits beside
 * `same-origin.ts`, the other pure HTTP-security helper.
 *
 * ## What this is defending
 *
 * This product renders untrusted strings by design. Every finding carries a
 * `message`, a `selector` and an `htmlSnippet` captured from a site under
 * audit, and a hostile page can put `<script>` or `<img onerror=…>` in any of
 * them. React escaping and `report-html.ts`'s single `escapeHtml` chokepoint
 * are the actual defence; this is the second line for the day one of them has
 * a hole.
 *
 * ## Two deviations from Next's documented example, both forced
 *
 * **`style-src` gets `'unsafe-inline'`, not the nonce.** The screens carry 394
 * inline `style={{…}}` props across 33 files. CSP's `style-src-attr` falls back
 * to `style-src`, and a nonce cannot be attached to a `style=""` attribute — so
 * the documented `style-src 'self' 'nonce-…'` would blank every screen in the
 * product. Rewriting 394 style props into CSS is a large diff for a small gain
 * once `script-src` carries no `'unsafe-inline'` and no `'unsafe-eval'`, which
 * is where XSS actually lives.
 *
 * **No `upgrade-insecure-requests`.** Vercel serves every deployment over
 * HTTPS and 308-redirects plain HTTP with no way to disable it, so the
 * directive would restate a guarantee the platform already makes.
 */

/**
 * `'unsafe-eval'` in development only.
 *
 * React uses `eval` in dev to rebuild server-side error stacks in the browser.
 * Neither React nor Next uses it in a production build, so shipping it would
 * hand an injected script the one primitive `strict-dynamic` is there to deny.
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  return [
    `default-src 'self'`,
    // `strict-dynamic` makes the nonce transitive: a script Next itself loaded
    // may load its own chunks, and nothing else may. It also makes any host
    // allowlist inert, which is the point — an allowlist is the part of a CSP
    // that quietly rots.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    // `data:` is load-bearing, not generous: the journey verifier renders its
    // screenshot from bytes already in memory as a data URI.
    `img-src 'self' blob: data:`,
    // `next/font/google` downloads its faces at build time and serves them from
    // this origin, so no font host belongs here.
    `font-src 'self'`,
    // Dev needs the HMR socket. Browsers disagree about whether `'self'` covers
    // `ws:`, and a policy that depends on that is one that breaks for somebody.
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // Clickjacking. The console has one-click destructive controls — revoke a
    // share token, dismiss a finding, start a run — and `/r/<token>` is a
    // client-facing document that should never appear inside someone's frame.
    `frame-ancestors 'none'`,
  ].join('; ');
}

/**
 * A fresh nonce, 128 bits, base64.
 *
 * Per request and unguessable, which is the whole property: a nonce an
 * attacker can predict is `'unsafe-inline'` spelled at greater length.
 * `crypto.getRandomValues` rather than `randomBytes` so this file stays free of
 * `node:` imports and testable anywhere.
 */
export function createNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}
