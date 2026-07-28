/**
 * CSRF guard shared by the console routes.
 *
 * Lives here rather than in a route module so that importing it does not drag
 * that route's dependency graph along: /api/audit/console pulls in the audit
 * handler and, through it, Playwright, which has no business being loaded by
 * the session endpoint.
 *
 * This is CSRF defence only. `sec-fetch-site` and `Origin` are set by browsers
 * and cannot be overridden by page scripts, but any non-browser client sets
 * them freely, so this must never be the only gate on a sensitive route.
 */
export function isSameOriginConsoleRequest(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'same-origin') {
    return true;
  }

  const origin = request.headers.get('origin');
  if (!origin) {
    return false;
  }

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

/**
 * True when the browser reached us over https, accounting for TLS-terminating
 * proxies that forward internally over plain http.
 */
export function isSecureRequest(request: Request): boolean {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0]!.trim().toLowerCase() === 'https';
  }
  return request.url.startsWith('https://');
}
