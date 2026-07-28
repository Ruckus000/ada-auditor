'use client';

import { useState } from 'react';
import { InfoTip } from './info-tip';

const MESSAGES: Record<string, string> = {
  invalid_token: 'That token does not match the one set on the server. Check for stray spaces.',
  too_many_attempts: 'Too many failed attempts. Wait five minutes and try again.',
  auditor_run_token_not_configured:
    'The server has no AUDITOR_RUN_TOKEN set, so there is nothing to unlock with yet.',
  auditor_run_token_too_weak:
    'The server token is too short to be used as a console password. Set a longer AUDITOR_RUN_TOKEN (32+ random characters).',
  console_same_origin_required: 'Reload the page and try again.',
};

export function UnlockCard({ onUnlocked }: { onUnlocked: () => void }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!token.trim() || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/console/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      if (res.ok) {
        setToken('');
        onUnlocked();
        return;
      }

      const body = await res.json().catch(() => ({}));
      setError(
        MESSAGES[body?.error as string] ?? 'Could not unlock the console. Please try again.',
      );
    } catch {
      setError('Could not reach the server. Check that the app is still running.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="console-card unlock-card" aria-labelledby="unlock-heading">
      <p className="step-eyebrow">Locked</p>
      <h1 id="unlock-heading" className="console-title">
        Unlock the console
      </h1>
      <p className="console-sub">
        Running an audit uses the server&rsquo;s credentials, so the console asks for the run token
        once per browser. After that it stays unlocked for 30 days and you never paste it again.
      </p>

      <form className="run-form" onSubmit={submit}>
        <div className="field">
          <span className="field-label-row">
            <label htmlFor="console-token">Run token</label>
            <InfoTip termKey="consoleUnlock" />
          </span>
          <input
            id="console-token"
            type="password"
            value={token}
            autoComplete="current-password"
            spellCheck={false}
            onChange={(e) => setToken(e.target.value)}
            aria-describedby="unlock-help"
            aria-invalid={error ? true : undefined}
          />
          <p className="field-help" id="unlock-help">
            This is the <code>AUDITOR_RUN_TOKEN</code> value from <code>.env.local</code> (or your
            Vercel environment variables).
          </p>
        </div>

        {error && (
          <p className="callout callout-error" role="alert">
            {error}
          </p>
        )}

        <button className="submit-btn" type="submit" disabled={submitting || !token.trim()}>
          {submitting ? 'Unlocking…' : 'Unlock console'}
        </button>
      </form>
    </section>
  );
}
