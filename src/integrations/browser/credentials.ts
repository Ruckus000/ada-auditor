/**
 * Resolves a credential reference to a real username/password.
 *
 * Journeys name secrets; they never carry them. A step says
 * `{ credentialRef: 'acme-staging', field: 'pass' }` and the value is looked
 * up here, server-side, at run time — so nothing secret travels in a request
 * body, gets persisted with the journey, or shows up in a run log.
 *
 * The backing store is environment variables today, which is the right size
 * for a handful of client logins. It is deliberately behind this one function
 * so moving to a real encrypted store later is a change to the resolver, not
 * to every journey that uses a credential.
 */

import { credentialEnvKey, CREDENTIAL_REF_PATTERN } from '../../domain/credential-ref';

export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialError';
  }
}

export function resolveCredential(ref: string, field: 'user' | 'pass'): string {
  if (!CREDENTIAL_REF_PATTERN.test(ref)) {
    // The ref becomes part of an environment variable name, so anything other
    // than a plain identifier is refused rather than normalised.
    throw new CredentialError('Credential reference must be alphanumeric.');
  }

  const value = process.env[credentialEnvKey(ref, field)];
  if (!value) {
    // Names the reference and field, never a value.
    throw new CredentialError(`Credential "${ref}" has no ${field} configured.`);
  }

  return value;
}

/**
 * The values a run was handed alongside its steps, keyed by the same refs the
 * steps use. Built by the run and preview handlers from the per-client
 * credential store; the fields are optional because the *seam* does not get to
 * demand a pair — what a caller resolved is what it resolved.
 */
export type RunCredentials = Record<string, { user?: string; pass?: string }>;

/**
 * Store first, env fallback second — the one place that ordering lives.
 *
 * The map carries what the credential store held for this journey's client;
 * anything it does not answer falls through to `resolveCredential` and the
 * `AUDIT_CREDENTIAL_<REF>_<FIELD>` variables, unchanged. So a journey whose
 * client never stored a value runs exactly as before, and a ref missing from
 * both fails with the same `CredentialError` sentence it always has — the
 * screens explain that sentence, and a second wording would be a second rule.
 *
 * Falsy falls through, matching `resolveCredential`'s refusal of an empty
 * env value: an empty string is not a credential anybody meant.
 */
export function resolveCredentialFrom(
  credentials: RunCredentials | undefined,
  ref: string,
  field: 'user' | 'pass',
): string {
  const stored = credentials?.[ref]?.[field];
  if (stored) return stored;
  return resolveCredential(ref, field);
}
