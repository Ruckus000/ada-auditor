import { createHmac, randomBytes } from 'node:crypto';
import { isSecureRequest } from './same-origin';
import { safeEqual } from './console-session';

/**
 * The pending half of a WebAuthn ceremony, carried in a signed cookie.
 *
 * A challenge is a nonce the server issues and must recognise moments later.
 * Holding it in a signed cookie rather than a table keeps a fresh deployment
 * from needing new infrastructure and keeps the sign-in path off Redis, whose
 * absence would otherwise mean nobody can sign in. It uses the same secret
 * that signs the session cookie, so there is one secret to configure and
 * rotate rather than two.
 *
 * **What this cannot do**, stated rather than left to be discovered: a
 * stateless challenge is not strictly single-use. Clearing the cookie
 * instructs a cooperating browser, and an attacker holding both the cookie and
 * the assertion could replay them inside the TTL. Reaching that position means
 * having already captured both halves of one TLS-protected exchange — at which
 * point the session cookie is equally exposed — so this is not a step down
 * from what the console already assumes. `HttpOnly` and `SameSite=Strict` keep
 * a web attacker from reading it, and the two-minute window bounds it. Closing
 * it properly means a `passkey_challenges` table whose row is deleted on
 * verify; nothing else in the design would change.
 */

const CHALLENGE_COOKIE = 'auditor_passkey_challenge';

/**
 * Two minutes. Long enough to find a phone and present a fingerprint, short
 * enough that a captured pair is stale before it is useful.
 */
export const CHALLENGE_TTL_SECONDS = 120;

/**
 * Which ceremony a challenge belongs to.
 *
 * Bound into the signature, so a registration challenge cannot be presented to
 * the sign-in verifier. Without it the two flows would share one credential —
 * the cookie — and the one that requires a password could be substituted by
 * the one that does not.
 */
export type Ceremony = 'register' | 'authenticate';

export type ChallengePayload = {
  ceremony: Ceremony;
  challenge: string;
  /** Present for `register`: the operator the ceremony was issued to. */
  operatorId?: string;
  expiresAt: number;
};

/** Base64url, matching how every other value in the ceremony is encoded. */
export function createChallenge(): string {
  return randomBytes(32).toString('base64url');
}

function sign(secret: string, parts: string): string {
  return createHmac('sha256', secret).update(parts).digest('hex');
}

/**
 * `ceremony|challenge|operatorId|expiresAt|hmac`.
 *
 * `|` is not a character any field can contain — the challenge and the HMAC
 * are base64url and hex, the ceremony is one of two literals, the operator id
 * is constrained by `OPERATOR_ID_PATTERN` where it is minted, and the expiry
 * is digits — so the delimiter cannot be smuggled in to shift a field.
 */
export function encodeChallengeCookie(
  secret: string,
  payload: Omit<ChallengePayload, 'expiresAt'>,
  now = Date.now(),
): string {
  const expiresAt = Math.floor(now / 1000) + CHALLENGE_TTL_SECONDS;
  const body = [
    payload.ceremony,
    payload.challenge,
    payload.operatorId ?? '',
    String(expiresAt),
  ].join('|');
  return `${body}|${sign(secret, body)}`;
}

/**
 * Returns the payload only when the signature holds, the ceremony is the one
 * the caller expected, and it has not expired. Null for everything else —
 * a malformed cookie is an ordinary outcome on an endpoint strangers reach.
 */
export function readChallengeCookie(
  value: string | null,
  secret: string,
  expected: Ceremony,
  now = Date.now(),
): ChallengePayload | null {
  if (!value) return null;

  const parts = value.split('|');
  if (parts.length !== 5) return null;

  const [ceremony, challenge, operatorId, rawExpiresAt, signature] = parts;
  if (ceremony !== 'register' && ceremony !== 'authenticate') return null;

  // Checked before the signature so a wrong-ceremony cookie is refused even
  // when it is genuinely ours — the substitution this field exists to stop.
  if (ceremony !== expected) return null;
  if (challenge === '') return null;

  const expiresAt = Number(rawExpiresAt);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return null;

  const body = [ceremony, challenge, operatorId, rawExpiresAt].join('|');
  if (!safeEqual(signature, sign(secret, body))) return null;

  return {
    ceremony,
    challenge,
    ...(operatorId === '' ? {} : { operatorId }),
    expiresAt,
  };
}

/**
 * Same attribute reasoning as the session cookie — `Secure` omitted only for
 * genuinely plain-http origins so local development still works.
 */
export function buildChallengeCookie(
  value: string,
  request: Request,
  maxAge = CHALLENGE_TTL_SECONDS,
): string {
  const attributes = [
    `${CHALLENGE_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ];
  if (isSecureRequest(request)) attributes.push('Secure');
  return attributes.join('; ');
}

/** Cleared once consumed, whether the ceremony succeeded or not. */
export function clearChallengeCookie(request: Request): string {
  return buildChallengeCookie('', request, 0);
}

export { CHALLENGE_COOKIE };
