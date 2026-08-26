import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * How a client credential becomes a database column, and comes back.
 *
 * AES-256-GCM from `node:crypto` — no new dependency, and an authenticated
 * mode on purpose: a row edited in the database must fail to decrypt rather
 * than type a corrupted value into a client's login form. The wire format is
 *
 *   `v1:<hex nonce>:<hex tag>:<hex ciphertext>`
 *
 * with a fresh 12-byte nonce per write, because a repeated nonce under GCM
 * forfeits both confidentiality and the tag. The `v1` prefix is what lets a
 * future format read old rows instead of guessing at them.
 *
 * The key is `AUDITOR_CREDENTIAL_KEY`, 64 hex characters (`openssl rand -hex
 * 32`). Absent or malformed means the store is *disabled*, not degraded: the
 * write routes answer 503 rather than storing something they could never read
 * back, and the env-var fallback (`AUDIT_CREDENTIAL_<REF>_<FIELD>`) is
 * untouched. Losing the key means re-entering credentials — that is the
 * designed recovery, and the reason there is no export.
 *
 * Every failure here throws `CredentialCipherError` with a constant sentence.
 * These errors travel — into log lines, classifiers, and API bodies — so none
 * of them may carry the plaintext, the key, or anything derived from either;
 * the cipher tests grep for exactly that.
 */

const KEY_ENV = 'AUDITOR_CREDENTIAL_KEY';

/** 32 bytes of key, spelled as hex. Case-insensitive because hex is. */
const KEY_SHAPE = /^[0-9a-fA-F]{64}$/;

const NONCE_BYTES = 12;

/** Just enough of `process.env` to read from, so a test can hand in a literal. */
type EnvLike = Record<string, string | undefined>;

export class CredentialCipherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialCipherError';
  }
}

/**
 * Whether the encrypted store can work at all.
 *
 * Presence *and* shape: a key of the wrong length would make every write an
 * error, so reporting it as configured would promise something the first PUT
 * refuses. Never throws — `/api/ready` calls this, and readiness must not go
 * down over a value it only reports.
 */
export function isCredentialStoreConfigured(env: EnvLike = process.env): boolean {
  return KEY_SHAPE.test(env[KEY_ENV] ?? '');
}

function readKey(env: EnvLike): Buffer {
  const raw = env[KEY_ENV];
  if (!raw || !KEY_SHAPE.test(raw)) {
    // One sentence for absent and malformed alike: the caller's remedy is the
    // same, and a message that distinguished them would have to describe the
    // value it refused.
    throw new CredentialCipherError(
      `${KEY_ENV} must be 64 hex characters (openssl rand -hex 32).`,
    );
  }
  return Buffer.from(raw, 'hex');
}

export function encryptCredential(plaintext: string, env: EnvLike = process.env): string {
  const key = readKey(env);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [
    'v1',
    nonce.toString('hex'),
    cipher.getAuthTag().toString('hex'),
    ciphertext.toString('hex'),
  ].join(':');
}

export function decryptCredential(stored: string, env: EnvLike = process.env): string {
  const key = readKey(env);

  const [version, nonceHex, tagHex, ciphertextHex, ...extra] = stored.split(':');
  if (
    version !== 'v1' ||
    extra.length > 0 ||
    !nonceHex ||
    !tagHex ||
    ciphertextHex === undefined ||
    !/^[0-9a-f]*$/.test(nonceHex + tagHex + ciphertextHex)
  ) {
    throw new CredentialCipherError('Stored credential is not in a recognised format.');
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Wrong key, truncated nonce and a tampered byte all land here, and they
    // are deliberately not told apart: the distinction is not actionable by
    // the caller, and node's own error object is the kind of thing that grows
    // detail between releases. The constant sentence is the guarantee.
    throw new CredentialCipherError('Stored credential could not be decrypted.');
  }
}
