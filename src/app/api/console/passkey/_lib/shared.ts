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
 * Buckets the passkey ceremonies separately from password sign-in.
 *
 * Not cosmetic. `throttleKey` falls back to one shared `global` bucket
 * wherever no trusted proxy sets `x-vercel-forwarded-for`, so an unnamespaced
 * passkey counter would share that bucket with the password path — and eight
 * failed passkey attempts would lock every operator out of *both* ways in,
 * turning a new convenience into an outage on the established one.
 *
 * One bucket, not two: there is no email here to scope a second by, and none
 * is needed. A signature cannot be guessed, so this is abuse control rather
 * than the brute-force control the password path needs.
 */
export function passkeyThrottleKeys(request: Request): string[] {
  return [`passkey|${throttleKey(request)}`];
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

  const throttleKeys = passkeyThrottleKeys(request);
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
