import { cache } from 'react';
import { cookies } from 'next/headers';
import { machinePrincipal, type Principal } from '../../../domain/operator';
import type { OperatorStore } from '../../../domain/platform';
import { getPlatformStore } from '../../../integrations/persistence';
import {
  CONSOLE_COOKIE,
  MIN_TOKEN_LENGTH,
  isValidSessionValue,
  readCookie,
  readOperatorSessionClaims,
} from './console-session';

/**
 * Turning a cookie into a person.
 *
 * `hasOperatorSession()` used to return a boolean, which is the whole reason
 * nothing could be attributed to anyone: a caller that only learns "yes, some
 * session" has nothing to write into `activity_events` and nobody to assign a
 * finding to. This returns the principal instead.
 */

/**
 * The key the session cookie is signed with.
 *
 * `AUDITOR_SESSION_SECRET` when set, the run token otherwise. The fallback is
 * what makes this deployable without a coordinated env change, but it is not
 * the desired state and `/api/ready` says so: while they are the same value,
 * rotating the machine token still signs every human out, which is the exact
 * coupling operator accounts exist to break.
 *
 * It does not *gate* readiness. A deployment with no operators at all, driven
 * entirely by CI with the run token, is working — not down.
 */
export function sessionSecret(): string | null {
  const configured = process.env.AUDITOR_SESSION_SECRET?.trim();
  if (configured && configured.length >= MIN_TOKEN_LENGTH) {
    return configured;
  }

  const runToken = process.env.AUDITOR_RUN_TOKEN;
  return runToken && runToken.length >= MIN_TOKEN_LENGTH ? runToken : null;
}

/** True while the session key is borrowed from the run token. Surfaced, not fatal. */
export function sessionSecretIsShared(): boolean {
  const configured = process.env.AUDITOR_SESSION_SECRET?.trim();
  return !(configured && configured.length >= MIN_TOKEN_LENGTH);
}

/**
 * Resolves a cookie value to a principal.
 *
 * Two formats, both valid, meaning different things:
 *
 *  - v2 carries an operator id and the session epoch it was minted at. The
 *    signature proves the claims were not edited; the *account* still has to
 *    be checked, because a signature cannot know that someone was disabled
 *    five minutes ago. That check is one indexed primary-key lookup, and it is
 *    the price of revocation actually meaning something.
 *  - v1 proves the holder knows the run token. That is a machine credential,
 *    so it resolves to the machine principal rather than to a person.
 */
export async function resolvePrincipal(
  cookieValue: string | null | undefined,
  store: Pick<OperatorStore, 'getOperator'>,
  now = Date.now(),
): Promise<Principal | null> {
  const secret = sessionSecret();
  if (!secret) {
    // Nothing configured means nothing can be authenticated, so nothing is.
    return null;
  }

  const claims = readOperatorSessionClaims(cookieValue, secret, now);
  if (claims) {
    const operator = await store.getOperator(claims.operatorId);
    if (!operator || operator.disabledAt) return null;
    // A stale epoch is a cookie minted before a revocation. Same answer as a
    // forged one: no.
    if (operator.sessionEpoch !== claims.epoch) return null;

    return { kind: 'operator', id: operator.id, name: operator.name, email: operator.email };
  }

  const runToken = process.env.AUDITOR_RUN_TOKEN;
  if (runToken && isValidSessionValue(cookieValue, runToken, now)) {
    return machinePrincipal();
  }

  return null;
}

/** For route handlers, which hold a `Request`. */
export async function principalFromRequest(request: Request): Promise<Principal | null> {
  return resolvePrincipal(readCookie(request, CONSOLE_COOKIE), getPlatformStore());
}

/**
 * For Server Components, which do not.
 *
 * Memoised per render with React `cache`, the same trick `clients/[clientId]/load.ts`
 * uses. It is now called more than twice per render — every screen in the
 * `(platform)` group calls it through `guarded()`, and the layout calls it
 * again for the header's name — so memoising is what keeps a page from paying
 * for several identical lookups. Reading `cookies()` also keeps the route
 * dynamic, which the gate depends on: a prerendered auth gate has shipped from
 * this codebase before.
 */
export const currentPrincipal = cache(async (): Promise<Principal | null> => {
  const store = await cookies();
  return resolvePrincipal(store.get(CONSOLE_COOKIE)?.value, getPlatformStore());
});
