import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, createNonce } from './app/api/_lib/csp';

/**
 * Security response headers, and the per-request nonce the CSP is built around.
 *
 * The one thing in this file that is not obvious: the nonce is set on the
 * **request** headers as well as the response. That is how Next learns it —
 * during render it reads the CSP off the incoming request, extracts
 * `'nonce-…'`, and attaches it to the framework scripts, the page bundles and
 * its own inline scripts. Nothing in `app/` has to know this exists.
 *
 * `proxy.ts` rather than `middleware.ts`: Next 16 renamed the convention, and
 * it lives in `src/` because that is where `app/` is.
 *
 * ## The policy is not here
 *
 * `buildCsp` is a pure function in `app/api/_lib/csp.ts` so the fast unit suite
 * can assert on the policy without importing `next/server`. This file is the
 * edge: mint, set, done.
 *
 * ## What this deliberately does not cover
 *
 * `/api` is excluded by the matcher, and that is load-bearing rather than an
 * optimisation. The artifacts route serves DOM snapshots captured from a
 * client's site under its own `Content-Security-Policy: sandbox`, which is a
 * far stricter policy than this one — overwriting it with a page policy would
 * turn the hostile-markup route into the permissive one.
 */

export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp(nonce, process.env.NODE_ENV === 'development');

  // Read by Next during render to find the nonce, and available to a Server
  // Component through `headers()` if one ever needs to nonce a tag itself.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set('content-security-policy', csp);
  // Not expressible in a CSP, and both cheap. `nosniff` stops a response whose
  // body a client controls from being re-interpreted as script; the referrer
  // policy keeps `/r/<token>` from putting a live share token in a `Referer`
  // if that page ever grows an outbound link.
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');

  return response;
}

export const config = {
  matcher: [
    {
      /**
       * Everything except the API, Next's own static output, and the favicon.
       *
       * `api` first because of the sandbox note above. `_next/static` and
       * `_next/image` carry no HTML and no scripts of ours to nonce.
       */
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      /**
       * Prefetches are skipped. A prefetch is not a document render, so the
       * nonce it would carry belongs to no page — and paying for one on every
       * `next/link` in view is cost for nothing.
       */
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
