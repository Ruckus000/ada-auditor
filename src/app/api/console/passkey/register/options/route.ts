import { z } from 'zod';
import { verifyPassword } from '../../../../../../domain/operator-credentials';
import { getPlatformStore } from '../../../../../../integrations/persistence';
import { buildRegistrationOptions } from '../../../../../../integrations/webauthn/verify';
import {
  buildChallengeCookie,
  encodeChallengeCookie,
} from '../../../../_lib/passkey-challenge';
import { createRequestId } from '../../../../_lib/request-id';
import {
  isRefusal,
  passkeyContext,
  recordPasskeyFailure,
  requireOperator,
} from '../../_lib/shared';

/**
 * The challenge that starts registering a new passkey.
 *
 * **A session is not enough to reach it.** Registering a credential grants
 * durable access, so this re-verifies the operator's password even though they
 * are already signed in. Without that, a stolen session cookie could be
 * upgraded into a permanent one: the thief registers their own device, and
 * `revoke-sessions` — which ends sessions — would not take it away.
 *
 * The password is re-read from the store rather than trusted from the session,
 * because the session says who someone is and this needs to know what they
 * still know.
 */

const registerOptionsSchema = z.object({
  password: z.string().min(1).max(1024),
});

export async function POST(request: Request) {
  const requestId = createRequestId();

  const context = await passkeyContext(request, requestId);
  if (isRefusal(context)) return context.response;

  const principal = await requireOperator(request);
  if (!principal || principal.kind !== 'operator') {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const parsed = registerOptionsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'invalid_request', requestId }, { status: 400 });
  }

  const platform = getPlatformStore();
  const operator = await platform.getOperatorByEmail(principal.email);
  if (!operator || !(await verifyPassword(parsed.data.password, operator.passwordHash))) {
    await recordPasskeyFailure(context.throttleKeys);
    return Response.json({ error: 'invalid_credentials', requestId }, { status: 401 });
  }

  const existing = await platform.listOperatorPasskeys(operator.id);
  const options = await buildRegistrationOptions({
    rp: context.rp,
    operator: { id: operator.id, email: operator.email, name: operator.name },
    // So a device already registered declines in the browser rather than
    // reaching the store and colliding on the primary key.
    excludeCredentialIds: existing.map((passkey) => passkey.credentialId),
  });

  return Response.json(
    { requestId, options },
    {
      status: 200,
      headers: {
        'set-cookie': buildChallengeCookie(
          encodeChallengeCookie(context.secret, {
            ceremony: 'register',
            challenge: options.challenge,
            // Bound to the operator, so the ceremony cannot be finished as
            // someone else even if the session changes underneath it.
            operatorId: operator.id,
          }),
          request,
        ),
      },
    },
  );
}
