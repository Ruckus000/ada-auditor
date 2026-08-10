import { cookies } from 'next/headers';
import { CONSOLE_COOKIE, isValidSessionValue } from './console-session';

/**
 * Whether this browser holds a valid operator session, for Server Components.
 *
 * `hasConsoleSession` reads a `Request`, which route handlers have and pages
 * do not. Same cookie, same signature, same token — the platform screens are
 * not a second authentication surface, they are the same one. Rotating
 * `AUDITOR_RUN_TOKEN` still invalidates every session everywhere.
 *
 * The platform UI was fully public until this existed: no cookie check, no
 * session, nothing. That was survivable while every screen showed fixtures and
 * indefensible the moment they show real client names and findings.
 */
export async function hasOperatorSession(): Promise<boolean> {
  const token = process.env.AUDITOR_RUN_TOKEN;
  if (!token) {
    // No token configured means nothing can be authenticated, so nothing is.
    // Failing closed here matches `/api/ready`, which already reports this as
    // not-ready rather than letting it pass quietly.
    return false;
  }

  const store = await cookies();
  return isValidSessionValue(store.get(CONSOLE_COOKIE)?.value, token);
}
