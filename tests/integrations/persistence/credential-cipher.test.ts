import { describe, expect, it } from 'vitest';
import {
  CredentialCipherError,
  decryptCredential,
  encryptCredential,
  isCredentialStoreConfigured,
} from '../../../src/integrations/persistence/credential-cipher';

/**
 * The cipher behind `client_credentials`, held to the properties the store
 * depends on rather than to its implementation.
 *
 * The sentinel is deliberately obvious: these tests grep error text for it,
 * and a value that could plausibly appear in a message by coincidence would
 * make that grep prove nothing.
 */

/** 64 hex chars — what `openssl rand -hex 32` produces. Not a secret. */
const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);
const SENTINEL = 'hunter2-sentinel-not-a-real-password';

const env = (key?: string) =>
  key === undefined ? {} : { AUDITOR_CREDENTIAL_KEY: key };

describe('credential cipher', () => {
  it('round-trips a value', () => {
    const ciphertext = encryptCredential(SENTINEL, env(KEY));
    expect(decryptCredential(ciphertext, env(KEY))).toBe(SENTINEL);
  });

  it('writes the versioned wire format with a fresh nonce every time', () => {
    const first = encryptCredential(SENTINEL, env(KEY));
    const second = encryptCredential(SENTINEL, env(KEY));

    // 12-byte nonce, 16-byte GCM tag, both hex. The version prefix is what
    // lets a future format change read old rows instead of failing on them.
    expect(first).toMatch(/^v1:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    // A repeated nonce under GCM forfeits the whole scheme, so two writes of
    // one value must never serialise identically.
    expect(first).not.toBe(second);
    // The value itself must not be legible in what lands in the column.
    expect(first).not.toContain(SENTINEL);
  });

  it('detects tampering through the GCM tag', () => {
    const ciphertext = encryptCredential(SENTINEL, env(KEY));
    // Flip one character of the ciphertext body without touching the format,
    // so the failure can only come from authentication, not parsing.
    const last = ciphertext.at(-1);
    const tampered = ciphertext.slice(0, -1) + (last === '0' ? '1' : '0');

    expect(() => decryptCredential(tampered, env(KEY))).toThrow(CredentialCipherError);
  });

  it('refuses a key that is not 64 hex characters', () => {
    for (const short of ['a'.repeat(32), 'not-hex-'.repeat(8), '']) {
      expect(() => encryptCredential(SENTINEL, env(short))).toThrow(CredentialCipherError);
      expect(() => decryptCredential('v1:00:00:00', env(short))).toThrow(CredentialCipherError);
    }
    expect(() => encryptCredential(SENTINEL, env())).toThrow(CredentialCipherError);
  });

  it('refuses ciphertext that is not in the recognised format', () => {
    for (const junk of ['', 'v2:aa:bb:cc', 'plaintext', 'v1:zz:zz:zz', 'v1:aa:bb']) {
      expect(() => decryptCredential(junk, env(KEY))).toThrow(CredentialCipherError);
    }
  });

  it('never names the plaintext or the key in a failure', () => {
    // The error surface travels: a decrypt failure on the run path reaches a
    // log line and a classifier. Whatever it says, it must not be the secret
    // it failed to produce or the key it failed with.
    const ciphertext = encryptCredential(SENTINEL, env(KEY));

    const failures: unknown[] = [];
    for (const attempt of [
      () => decryptCredential(ciphertext, env(OTHER_KEY)),
      () => decryptCredential('v1:aa:bb:cc', env(KEY)),
      () => encryptCredential(SENTINEL, env('a'.repeat(10))),
    ]) {
      try {
        attempt();
      } catch (error) {
        failures.push(error);
      }
    }

    expect(failures).toHaveLength(3);
    for (const error of failures) {
      const text = `${(error as Error).message}\n${(error as Error).stack ?? ''}`;
      expect(text).not.toContain(SENTINEL);
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(OTHER_KEY);
    }
  });

  it('reports whether the store is configured without throwing', () => {
    expect(isCredentialStoreConfigured(env(KEY))).toBe(true);
    expect(isCredentialStoreConfigured(env(KEY.toUpperCase()))).toBe(true);
    expect(isCredentialStoreConfigured(env('a'.repeat(32)))).toBe(false);
    expect(isCredentialStoreConfigured(env('not hex'.repeat(8)))).toBe(false);
    expect(isCredentialStoreConfigured(env())).toBe(false);
  });
});
