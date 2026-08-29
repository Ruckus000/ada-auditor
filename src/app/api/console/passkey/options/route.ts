import { buildAuthenticationOptions } from '../../../../../integrations/webauthn/verify';
import {
  buildChallengeCookie,
  encodeChallengeCookie,
} from '../../../_lib/passkey-challenge';
import { createRequestId } from '../../../_lib/request-id';
import { isRefusal, passkeyContext } from '../_lib/shared';

/**
 * The challenge that starts a passkey sign-in.
 *
 * Unauthenticated by necessity — this is how someone with no session gets one.
 * That makes what it *discloses* the thing to look at, and the answer is
 * nothing: a random challenge, identical for every caller, with no
 * `allowCredentials` list and no lookup of any kind behind it. There is no
 * email in the request to enumerate with, so unlike the password route this
 * endpoint has no user-enumeration surface to defend.
 */
export async function POST(request: Request) {
  const requestId = createRequestId();

  const context = await passkeyContext(request, requestId, 'signin');
  if (isRefusal(context)) return context.response;

  const options = await buildAuthenticationOptions(context.rp);

  return Response.json(
    { requestId, options },
    {
      status: 200,
      headers: {
        'set-cookie': buildChallengeCookie(
          encodeChallengeCookie(context.secret, {
            ceremony: 'authenticate',
            challenge: options.challenge,
          }),
          request,
        ),
      },
    },
  );
}
