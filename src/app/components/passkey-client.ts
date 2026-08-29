import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

/**
 * The browser half of both ceremonies.
 *
 * Thin on purpose: it fetches options, hands them to the platform
 * authenticator, and posts the result back. Every decision — who may register,
 * what verifies, what a failure means — belongs to the server, because a
 * client-side check is a suggestion.
 *
 * Errors are returned as codes rather than thrown, matching how `unlock-card`
 * already renders server error codes through its `MESSAGES` map. The one
 * client-only code is `passkey_cancelled`, which is not a failure worth
 * shouting about: it is what a person choosing "cancel" on the OS prompt looks
 * like, and it should leave the form exactly as it was.
 */

export type PasskeyOutcome = { ok: true } | { ok: false; code: string };

/** Whether this browser can do WebAuthn at all. Safe during SSR. */
export function browserSupportsPasskeys(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

async function postJson(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function errorCode(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
  return typeof payload.error === 'string' ? payload.error : 'passkey_failed';
}

/**
 * A cancelled prompt and a hostile authenticator both surface as exceptions
 * here; only the first has a name we can rely on.
 */
function ceremonyFailure(error: unknown): PasskeyOutcome {
  const name = error instanceof Error ? error.name : '';
  return { ok: false, code: name === 'NotAllowedError' ? 'passkey_cancelled' : 'passkey_failed' };
}

export async function signInWithPasskey(): Promise<PasskeyOutcome> {
  const optionsResponse = await postJson('/api/console/passkey/options');
  if (!optionsResponse.ok) return { ok: false, code: await errorCode(optionsResponse) };

  const { options } = (await optionsResponse.json()) as { options: Parameters<typeof startAuthentication>[0]['optionsJSON'] };

  let assertion;
  try {
    assertion = await startAuthentication({ optionsJSON: options });
  } catch (error) {
    return ceremonyFailure(error);
  }

  const sessionResponse = await postJson('/api/console/passkey/session', assertion);
  return sessionResponse.ok ? { ok: true } : { ok: false, code: await errorCode(sessionResponse) };
}

export async function registerPasskey(input: {
  password: string;
  label: string;
}): Promise<PasskeyOutcome> {
  const optionsResponse = await postJson('/api/console/passkey/register/options', {
    password: input.password,
  });
  if (!optionsResponse.ok) return { ok: false, code: await errorCode(optionsResponse) };

  const { options } = (await optionsResponse.json()) as { options: Parameters<typeof startRegistration>[0]['optionsJSON'] };

  let attestation;
  try {
    attestation = await startRegistration({ optionsJSON: options });
  } catch (error) {
    return ceremonyFailure(error);
  }

  const registerResponse = await postJson('/api/console/passkey/register', {
    response: attestation,
    label: input.label,
  });
  return registerResponse.ok
    ? { ok: true }
    : { ok: false, code: await errorCode(registerResponse) };
}

export async function removePasskey(credentialId: string): Promise<PasskeyOutcome> {
  const response = await fetch('/api/console/passkey', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credentialId }),
  });
  return response.ok ? { ok: true } : { ok: false, code: await errorCode(response) };
}
