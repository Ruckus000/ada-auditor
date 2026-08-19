'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { inertWhen } from '../../lib/inert-button';
import { FONT, T } from '../../lib/tokens';

/**
 * Archives the wizard's journey and returns the flow to "where do we audit".
 * Archive, not delete — the label says so, because the row and any runs it
 * produced survive in the database.
 *
 * No confirm step, deliberately: the action is recoverable at the database,
 * the label says exactly what it does, and it only renders on the failed
 * stage — one more wall in front of an operator who already needs a way out
 * would cost more than it protects.
 */
const MESSAGES: Record<string, string> = {
  journey_not_found: 'That journey is no longer on this client.',
  unauthorized: 'Your session expired. Reload and sign in again.',
};

/** A network failure never reached the server, so it never got a server error code. */
const NETWORK_ERROR_CODE = 'network';

export function StartOverButton({ clientId, journeyId }: { clientId: string; journeyId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function startOver() {
    if (busy) return;
    setBusy(true);
    setErrorCode(null);
    try {
      const response = await fetch(`/api/platform/clients/${clientId}/journeys/${journeyId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setErrorCode(body?.error ?? `status_${response.status}`);
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setErrorCode('network');
      setBusy(false);
    }
  }

  const errorMessage =
    errorCode === null
      ? null
      : errorCode === NETWORK_ERROR_CODE
        ? 'Could not reach the server. Check your connection and try again.'
        : (MESSAGES[errorCode] ?? 'Could not archive the journey. Try again.');

  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
      {errorMessage ? (
        <p role="alert" style={{ margin: 0, fontFamily: FONT.sans, fontSize: 12.5, color: T.fail }}>
          {errorMessage}
        </p>
      ) : null}
      <button
        type="button"
        {...inertWhen(busy, startOver)}
        style={{
          fontFamily: FONT.sans,
          fontSize: 12.5,
          fontWeight: 600,
          padding: '6px 12px',
          borderRadius: 8,
          border: `1px solid ${T.rule}`,
          background: busy ? T.surfaceSunk : T.surface,
          color: busy ? T.inkMuted : T.ink,
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy ? 'Archiving…' : 'Archive this journey and start over with a different URL'}
      </button>
    </span>
  );
}
