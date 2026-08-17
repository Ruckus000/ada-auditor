/**
 * How a credential reference becomes an environment variable name.
 *
 * Here rather than beside the resolver because two places need the *name* and
 * only one of them may see the value. The runner resolves a credential; a
 * screen wants to say whether one is configured — and a screen has no business
 * importing anything from `integrations/browser`, which is also where
 * `playwright-core` lives.
 *
 * The prefix is fixed and the reference is constrained to a plain identifier,
 * so no reference can name a variable outside this namespace. That matters:
 * without it, `credentialRef` would be a way to ask the server which of *its*
 * secrets exist.
 */

export const CREDENTIAL_REF_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export type CredentialField = 'user' | 'pass';

export function credentialEnvKey(ref: string, field: CredentialField): string {
  return `AUDIT_CREDENTIAL_${ref.toUpperCase().replace(/-/g, '_')}_${field.toUpperCase()}`;
}
