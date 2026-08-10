import { verifyPassword } from '../../../../domain/operator-credentials';
import { getPlatformStore } from '../../../../integrations/persistence';
import { logWarn } from '../../../../services/logger';
import { isSameOriginConsoleRequest } from '../../_lib/same-origin';
import { createRequestId } from '../../_lib/request-id';
import {
  buildSessionCookie,
  createOperatorSessionValue,
  createSessionValue,
  CONSOLE_COOKIE,
  hasConsoleSession,
  MIN_TOKEN_LENGTH,
  readCookie,
  readOperatorSessionClaims,
  safeEqual,
  SESSION_TTL_SECONDS,
  throttleKey,
} from '../../_lib/console-session';
import { sessionSecret } from '../../_lib/principal';
import { getThrottleStore } from '../../_lib/unlock-throttle';

/**
 * Two ways to sign in, on one route.
 *
 *  - **Email and password**, for a person with an operator account. Mints a
 *    cookie that names them, which is what makes activity attributable and a
 *    finding assignable.
 *  - **The run token**, for CI, for scripts, and as the way in before any
 *    operator account exists. It is a machine credential and mints the older
 *    cookie shape, which resolves to the machine principal.
 *
 * The token path is not legacy baggage — deleting it would leave a fresh
 * deployment with no way to reach the console at all, since creating the first
 * operator needs `scripts/operator.ts` and a database URL.
 */

/** Whether this browser already holds a valid session, of either kind. */
export async function GET(request: Request) {
  const configuredToken = process.env.AUDITOR_RUN_TOKEN;
  const secret = sessionSecret();

  // Signature and expiry only. Whether the *account* is still live needs the
  // database, and this is an unauthenticated status probe the locked screen
  // polls — it must not become a way to ask questions about accounts.
  const hasOperatorCookie = Boolean(
    secret && readOperatorSessionClaims(readCookie(request, CONSOLE_COOKIE), secret),
  );

  return Response.json({
    authenticated:
      hasOperatorCookie || (Boolean(configuredToken) && hasConsoleSession(request, configuredToken!)),
    tokenConfigured: Boolean(configuredToken),
  });
}


/** Never matches, and costs the same as one that could. See the note below. */
const UNKNOWN_ACCOUNT_HASH = 'scrypt$16384$8$1$bm90LWEtcmVhbC1zYWx0LQ==$eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eA==';

export async function POST(request: Request) {
  const requestId = createRequestId();
  const configuredToken = process.env.AUDITOR_RUN_TOKEN;
  const secret = sessionSecret();

  if (!configuredToken || !secret) {
    return Response.json({ error: 'auditor_run_token_not_configured', requestId }, { status: 503 });
  }

  // Unlock is a state-changing POST, so it needs the same CSRF guard as a run.
  if (!isSameOriginConsoleRequest(request)) {
    return Response.json({ error: 'console_same_origin_required', requestId }, { status: 403 });
  }

  if (configuredToken.length < MIN_TOKEN_LENGTH) {
    return Response.json({ error: 'auditor_run_token_too_weak', requestId }, { status: 503 });
  }

  let body: { token?: unknown; email?: unknown; password?: unknown };
  try {
    body = (await request.json()) ?? {};
  } catch {
    body = {};
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';

  /**
   * Two buckets, both enforced.
   *
   * The request-derived key alone is one shared bucket wherever no trusted
   * proxy sets `x-vercel-forwarded-for` — which means one attacker guessing
   * passwords locks every operator out of the product. Adding an
   * email-scoped bucket keeps a distributed attack on one account bounded
   * without letting anyone deny service to the rest.
   */
  const requestKey = throttleKey(request);
  const keys = email ? [requestKey, `${requestKey}|${email.toLowerCase()}`] : [requestKey];
  const throttle = getThrottleStore();

  for (const key of keys) {
    if (await throttle.isThrottled(key)) {
      return Response.json({ error: 'too_many_attempts', requestId }, { status: 429 });
    }
  }

  const recordFailure = async () => {
    await Promise.all(keys.map((key) => throttle.recordFailure(key)));
  };
  const clearFailures = async () => {
    await Promise.all(keys.map((key) => throttle.clearFailures(key)));
  };

  // ------------------------------------------------------------- operator --

  if (email || typeof body.password === 'string') {
    const password = typeof body.password === 'string' ? body.password : '';
    const operator = email ? await getPlatformStore().getOperatorByEmail(email) : null;

    // Verify even when there is no such operator, against a hash that cannot
    // match. Skipping the work would answer "is this an account?" in the
    // response time, which is a user-enumeration oracle on the one endpoint
    // where it matters.
    // The dummy derives 64 bytes because every real hash does, and
    // `verifyPassword` passes the stored length to scrypt. A shorter dummy
    // would make the unknown-account path measurably cheaper than the known
    // one — a control that is only *nearly* constant-time, which is the one
    // property it exists to have.
    const matched = await verifyPassword(password, operator?.passwordHash ?? UNKNOWN_ACCOUNT_HASH);

    if (!operator || !matched) {
      await recordFailure();
      return Response.json({ error: 'invalid_credentials', requestId }, { status: 401 });
    }

    // A disabled operator gets its own code. They are not guessing — they had
    // an account and it was switched off, and telling them "wrong password"
    // would send them to reset a password that is fine.
    if (operator.disabledAt) {
      await recordFailure();
      logWarn('operator_disabled_signin_attempt', { operatorId: operator.id, requestId });
      return Response.json({ error: 'operator_disabled', requestId }, { status: 403 });
    }

    await clearFailures();

    return Response.json(
      { authenticated: true, operator: { id: operator.id, name: operator.name }, requestId },
      {
        status: 200,
        headers: {
          'set-cookie': buildSessionCookie(
            createOperatorSessionValue(secret, operator),
            request,
            SESSION_TTL_SECONDS,
          ),
        },
      },
    );
  }

  // -------------------------------------------------------------- machine --

  const submitted = body.token;
  if (typeof submitted !== 'string' || !safeEqual(submitted, configuredToken)) {
    await recordFailure();
    return Response.json({ error: 'invalid_token', requestId }, { status: 401 });
  }

  await clearFailures();

  return Response.json(
    { authenticated: true, requestId },
    {
      status: 200,
      headers: {
        'set-cookie': buildSessionCookie(
          createSessionValue(configuredToken),
          request,
          SESSION_TTL_SECONDS,
        ),
      },
    },
  );
}

/** Lock the console again by expiring the cookie. */
export async function DELETE(request: Request) {
  const requestId = createRequestId();

  if (!isSameOriginConsoleRequest(request)) {
    return Response.json({ error: 'console_same_origin_required', requestId }, { status: 403 });
  }

  return Response.json(
    { authenticated: false, requestId },
    { status: 200, headers: { 'set-cookie': buildSessionCookie('', request, 0) } },
  );
}
