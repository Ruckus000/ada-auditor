'use client';

import { useEffect, useState } from 'react';
import { InfoTip } from './info-tip';
import { browserSupportsPasskeys, signInWithPasskey } from './passkey-client';

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'That email and password do not match an operator account.',
  operator_disabled: 'That account has been disabled. Ask whoever administers this deployment.',
  invalid_token: 'That token does not match the one set on the server. Check for stray spaces.',
  too_many_attempts: 'Too many failed attempts. Wait five minutes and try again.',
  auditor_run_token_not_configured:
    'The server has no AUDITOR_RUN_TOKEN set, so there is nothing to unlock with yet.',
  auditor_run_token_too_weak:
    'The server token is too short to be used as a console password. Set a longer AUDITOR_RUN_TOKEN (32+ random characters).',
  console_same_origin_required: 'Reload the page and try again.',
  passkeys_not_configured:
    'Passkeys are not set up on this deployment. Sign in with your password instead.',
  passkey_challenge_expired: 'That took too long. Try the passkey again.',
  passkey_failed: 'That passkey could not be used. Try again, or sign in with your password.',
};

/**
 * Two ways in, and the second one is deliberately tucked away.
 *
 * Signing in with an email and a password is how a person should do it: the
 * session then names them, so what they do is attributable and a finding can
 * be assigned to them.
 *
 * The run token still works, because it has to. It is how CI reaches the
 * console, and it is the only way in before the first operator account exists
 * — that account is created by `npm run operator -- add`, which needs a
 * database URL and a terminal. Putting it behind a disclosure keeps it
 * available without presenting a shared secret as the normal way to sign in.
 */
export function UnlockCard({ onUnlocked }: { onUnlocked: () => void }) {
  const [passkeysOffered, setPasskeysOffered] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = Boolean((email.trim() && password) || token.trim());

  /**
   * Offered only when both halves are true: this browser can do WebAuthn, and
   * the server has a relying party configured. Asked after mount rather than
   * rendered from a prop, because the locked screen is what an unauthenticated
   * visitor sees and this status probe is the one call it is already allowed
   * to make.
   */
  useEffect(() => {
    if (!browserSupportsPasskeys()) return;

    let cancelled = false;
    fetch('/api/console/session')
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { passkeysConfigured?: boolean } | null) => {
        if (!cancelled && payload?.passkeysConfigured) setPasskeysOffered(true);
      })
      .catch(() => {
        // The password form is right there. A status probe that fails is not
        // worth an error message of its own.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function usePasskey() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const outcome = await signInWithPasskey();
    setSubmitting(false);

    if (outcome.ok) {
      onUnlocked();
      return;
    }
    // Cancelling the OS prompt is a choice, not a failure. Saying "could not
    // sign in" to someone who just pressed Escape is the console arguing with
    // a decision the person already made.
    if (outcome.code === 'passkey_cancelled') return;

    setError(MESSAGES[outcome.code] ?? 'Could not sign in with that passkey.');
  }

  async function post(body: Record<string, string>) {
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/console/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setEmail('');
        setPassword('');
        setToken('');
        onUnlocked();
        return;
      }

      const payload = await res.json().catch(() => ({}));
      setError(MESSAGES[payload?.error as string] ?? 'Could not sign in. Please try again.');
    } catch {
      setError('Could not reach the server. Check that the app is still running.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting || !canSubmit) return;

    // Whichever set of fields was filled in. The token path is only taken when
    // no email was given, so a half-filled sign-in never silently falls back
    // to a shared secret.
    await (email.trim() || password
      ? post({ email: email.trim(), password })
      : post({ token }));
  }

  return (
    <section className="console-card unlock-card" aria-labelledby="unlock-heading">
      <p className="step-eyebrow">Locked</p>
      <h1 id="unlock-heading" className="console-title">
        Sign in
      </h1>
      <p className="console-sub">
        Running an audit uses the server&rsquo;s credentials, so the console asks who you are once
        per browser. After that it stays signed in for 30 days.
      </p>

      {passkeysOffered && (
        <div className="passkey-signin">
          <button
            className="submit-btn"
            type="button"
            onClick={usePasskey}
            disabled={submitting}
          >
            {submitting ? 'Waiting for your device…' : 'Sign in with a passkey'}
          </button>
          <p className="field-help">
            Uses the fingerprint, face, or PIN on this device. Nothing to type and nothing to
            remember.
          </p>
          <p className="passkey-divider" aria-hidden="true">
            or
          </p>
        </div>
      )}

      <form className="run-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="operator-email">Email</label>
          <input
            id="operator-email"
            name="email"
            type="email"
            value={email}
            autoComplete="username webauthn"
            spellCheck={false}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
        </div>

        <div className="field">
          <label htmlFor="operator-password">Password</label>
          <input
            id="operator-password"
            name="password"
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="operator-help"
            aria-invalid={error ? true : undefined}
          />
          <p className="field-help" id="operator-help">
            Operator accounts are created with <code>npm run operator -- add</code>.
          </p>
        </div>

        <details className="advanced">
          <summary>Use the run token instead</summary>
          <div className="field">
            <span className="field-label-row">
              <label htmlFor="console-token">Run token</label>
              <InfoTip termKey="consoleUnlock" />
            </span>
            <input
              id="console-token"
              name="run-token"
              type="password"
              value={token}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setToken(e.target.value)}
              aria-describedby="unlock-help"
            />
            <p className="field-help" id="unlock-help">
              The <code>AUDITOR_RUN_TOKEN</code> value. This is a machine credential — CI uses it,
              and it is the way in before the first operator account exists. What it does is not
              attributed to a person.
            </p>
          </div>
        </details>

        {error && (
          <p className="callout callout-error" role="alert">
            {error}
          </p>
        )}

        <button className="submit-btn" type="submit" disabled={submitting || !canSubmit}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </section>
  );
}
