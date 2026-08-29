import { z } from 'zod';
import { DuplicatePasskeyError, PASSKEY_LABEL_MAX_LENGTH } from '../../../../../domain/platform';
import { getPlatformStore } from '../../../../../integrations/persistence';
import { verifyRegistration } from '../../../../../integrations/webauthn/verify';
import { logInfo, logWarn } from '../../../../../services/logger';
import { readCookie } from '../../../_lib/console-session';
import {
  CHALLENGE_COOKIE,
  clearChallengeCookie,
  readChallengeCookie,
} from '../../../_lib/passkey-challenge';
import { createRequestId } from '../../../_lib/request-id';
import { isRefusal, passkeyContext, requireOperator } from '../_lib/shared';

/**
 * Finishes registering a passkey.
 *
 * The password was checked when the challenge was issued; what stands in for
 * it here is the challenge cookie itself, which is signed, short-lived, and
 * carries the operator it was issued to. That id is checked against the
 * session rather than trusted on its own — either alone would be weaker than
 * both together.
 */

const registerSchema = z.object({
  response: z.object({ id: z.string().min(1).max(512) }).passthrough(),
  label: z.string().trim().min(1).max(PASSKEY_LABEL_MAX_LENGTH),
});

export async function POST(request: Request) {
  const requestId = createRequestId();

  const context = await passkeyContext(request, requestId, 'manage');
  if (isRefusal(context)) return context.response;

  const principal = await requireOperator(request);
  if (!principal || principal.kind !== 'operator') {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const clearChallenge = clearChallengeCookie(request);
  const refuse = (error: string, status: number) =>
    Response.json({ error, requestId }, { status, headers: { 'set-cookie': clearChallenge } });

  const challenge = readChallengeCookie(
    readCookie(request, CHALLENGE_COOKIE),
    context.secret,
    'register',
  );
  if (!challenge) return refuse('passkey_challenge_expired', 400);

  // The challenge was issued to whoever proved their password. If the session
  // is now a different operator, this ceremony is not theirs to finish.
  if (challenge.operatorId !== principal.id) {
    return refuse('passkey_challenge_expired', 400);
  }

  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse('invalid_request', 400);

  const verified = await verifyRegistration({
    rp: context.rp,
    challenge: challenge.challenge,
    response: parsed.data.response,
  });
  if (!verified) return refuse('passkey_registration_failed', 400);

  try {
    await getPlatformStore().insertOperatorPasskey({
      credentialId: verified.credentialId,
      operatorId: principal.id,
      publicKey: verified.publicKey,
      signCounter: verified.signCounter,
      transports: verified.transports,
      label: parsed.data.label,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    // Only a real collision answers 409. `excludeCredentials` is meant to have
    // stopped this in the browser, so reaching here means an authenticator
    // that ignored it or a genuine collision — neither of which may overwrite
    // the existing row.
    if (error instanceof DuplicatePasskeyError) {
      return refuse('passkey_already_registered', 409);
    }
    // Anything else is the store failing, and saying "already registered" to
    // that is worse than saying nothing: the operator reads a fact about their
    // own devices where the truth is that the database was unreachable, and
    // retries against a message that will never change. It is logged because
    // an outage that only ever renders as a 409 leaves no trace at all.
    logWarn('passkey_registration_failed', {
      operatorId: principal.id,
      requestId,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return refuse('passkey_registration_unavailable', 503);
  }

  logInfo('passkey_registered', { operatorId: principal.id, requestId });

  return Response.json(
    { requestId, registered: true },
    { status: 201, headers: { 'set-cookie': clearChallenge } },
  );
}
