import { createHmac, timingSafeEqual } from 'node:crypto';
import { isSecureRequest } from './same-origin';

/**
 * Operator session for the browser console.
 *
 * The same-origin header check alone is CSRF defence, not authentication:
 * `sec-fetch-site` and `Origin` are set by browsers but are freely forgeable by
 * any non-browser client, so on their own they let anyone run audits with the
 * server's token. The console therefore requires proof of AUDITOR_RUN_TOKEN
 * once per browser, exchanged for a signed, expiring, HttpOnly cookie.
 *
 * The cookie is an HMAC over its own expiry, keyed on the run token, so it
 * cannot be forged or extended without the token, and rotating the token
 * invalidates every outstanding session.
 */

export const CONSOLE_COOKIE = 'auditor_console';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Guards against a trivially brute-forceable secret being used as the gate. */
export const MIN_TOKEN_LENGTH = 16;

function sign(secret: string, expiresAt: number): string {
  return createHmac('sha256', secret).update(String(expiresAt)).digest('hex');
}

/** Compares two strings without leaking their contents through timing. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, which would itself be a leak, so
  // compare equal-length digests of the inputs instead.
  const leftDigest = createHmac('sha256', 'compare').update(left).digest();
  const rightDigest = createHmac('sha256', 'compare').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function createSessionValue(secret: string, now = Date.now()): string {
  const expiresAt = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  return `${expiresAt}.${sign(secret, expiresAt)}`;
}

export function isValidSessionValue(
  value: string | null | undefined,
  secret: string,
  now = Date.now(),
): boolean {
  if (!value) return false;

  const separator = value.indexOf('.');
  if (separator <= 0) return false;

  const expiresAt = Number(value.slice(0, separator));
  const signature = value.slice(separator + 1);
  if (!Number.isSafeInteger(expiresAt) || !signature) return false;

  if (expiresAt <= Math.floor(now / 1000)) return false;

  return safeEqual(signature, sign(secret, expiresAt));
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return null;
}

export function hasConsoleSession(request: Request, secret: string): boolean {
  return isValidSessionValue(readCookie(request, CONSOLE_COOKIE), secret);
}

/**
 * `Secure` is omitted only for genuinely plain-http origins, so the cookie still
 * works for local development on http://localhost.
 *
 * The https check must consult `x-forwarded-proto`: behind a TLS-terminating
 * proxy the browser speaks https while the app sees http, and trusting the URL
 * alone would hand out a session cookie that the browser is willing to send in
 * cleartext.
 */
export function buildSessionCookie(value: string, request: Request, maxAge: number): string {
  const isHttps = isSecureRequest(request);
  const attributes = [
    `${CONSOLE_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ];
  if (isHttps) attributes.push('Secure');
  return attributes.join('; ');
}

/**
 * Best-effort throttle on unlock attempts, to blunt online brute force of the
 * token. In-memory and therefore per-instance: it is a speed bump, not a
 * guarantee, and it is no substitute for a high-entropy token.
 */
const attempts = new Map<string, { count: number; blockedUntil: number }>();
const MAX_ATTEMPTS = 8;
const BLOCK_MS = 5 * 60 * 1000;

/**
 * Only headers the platform itself injects are usable here.
 *
 * `x-forwarded-for` and `x-real-ip` are client-settable whenever the app can be
 * reached without a trusted proxy in front, so keying on them would let an
 * attacker rotate the value and sidestep the limit entirely. Where no trusted
 * source of client identity exists we fall back to one shared bucket, which
 * throttles globally: heavy-handed for a single-operator console, but it fails
 * closed rather than silently doing nothing.
 */
export const GLOBAL_THROTTLE_KEY = 'global';

export function throttleKey(request: Request): string {
  const vercelClientIp = request.headers.get('x-vercel-forwarded-for');
  return vercelClientIp?.split(',')[0]?.trim() || GLOBAL_THROTTLE_KEY;
}

export function isThrottled(key: string, now = Date.now()): boolean {
  const entry = attempts.get(key);
  return entry != null && entry.blockedUntil > now;
}

export function recordFailure(key: string, now = Date.now()): void {
  const entry = attempts.get(key) ?? { count: 0, blockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_MS;
    entry.count = 0;
  }
  attempts.set(key, entry);
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}

/** Test seam. */
export function resetThrottle(): void {
  attempts.clear();
}
