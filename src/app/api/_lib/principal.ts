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
 * Where passkeys are allowed to be used, or null when the feature is off.
 *
 * **Never derived from `Host` or `x-forwarded-host`**, and this is the sharpest
 * instance of a rule the codebase already follows for `AUDITOR_SELF_URL`. A
 * relying-party id taken from a request header is an account-takeover
 * primitive: an attacker who can make the app see an id it does not own can
 * have credentials minted against a domain they control, or replay one there.
 * It is configuration or it is nothing.
 *
 * Nothing is a legitimate state. Unset means passkeys are simply unavailable,
 * which is correct for local development and for preview deployments — their
 * origins differ from production, so a production credential could not work
 * there in any case. The console hides the button and the endpoints refuse.
 *
 * The origin must be a full origin (`https://audit.example.com`) and the id
 * its registrable domain (`audit.example.com`). They are checked against each
 * other here, because a mismatch is a misconfiguration that would otherwise
 * surface as every ceremony failing with nothing saying why.
 */
export function passkeyRelyingParty(): { id: string; origin: string } | null {
  const id = process.env.AUDITOR_RP_ID?.trim();
  const origin = process.env.AUDITOR_RP_ORIGIN?.trim();
  if (!id || !origin) return null;

  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return null;
  }

  // The id must be the origin's host or a parent of it — what the spec allows
  // and what a browser will enforce anyway. Checked here so the failure is a
  // readable config error rather than an opaque ceremony refusal.
  const idIsHostOrParent = host === id || host.endsWith(`.${id}`);
  return idIsHostOrParent ? { id, origin } : null;
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
 *
 * ## The store arrives as a factory, and that is load-bearing
 *
 * Only the v2 branch reads it. This used to take the store itself, so both
 * callers evaluated `getPlatformStore()` to build the argument — and that
 * constructor throws without `DATABASE_URL`, before anything had looked at the
 * cookie. The work was done to build a value the v1 and no-cookie paths never
 * read.
 *
 * On a deployment missing that variable, the cost was that *being unauthenticated
 * stopped being answerable*: a same-origin request got 500 instead of 401, and
 * `guard.tsx` rendered Next's generic error page instead of the unlock card.
 * Not a leak — the body is empty and the message reaches only the server log —
 * but an operator saw a black crash screen where the product had something to
 * say. What the deployment is actually missing is named by `/api/ready` and by
 * the console's own readiness banner.
 *
 * A no-cookie, v1-cookie or bearer request now touches no store at all. Signing
 * in still needs the database, and the screens behind the gate still fail
 * without it — correctly, because they read from it.
 */
export async function resolvePrincipal(
  cookieValue: string | null | undefined,
  operatorStore: () => Pick<OperatorStore, 'getOperator'>,
  now = Date.now(),
): Promise<Principal | null> {
  const secret = sessionSecret();
  if (!secret) {
    // Nothing configured means nothing can be authenticated, so nothing is.
    return null;
  }

  const claims = readOperatorSessionClaims(cookieValue, secret, now);
  if (claims) {
    // Constructed here, and only here — see the note above.
    const operator = await operatorStore().getOperator(claims.operatorId);
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
  return resolvePrincipal(readCookie(request, CONSOLE_COOKIE), getPlatformStore);
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
  return resolvePrincipal(store.get(CONSOLE_COOKIE)?.value, getPlatformStore);
});
