import { getPlatformStore } from '../../../../../integrations/persistence';
import { verifyAuthentication } from '../../../../../integrations/webauthn/verify';
import { logInfo, logWarn } from '../../../../../services/logger';
import {
  buildSessionCookie,
  createOperatorSessionValue,
  readCookie,
  SESSION_TTL_SECONDS,
} from '../../../_lib/console-session';
import {
  CHALLENGE_COOKIE,
  clearChallengeCookie,
  readChallengeCookie,
} from '../../../_lib/passkey-challenge';
import { createRequestId } from '../../../_lib/request-id';
import {
  ceremonyResponseSchema,
  clearPasskeyFailures,
  isRefusal,
  passkeyContext,
  recordPasskeyFailure,
} from '../_lib/shared';

/**
 * Signing in with a passkey.
 *
 * The credential names its own owner: a discoverable credential carries the
 * operator id as its user handle, so nothing in the request says who is
 * signing in until the signature has been checked against a stored key.
 *
 * It ends exactly where the password branch ends — `createOperatorSessionValue`
 * over `{id, sessionEpoch}` — which is what keeps this additive. The session
 * cookie has one format, `resolvePrincipal` learns nothing new, and
 * `operator -- revoke-sessions` still ends a passkey session because the epoch
 * is what it always was.
 */
export async function POST(request: Request) {
  const requestId = createRequestId();

  const context = await passkeyContext(request, requestId, 'signin');
  if (isRefusal(context)) return context.response;

  const clearChallenge = clearChallengeCookie(request);

  /** Every refusal clears the challenge: one ceremony, one attempt. */
  const refuse = async (error: string, status: number) => {
    await recordPasskeyFailure(context.throttleKeys);
    return Response.json(
      { error, requestId },
      { status, headers: { 'set-cookie': clearChallenge } },
    );
  };

  const challenge = readChallengeCookie(
    readCookie(request, CHALLENGE_COOKIE),
    context.secret,
    'authenticate',
  );
  if (!challenge) return refuse('passkey_challenge_expired', 400);

  const parsed = ceremonyResponseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse('invalid_request', 400);

  const stored = await getPlatformStore().getOperatorPasskeyByCredentialId(parsed.data.id);
  // One code for "no such credential" and for "signature did not verify", the
  // same reasoning the password route applies to unknown accounts: a distinct
  // answer here would tell a stranger which credential ids are real.
  if (!stored) return refuse('invalid_credentials', 401);

  const verified = await verifyAuthentication({
    rp: context.rp,
    challenge: challenge.challenge,
    response: parsed.data,
    credential: {
      id: stored.credentialId,
      publicKey: stored.publicKey,
      signCounter: stored.signCounter,
    },
  });
  if (!verified) {
    logWarn('passkey_signin_failed', { operatorId: stored.operatorId, requestId });
    return refuse('invalid_credentials', 401);
  }

  const operator = await getPlatformStore().getOperator(stored.operatorId);
  // The credential outlived its operator. Cascade should make this
  // unreachable; refusing rather than trusting it is what keeps a missing row
  // from becoming a session belonging to nobody.
  if (!operator) return refuse('invalid_credentials', 401);

  // Same rule as the password path: a disabled operator is told so, because
  // they are not guessing.
  if (operator.disabledAt) {
    logWarn('operator_disabled_signin_attempt', { operatorId: operator.id, requestId });
    await recordPasskeyFailure(context.throttleKeys);
    return Response.json(
      { error: 'operator_disabled', requestId },
      { status: 403, headers: { 'set-cookie': clearChallenge } },
    );
  }

  await getPlatformStore().recordOperatorPasskeyUse(
    stored.credentialId,
    verified.signCounter,
    new Date().toISOString(),
  );
  await clearPasskeyFailures(context.throttleKeys);
  logInfo('passkey_signin_succeeded', { operatorId: operator.id, requestId });

  return Response.json(
    { authenticated: true, operator: { id: operator.id, name: operator.name }, requestId },
    {
      status: 200,
      // Two cookies: the session, and the spent challenge cleared.
      headers: [
        [
          'set-cookie',
          buildSessionCookie(
            createOperatorSessionValue(context.secret, operator),
            request,
            SESSION_TTL_SECONDS,
          ),
        ],
        ['set-cookie', clearChallenge],
      ],
    },
  );
}
