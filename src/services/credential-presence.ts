import {
  credentialEnvKey,
  CREDENTIAL_REF_PATTERN,
  type CredentialField,
} from '../domain/credential-ref';

/**
 * Which credentials a journey needs, and whether each one is configured.
 *
 * **Presence, never a value, never an input, never an echo.** This says a
 * secret exists; nothing here can be made to say what it is, and no screen
 * built on it offers a box to type one into. A credential is set by whoever
 * administers the deployment's environment, and that is the only place it
 * lives.
 *
 * The gap it closes is one the step editor opened. An operator can now type a
 * `credentialRef` into a form, and until this there was no way to find out
 * whether it resolved except by starting a run and waiting for it to fail with
 * `Credential "acme" has no pass configured` — after the browser had launched
 * and walked as far as the login.
 *
 * A missing username and a missing password are reported separately because a
 * login needs both and half-configured is the likely state: somebody sets the
 * pair, mistypes one variable name, and the run fails on the field they were
 * sure they had set.
 */

/** Just enough of `process.env` to read from, so a test can hand in a literal. */
type EnvLike = Record<string, string | undefined>;

export type CredentialPresence = {
  /** The reference as the step spells it. Not a secret — naming it is the point. */
  ref: string;
  /** Whether `AUDIT_CREDENTIAL_<REF>_USER` has a value. */
  user: boolean;
  /** Whether `AUDIT_CREDENTIAL_<REF>_PASS` has a value. */
  pass: boolean;
};

function isSet(env: EnvLike, ref: string, field: CredentialField): boolean {
  // Truthiness, matching `resolveCredential`: it refuses an empty string too,
  // so reporting `AUDIT_CREDENTIAL_ACME_PASS=""` as configured would promise
  // something the run will then refuse.
  return Boolean(env[credentialEnvKey(ref, field)]);
}

/**
 * Reads `credentialRef` off whatever the steps column holds.
 *
 * `unknown[]`, because a stored row predates every schema this repo has. A
 * reference that could never resolve is skipped rather than reported missing:
 * `resolveCredential` refuses a malformed ref before it looks anything up, so
 * "not configured" would be the wrong answer to "not a reference".
 *
 * Deduplicated and in first-use order — a login uses one reference for both
 * fields, and listing it twice would read as two credentials.
 *
 * Exported on its own because the run and preview handlers need the refs
 * without the env answer — they ask the per-client store instead — and a
 * second copy of this walk is a second place for the two surfaces to disagree
 * about what counts as a reference.
 */
export function credentialRefsInSteps(steps: unknown): string[] {
  if (!Array.isArray(steps)) return [];

  const refs: string[] = [];
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const ref = (step as { credentialRef?: unknown }).credentialRef;
    if (typeof ref !== 'string' || !CREDENTIAL_REF_PATTERN.test(ref)) continue;
    if (!refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

export function credentialsForSteps(
  steps: unknown,
  env: EnvLike = process.env,
): CredentialPresence[] {
  return credentialRefsInSteps(steps).map((ref) => ({
    ref,
    user: isSet(env, ref, 'user'),
    pass: isSet(env, ref, 'pass'),
  }));
}
