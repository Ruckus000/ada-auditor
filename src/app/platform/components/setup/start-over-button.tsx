'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { NETWORK_ERROR_CODE, useErrorCode } from '../../lib/error-copy';
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
export function StartOverButton({ clientId, journeyId }: { clientId: string; journeyId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Every code this button can receive is one more than one form receives, so
  // it carries no map of its own.
  const { errorMessage, setErrorCode, clearError } = useErrorCode(
    {},
    () => 'Could not archive the journey. Try again.',
  );

  async function startOver() {
    if (busy) return;
    setBusy(true);
    clearError();
    try {
      const response = await fetch(`/api/platform/clients/${clientId}/journeys/${journeyId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setErrorCode(body?.error ?? `status_${response.status}`, response.status);
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setErrorCode(NETWORK_ERROR_CODE);
      setBusy(false);
    }
  }

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
