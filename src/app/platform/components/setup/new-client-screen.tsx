'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { usePlatform } from '../../lib/state';
import { FONT, T } from '../../lib/tokens';
import { StageIndicator } from './stage-indicator';

/**
 * Stage 1: name the client. The Add Client modal, promoted to a route and
 * given the two things the modal never had — human error copy and a duplicate
 * hint — because this is now the front door of a flow, not a detour.
 */
const MESSAGES: Record<string, string> = {
  invalid_request_body: 'Check the client’s name — it needs 1 to 120 characters.',
  unauthorized: 'Your session expired. Reload and sign in again.',
};

export function NewClientScreen({ existingNames }: { existingNames: string[] }) {
  const { actions } = usePlatform();
  const router = useRouter();
  const nameId = useId();
  const ownerId = useId();

  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const duplicate = existingNames.some(
    (existing) => existing.trim().toLowerCase() === name.trim().toLowerCase(),
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/platform/clients', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, ...(owner.trim() ? { owner: owner.trim() } : {}) }),
      });

      const body = (await response.json().catch(() => null)) as
        | { error?: string; client?: { id: string } }
        | null;

      if (!response.ok || !body?.client) {
        setError(
          (body?.error && MESSAGES[body.error]) ??
            `Could not add the client (${response.status}). Try again.`,
        );
        setSaving(false);
        return;
      }

      actions.flash(`${name.trim()} added.`);
      // `replace`, not `push`: browser-back from the setup stages must land on
      // the portfolio, not on an empty create form that reads as "edit".
      router.replace(`/clients/${body.client.id}/setup`);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setSaving(false);
    }
  }

  return (
    <div data-screen-label="Add a client" style={{ maxWidth: 520 }}>
      <div style={{ marginBottom: 14 }}>
        <StageIndicator current={0} />
      </div>
      <h2 style={{ margin: '0 0 4px', fontSize: 19, fontWeight: 700, letterSpacing: '-0.01em' }}>
        Add a client
      </h2>
      <p style={{ margin: '0 0 18px', fontFamily: FONT.sans, fontSize: 13.5, color: T.inkSoft }}>
        Then say where we audit, and run their first audit — about two minutes end to end.
      </p>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label htmlFor={nameId} style={labelStyle}>
            Client name
          </label>
          <input
            id={nameId}
            value={name}
            maxLength={120}
            required
            placeholder="Rosewood Dental"
            onChange={(event) => setName(event.target.value)}
            aria-invalid={error !== null && MESSAGES.invalid_request_body === error ? true : undefined}
            aria-describedby={`${nameId}-note${error ? ` ${nameId}-error` : ''}`}
            style={inputStyle}
          />
          <span id={`${nameId}-note`} style={noteStyle}>
            Used for their address, e.g. /clients/rosewood-dental.
          </span>
          {duplicate ? (
            <span role="status" style={{ ...noteStyle, color: T.inkSoft }}>
              You already have a client named {name.trim()} — adding this one creates a second
              client, not an update.
            </span>
          ) : null}
        </span>

        <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label htmlFor={ownerId} style={labelStyle}>
            Owner
          </label>
          <input
            id={ownerId}
            value={owner}
            maxLength={120}
            placeholder="Optional"
            onChange={(event) => setOwner(event.target.value)}
            aria-describedby={`${ownerId}-note`}
            style={inputStyle}
          />
          <span id={`${ownerId}-note`} style={noteStyle}>
            Who at your agency answers for this account.
          </span>
        </span>

        {error ? (
          <p id={`${nameId}-error`} role="alert" style={errorStyle}>
            {error}
          </p>
        ) : null}

        <span style={{ display: 'flex', gap: 10 }}>
          <button
            type="submit"
            disabled={saving || name.trim() === ''}
            className="ph-primary"
            style={{
              padding: '9px 18px',
              border: 'none',
              borderRadius: 9,
              background: T.accent,
              color: '#fff',
              fontFamily: FONT.sans,
              fontSize: 12.5,
              fontWeight: 650,
              opacity: saving || name.trim() === '' ? 0.55 : 1,
              cursor: saving || name.trim() === '' ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Adding…' : 'Add client'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="ph-ghost"
            style={{
              padding: '9px 15px',
              borderRadius: 9,
              border: `1px solid ${T.rule}`,
              background: '#fff',
              fontFamily: FONT.sans,
              fontSize: 12.5,
              fontWeight: 600,
              color: T.inkSoft,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </span>
      </form>
    </div>
  );
}

const labelStyle = {
  fontFamily: FONT.sans,
  fontSize: 12,
  fontWeight: 650,
  color: T.inkSoft,
} as const;

const inputStyle = {
  padding: '9px 11px',
  borderRadius: 8,
  border: `1px solid ${T.rule}`,
  background: '#fff',
  fontFamily: FONT.sans,
  fontSize: 13.5,
  color: T.ink,
} as const;

const noteStyle = {
  fontFamily: FONT.sans,
  fontSize: 11.5,
  color: T.inkMuted,
} as const;

const errorStyle = {
  margin: 0,
  padding: '9px 12px',
  borderRadius: 8,
  background: T.failWash,
  border: `1px solid ${T.failEdge}`,
  color: T.failDeep,
  fontFamily: FONT.sans,
  fontSize: 12.5,
} as const;
