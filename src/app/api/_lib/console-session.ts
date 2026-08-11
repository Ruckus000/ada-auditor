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

/**
 * The operator session: the same cookie, now carrying who it is.
 *
 * `v2.<operatorId>.<epoch>.<expiresAt>.<hmac>`, signed over the whole payload
 * so none of it can be edited. The old format above stays valid and stays
 * meaningful — it proves the holder knows the run token, which is a machine
 * credential, not a person. Keeping both is what lets CI, the chaos scripts
 * and the hydration harness go on working untouched while humans get accounts.
 *
 * `epoch` is the operator's `sessionEpoch` at mint time. Bumping it in the
 * database invalidates that operator's outstanding cookies and nobody else's,
 * which is per-operator revocation with no server-side session table to keep.
 * Rotating the signing secret remains the "log everyone out" lever.
 *
 * The delimiter is `.` and operator ids are generated to exclude it, asserted
 * here rather than assumed: an id containing a dot would let one field bleed
 * into the next and change which account a signature covers.
 */
const V2_PREFIX = 'v2';

export const OPERATOR_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type OperatorSessionClaims = { operatorId: string; epoch: number; expiresAt: number };

function signV2(secret: string, claims: OperatorSessionClaims): string {
  return createHmac('sha256', secret)
    .update(`${V2_PREFIX}|${claims.operatorId}|${claims.epoch}|${claims.expiresAt}`)
    .digest('hex');
}

export function createOperatorSessionValue(
  secret: string,
  operator: { id: string; sessionEpoch: number },
  now = Date.now(),
): string {
  if (!OPERATOR_ID_PATTERN.test(operator.id)) {
    throw new Error('Operator id must be a bare token: letters, numbers, hyphen, underscore.');
  }

  const claims = {
    operatorId: operator.id,
    epoch: operator.sessionEpoch,
    expiresAt: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
  };

  return [V2_PREFIX, claims.operatorId, claims.epoch, claims.expiresAt, signV2(secret, claims)].join(
    '.',
  );
}

/**
 * Verifies an operator cookie's signature and expiry.
 *
 * Returns the claims, not a verdict: whether the *account* is still valid —
 * not disabled, epoch unchanged — needs the database, and that check belongs
 * where the store is, not here. Keeping this module free of persistence keeps
 * it importable by the session endpoint without dragging a database client
 * along, which is the same reasoning that put the CSRF helper in its own file.
 */
export function readOperatorSessionClaims(
  value: string | null | undefined,
  secret: string,
  now = Date.now(),
): OperatorSessionClaims | null {
  if (!value) return null;

  const parts = value.split('.');
  if (parts.length !== 5 || parts[0] !== V2_PREFIX) return null;

  const [, operatorId, rawEpoch, rawExpiresAt, signature] = parts;
  if (!OPERATOR_ID_PATTERN.test(operatorId!)) return null;

  const epoch = Number(rawEpoch);
  const expiresAt = Number(rawExpiresAt);
  if (!Number.isSafeInteger(epoch) || !Number.isSafeInteger(expiresAt)) return null;
  if (expiresAt <= Math.floor(now / 1000)) return null;

  const claims = { operatorId: operatorId!, epoch, expiresAt };
  return safeEqual(signature!, signV2(secret, claims)) ? claims : null;
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
 * Only headers the platform itself injects are usable here.
 *
 * `x-forwarded-for` and `x-real-ip` are client-settable whenever the app can be
 * reached without a trusted proxy in front, so keying on them would let an
 * attacker rotate the value and sidestep the limit entirely. Where no trusted
 * source of client identity exists we fall back to one shared bucket, which
 * throttles globally: heavy-handed for a single-operator console, but it fails
 * closed rather than silently doing nothing.
 *
 * The counter itself lives in `unlock-throttle.ts`.
 */
export const GLOBAL_THROTTLE_KEY = 'global';

export function throttleKey(request: Request): string {
  const vercelClientIp = request.headers.get('x-vercel-forwarded-for');
  return vercelClientIp?.split(',')[0]?.trim() || GLOBAL_THROTTLE_KEY;
}




