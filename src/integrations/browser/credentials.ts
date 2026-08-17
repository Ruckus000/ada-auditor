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
