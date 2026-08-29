'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FONT, T } from '../lib/tokens';
import { PASSKEY_LABEL_MAX_LENGTH } from '../../../domain/platform';
import { browserSupportsPasskeys, registerPasskey, removePasskey } from '../../components/passkey-client';

/**
 * Managing the passkeys on your own account.
 *
 * The one interactive thing on a screen that is otherwise deliberately
 * read-only — and it belongs here rather than being a form that pretends to
 * change deployment config, because a passkey is genuinely per-operator state
 * that only the operator can create.
 *
 * The list is rendered from the server; this component owns the ceremonies and
 * refreshes the route afterwards, the same way `unlock-card` refreshes on
 * sign-in rather than mutating a local copy.
 */

export type PasskeySummary = {
  credentialId: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
};

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'That password is not right.',
  passkeys_not_configured:
    'Passkeys are not set up on this deployment. Set AUDITOR_RP_ID and AUDITOR_RP_ORIGIN.',
  passkey_challenge_expired: 'That took too long. Try again.',
  passkey_already_registered: 'This device already has a passkey on this account.',
  passkey_registration_failed: 'That device could not be registered. Try again.',
  passkey_failed: 'Something went wrong with that device. Try again.',
  too_many_attempts: 'Too many attempts. Wait five minutes and try again.',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function PasskeysCard({
  passkeys,
  configured,
}: {
  passkeys: PasskeySummary[];
  configured: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [password, setPassword] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported = browserSupportsPasskeys();

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !password || !label.trim()) return;

    setBusy(true);
    setError(null);
    const outcome = await registerPasskey({ password, label: label.trim() });
    setBusy(false);

    if (outcome.ok) {
      setPassword('');
      setLabel('');
      setAdding(false);
      router.refresh();
      return;
    }
    // Pressing Escape on the OS prompt is a decision, not an error.
    if (outcome.code === 'passkey_cancelled') return;

    setError(MESSAGES[outcome.code] ?? 'Could not add that passkey.');
  }

  async function remove(credentialId: string) {
    setBusy(true);
    setError(null);
    const outcome = await removePasskey(credentialId);
    setBusy(false);

    if (outcome.ok) {
      router.refresh();
      return;
    }
    setError(MESSAGES[outcome.code] ?? 'Could not remove that passkey.');
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 650 }}>Your passkeys</h2>
        <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13, color: T.inkMuted }}>
          Sign in with the fingerprint, face, or PIN on a device instead of a password. Your
          password keeps working either way — it is how you get back in if you lose every device.
        </p>
      </div>

      {passkeys.length === 0 ? (
        <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13, color: T.inkSoft }}>
          No passkeys yet.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {passkeys.map((passkey) => (
            <li
              key={passkey.credentialId}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 9,
                border: `1px solid ${T.rule}`,
                background: T.surfaceSunk,
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontFamily: FONT.sans, fontSize: 13, fontWeight: 600 }}>
                  {passkey.label}
                </span>
                <span style={{ fontFamily: FONT.sans, fontSize: 12, color: T.inkMuted }}>
                  Added {formatDate(passkey.createdAt)}
                  {passkey.lastUsedAt
                    ? ` · last used ${formatDate(passkey.lastUsedAt)}`
                    : ' · never used'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(passkey.credentialId)}
                disabled={busy}
                style={{
                  fontFamily: FONT.sans,
                  fontSize: 12,
                  padding: '5px 10px',
                  borderRadius: 7,
                  border: `1px solid ${T.rule}`,
                  background: 'transparent',
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13, color: T.fail }}>
          {error}
        </p>
      )}

      {!configured ? (
        <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13, color: T.inkSoft }}>
          Passkeys are off on this deployment. Set <code>AUDITOR_RP_ID</code> and{' '}
          <code>AUDITOR_RP_ORIGIN</code> to turn them on.
        </p>
      ) : !supported ? (
        <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13, color: T.inkSoft }}>
          This browser does not support passkeys.
        </p>
      ) : adding ? (
        <form onSubmit={add} style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'grid', gap: 4 }}>
            <label htmlFor="passkey-label" style={{ fontFamily: FONT.sans, fontSize: 13 }}>
              Name this device
            </label>
            <input
              id="passkey-label"
              value={label}
              maxLength={PASSKEY_LABEL_MAX_LENGTH}
              placeholder="Work laptop"
              onChange={(e) => setLabel(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 7, border: `1px solid ${T.rule}` }}
            />
          </div>
          <div style={{ display: 'grid', gap: 4 }}>
            <label htmlFor="passkey-password" style={{ fontFamily: FONT.sans, fontSize: 13 }}>
              Your password
            </label>
            <input
              id="passkey-password"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby="passkey-password-help"
              style={{ padding: '7px 10px', borderRadius: 7, border: `1px solid ${T.rule}` }}
            />
            <p
              id="passkey-password-help"
              style={{ margin: 0, fontFamily: FONT.sans, fontSize: 12, color: T.inkMuted }}
            >
              Asked again even though you are signed in: a passkey outlives a session, so someone
              who got hold of this browser should not be able to add one.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" disabled={busy || !password || !label.trim()}>
              {busy ? 'Waiting for your device…' : 'Add passkey'}
            </button>
            <button type="button" onClick={() => setAdding(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} style={{ justifySelf: 'start' }}>
          Add a passkey
        </button>
      )}
    </section>
  );
}
