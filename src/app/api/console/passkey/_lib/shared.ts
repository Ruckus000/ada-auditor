import { z } from 'zod';
import type { Principal } from '../../../../../domain/operator';
import { passkeyRelyingParty, principalFromRequest, sessionSecret } from '../../../_lib/principal';
import { isSameOriginConsoleRequest } from '../../../_lib/same-origin';
import { throttleKey } from '../../../_lib/console-session';
import { getThrottleStore } from '../../../_lib/unlock-throttle';
import type { RelyingParty } from '../../../../../integrations/webauthn/verify';

/**
 * The preamble every passkey route shares.
 *
 * Four checks in a fixed order, kept in one place because getting the order
 * wrong is how a CSRF guard ends up behind a database read.
 */

/** Shown in the OS prompt when a device asks whether to trust this site. */
const RP_NAME = 'ADA Auditor';

export type PasskeyContext = {
  secret: string;
  rp: RelyingParty;
  /** Namespaced — see `passkeyThrottleKeys`. */
  throttleKeys: string[];
};

export type PasskeyRefusal = { response: Response };

/**
 * Which counter a route's failures belong to.
 *
 * `signin` is the unauthenticated ceremony; `manage` is an authenticated
 * operator adding a device, whose failures are password typos.
 */
export type PasskeyPurpose = 'signin' | 'manage';

/**
 * Buckets passkey failures away from password sign-in, and the two passkey
 * flows away from each other.
 *
 * Namespacing away from the password path is not cosmetic: `throttleKey`
 * falls back to one shared `global` bucket wherever no trusted proxy sets
 * `x-vercel-forwarded-for`, so an unnamespaced counter would share that
 * bucket with password sign-in — and eight failed passkey attempts would lock
 * every operator out of *both* ways in, turning a new convenience into an
 * outage on the established one.
 *
 * Splitting `signin` from `manage` closes the same trap one level down. The
 * failures mean different things: a stranger presenting a signature that does
 * not verify, versus an operator who is already signed in mistyping their own
 * password on the add-a-device form. Sharing one counter let the second lock
 * out the first — eight typos on the Settings screen and nobody can sign in
 * with a passkey for five minutes, which on a `global` bucket means every
 * operator, not just the one who was typing.
 *
 * One bucket per purpose, not two: there is no email here to scope a second
 * by, and none is needed. A signature cannot be guessed.
 */
export function passkeyThrottleKeys(request: Request, purpose: PasskeyPurpose): string[] {
  return [`passkey-${purpose}|${throttleKey(request)}`];
}

/**
 * Resolves what every route needs, or the refusal to return instead.
 *
 * Gated on a session secret existing rather than on `AUDITOR_RUN_TOKEN`. The
 * password route 503s without a run token because its machine branch needs
 * one; a passkey sign-in has no machine branch and no such need.
 */
export async function passkeyContext(
  request: Request,
  requestId: string,
  purpose: PasskeyPurpose,
): Promise<PasskeyContext | PasskeyRefusal> {
  if (!isSameOriginConsoleRequest(request)) {
    return {
      response: Response.json(
        { error: 'console_same_origin_required', requestId },
        { status: 403 },
      ),
    };
  }

  const secret = sessionSecret();
  if (!secret) {
    return {
      response: Response.json(
        { error: 'auditor_run_token_not_configured', requestId },
        { status: 503 },
      ),
    };
  }

  const rp = passkeyRelyingParty();
  if (!rp) {
    return {
      response: Response.json({ error: 'passkeys_not_configured', requestId }, { status: 503 }),
    };
  }

  const throttleKeys = passkeyThrottleKeys(request, purpose);
  const throttle = getThrottleStore();
  for (const key of throttleKeys) {
    if (await throttle.isThrottled(key)) {
      return {
        response: Response.json({ error: 'too_many_attempts', requestId }, { status: 429 }),
      };
    }
  }

  return { secret, rp: { ...rp, name: RP_NAME }, throttleKeys };
}

export function isRefusal(
  value: PasskeyContext | PasskeyRefusal,
): value is PasskeyRefusal {
  return 'response' in value;
}

export async function recordPasskeyFailure(keys: string[]): Promise<void> {
  const throttle = getThrottleStore();
  await Promise.all(keys.map((key) => throttle.recordFailure(key)));
}

export async function clearPasskeyFailures(keys: string[]): Promise<void> {
  const throttle = getThrottleStore();
  await Promise.all(keys.map((key) => throttle.clearFailures(key)));
}

/** The signed-in operator, for the routes that manage credentials. */
export async function requireOperator(request: Request): Promise<Principal | null> {
  const principal = await principalFromRequest(request);
  return principal?.kind === 'operator' ? principal : null;
}

/**
 * The ceremony response, validated only as far as "this is an object with the
 * fields the library will look for".
 *
 * Deliberately not modelled in full: the library owns that shape and validates
 * it properly, and a second schema here would be a copy to drift. What this
 * does is keep obviously-wrong input from reaching the crypto at all, and give
 * the route a 400 rather than an exception.
 */
export const ceremonyResponseSchema = z
  .object({ id: z.string().min(1).max(512) })
  .passthrough();
