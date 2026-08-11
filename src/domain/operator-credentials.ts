import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Password hashing for operator accounts.
 *
 * `scrypt` from `node:crypto` rather than a dependency: it is memory-hard,
 * it ships with the runtime, and adding an auth library to hash one column
 * would be a dependency taken for the parts of it we are not using. The async
 * form is deliberate — the sync one blocks the event loop for ~80ms per
 * sign-in, which on a serverless function is the whole request.
 *
 * The cost parameters are stored *in* the hash, not compiled in. Raising them
 * later must not invalidate every existing row: a stored hash names the
 * parameters it was produced with, so old and new can coexist and a rehash on
 * next sign-in is possible without a migration.
 *
 * Pure and I/O-free so `scripts/operator.ts` can stay a thin shell over it.
 * Tests must never import that script — it calls `main()` at import.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/** Current cost. N is the work factor; r and p are the OWASP-suggested pair. */
const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * The shortest password we will store.
 *
 * Length rather than a character-class rule: composition rules push people
 * toward `Password1!` and buy less entropy than four more characters. This is
 * the one control that measurably helps, and it is the one OWASP still
 * recommends.
 */
export const MIN_PASSWORD_LENGTH = 12;

export class WeakPasswordError extends Error {}

export function assertPasswordStrength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(
      `A password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
}

/** `scrypt$N$r$p$salt$hash`, both tails base64. */
export async function hashPassword(password: string): Promise<string> {
  assertPasswordStrength(password);

  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, { N, r: R, p: P });

  return ['scrypt', N, R, P, salt.toString('base64'), derived.toString('base64')].join('$');
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed stored value: a corrupt
 * row must read as "this password does not match", never as a 500 that tells
 * an attacker they found something interesting.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  const cost = { N: Number(rawN), r: Number(rawR), p: Number(rawP) };
  if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p)) {
    return false;
  }
  // A hostile row could otherwise name a work factor large enough to hang the
  // process — the stored parameters are data, and data from the database is
  // still data.
  if (cost.N > 1 << 20 || cost.r > 32 || cost.p > 16) {
    return false;
  }

  // `Buffer.from(…, 'base64')` drops invalid characters rather than throwing,
  // so a garbled row yields a short buffer, not an exception. Length is what
  // has to be checked — `timingSafeEqual` throws on a mismatch, and that throw
  // would itself leak the comparison.
  const expected = Buffer.from(rawHash!, 'base64');
  if (expected.length === 0) {
    return false;
  }

  const derived = await scryptAsync(
    password,
    Buffer.from(rawSalt!, 'base64'),
    expected.length,
    cost,
  );
  return timingSafeEqual(derived, expected);
}
