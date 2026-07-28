import { isSameOriginConsoleRequest } from '../../_lib/same-origin';
import { createRequestId } from '../../_lib/request-id';
import {
  buildSessionCookie,
  clearFailures,
  createSessionValue,
  hasConsoleSession,
  isThrottled,
  MIN_TOKEN_LENGTH,
  recordFailure,
  safeEqual,
  SESSION_TTL_SECONDS,
  throttleKey,
} from '../../_lib/console-session';

/** Whether this browser already holds a valid operator session. */
export async function GET(request: Request) {
  const configuredToken = process.env.AUDITOR_RUN_TOKEN;
  return Response.json({
    authenticated: Boolean(configuredToken) && hasConsoleSession(request, configuredToken!),
    tokenConfigured: Boolean(configuredToken),
  });
}

/** Exchange the run token for a session cookie. */
export async function POST(request: Request) {
  const requestId = createRequestId();
  const configuredToken = process.env.AUDITOR_RUN_TOKEN;

  if (!configuredToken) {
    return Response.json(
      { error: 'auditor_run_token_not_configured', requestId },
      { status: 503 },
    );
  }

  // Unlock is a state-changing POST, so it needs the same CSRF guard as a run.
  if (!isSameOriginConsoleRequest(request)) {
    return Response.json({ error: 'console_same_origin_required', requestId }, { status: 403 });
  }

  if (configuredToken.length < MIN_TOKEN_LENGTH) {
    return Response.json({ error: 'auditor_run_token_too_weak', requestId }, { status: 503 });
  }

  const key = throttleKey(request);
  if (isThrottled(key)) {
    return Response.json({ error: 'too_many_attempts', requestId }, { status: 429 });
  }

  let submitted: unknown;
  try {
    submitted = (await request.json())?.token;
  } catch {
    submitted = undefined;
  }

  if (typeof submitted !== 'string' || !safeEqual(submitted, configuredToken)) {
    recordFailure(key);
    return Response.json({ error: 'invalid_token', requestId }, { status: 401 });
  }

  clearFailures(key);

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
