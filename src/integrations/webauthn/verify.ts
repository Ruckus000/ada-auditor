import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

/**
 * The only place `@simplewebauthn/server` is imported.
 *
 * Same seam rule as the rule engines: the vendor library lives at the edge and
 * hands **plain data** inward, so nothing in `domain/` or `services/` knows it
 * exists and the callers stay in the fast unit suite. The library is here
 * rather than hand-rolled because what it does — CBOR decoding, COSE key
 * parsing, ES256/RS256/EdDSA signature verification, attestation formats — is
 * cryptography whose bugs are silent and whose failure mode is an auth bypass
 * rather than a red test.
 *
 * Everything below is a thin translation. No policy is decided here: whether
 * a counter regression matters is `isCounterRegression` in `domain/platform`,
 * and who may register is the route's business.
 */

/** Base64url, as every identifier in the WebAuthn ceremony is encoded. */
export type Base64Url = string;

export type RelyingParty = {
  /** The registrable domain, e.g. `audit.example.com`. Never header-derived. */
  id: string;
  /** The full origin the browser must report, e.g. `https://audit.example.com`. */
  origin: string;
  /** Shown in the OS prompt. */
  name: string;
};

export type RegistrationOptionsInput = {
  rp: RelyingParty;
  operator: { id: string; email: string; name: string };
  /** Credential ids this operator already has, so a device declines a repeat. */
  excludeCredentialIds: Base64Url[];
};

export type VerifiedRegistration = {
  credentialId: Base64Url;
  publicKey: Base64Url;
  signCounter: number;
  transports: string[];
};

export type VerifiedAuthentication = {
  /** The authenticator's counter after this assertion, to store back. */
  signCounter: number;
};

/**
 * Registration options, always asking for a **discoverable** credential.
 *
 * `residentKey: 'required'` is what makes the sign-in screen need no email:
 * the credential stores the user handle itself, so the browser can offer an
 * account before the server knows who is asking. `userVerification: 'required'`
 * means the device demands a biometric or PIN, which is what lets one passkey
 * stand in for both factors.
 *
 * Attestation is deliberately `'none'`. Asking a device to prove its make and
 * model is for organisations that pin hardware; here it would collect a
 * tracking identifier this product has no use for.
 */
export async function buildRegistrationOptions(input: RegistrationOptionsInput) {
  return generateRegistrationOptions({
    rpID: input.rp.id,
    rpName: input.rp.name,
    // The handle the authenticator stores and hands back at sign-in. The
    // operator id rather than the email: an email can be reassigned, and this
    // value is what a credential is bound to for its whole life.
    userID: new TextEncoder().encode(input.operator.id),
    userName: input.operator.email,
    userDisplayName: input.operator.name,
    attestationType: 'none',
    excludeCredentials: input.excludeCredentialIds.map((id) => ({ id })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  });
}

/**
 * Sign-in options, deliberately carrying **no `allowCredentials`**.
 *
 * An allow-list would have to be built from an email, which would make this
 * endpoint answer "is this an account?" to anyone who asked — the enumeration
 * oracle the password path has to work to avoid. Omitting it is both the
 * better UX and the stronger position: the response is a random challenge and
 * nothing else, identical for every caller.
 */
export async function buildAuthenticationOptions(rp: RelyingParty) {
  return generateAuthenticationOptions({
    rpID: rp.id,
    userVerification: 'required',
  });
}

/**
 * Verifies an attestation and narrows it to what the store keeps.
 *
 * Returns null rather than throwing on a response that does not verify: a
 * failed ceremony is an expected outcome of an endpoint strangers can reach,
 * not an exception. The library's own throws are caught for the same reason —
 * malformed input is a 400, not a 500.
 */
export async function verifyRegistration(input: {
  rp: RelyingParty;
  challenge: Base64Url;
  response: unknown;
}): Promise<VerifiedRegistration | null> {
  try {
    const verification = await verifyRegistrationResponse({
      // The library validates this shape itself and throws when it is wrong,
      // which the catch below turns into a refusal.
      response: input.response as Parameters<
        typeof verifyRegistrationResponse
      >[0]['response'],
      expectedChallenge: input.challenge,
      expectedOrigin: input.rp.origin,
      expectedRPID: input.rp.id,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) return null;

    const { credential } = verification.registrationInfo;
    return {
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      signCounter: credential.counter,
      transports: credential.transports ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * Verifies an assertion against one stored credential.
 *
 * The caller has already resolved which credential this is, by id — that
 * lookup is the store's job, and doing it here would mean this module knew
 * about persistence.
 *
 * **The clone check is the library's, deliberately not ours.** Its rule is
 * `(presented > 0 || stored > 0) && presented <= stored`, and the subtlety is
 * worth stating because the obvious simplifications are both wrong. "Must
 * increase" locks out every synced passkey — iCloud Keychain and Google
 * Password Manager report zero forever, since a counter living on several
 * devices at once cannot be authoritative on any of them. But "ignore zero"
 * is wrong in the other direction: a device that counted to five and now
 * claims zero is precisely the clone the counter exists to catch. Reproducing
 * either half here would give one security rule two homes to drift between,
 * so a counter failure simply arrives as a refusal, like any other.
 */
export async function verifyAuthentication(input: {
  rp: RelyingParty;
  challenge: Base64Url;
  response: unknown;
  credential: { id: Base64Url; publicKey: Base64Url; signCounter: number };
}): Promise<VerifiedAuthentication | null> {
  try {
    const verification = await verifyAuthenticationResponse({
      response: input.response as Parameters<
        typeof verifyAuthenticationResponse
      >[0]['response'],
      expectedChallenge: input.challenge,
      expectedOrigin: input.rp.origin,
      expectedRPID: input.rp.id,
      requireUserVerification: true,
      credential: {
        id: input.credential.id,
        publicKey: new Uint8Array(Buffer.from(input.credential.publicKey, 'base64url')),
        counter: input.credential.signCounter,
      },
    });

    if (!verification.verified) return null;
    return { signCounter: verification.authenticationInfo.newCounter };
  } catch {
    return null;
  }
}
