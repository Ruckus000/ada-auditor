'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { usePlatform } from '../../lib/state';
import { inertWhen } from '../../lib/inert-button';
import { FONT, T } from '../../lib/tokens';
import { ScreenHeading } from '../ui';
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

/** A network failure never reached the server, so it never got a server error code. */
const NETWORK_ERROR_CODE = 'network';

export function NewClientScreen({ existingNames }: { existingNames: string[] }) {
  const { actions } = usePlatform();
  const router = useRouter();
  const nameId = useId();
  const ownerId = useId();

  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [saving, setSaving] = useState(false);
  // The code, not the sentence: the sentence is derived at render, and only
  // `invalid_request_body` gets to describe the name field (see below) — a
  // decision that is only possible to make from the code, not from prose that
  // has already forgotten which field it was about.
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  const duplicate = existingNames.some(
    (existing) => existing.trim().toLowerCase() === name.trim().toLowerCase(),
  );

  const errorMessage =
    errorCode === null
      ? null
      : errorCode === NETWORK_ERROR_CODE
        ? 'Could not reach the server. Check your connection and try again.'
        : (MESSAGES[errorCode] ?? `Could not add the client (${errorStatus}). Try again.`);

  const blocked = saving || name.trim() === '';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    // `inertWhen` keeps the button in the tab order rather than truly
    // `disabled`, so Enter typed into the name field can still reach the
    // form's submit event directly. This is the guard `disabled` used to
    // provide.
    if (name.trim() === '') return;

    setSaving(true);
    setErrorCode(null);
    setErrorStatus(null);

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
        setErrorCode(body?.error ?? 'unknown');
        setErrorStatus(response.status);
        setSaving(false);
        return;
      }

      actions.flash(`${name.trim()} added.`);
      // `replace`, not `push`: browser-back from the setup stages must land on
      // the portfolio, not on an empty create form that reads as "edit".
      router.replace(`/clients/${body.client.id}/setup`);
    } catch {
      setErrorCode(NETWORK_ERROR_CODE);
      setSaving(false);
    }
  }

  return (
    <div data-screen-label="Add a client" style={{ maxWidth: 520 }}>
      <div style={{ marginBottom: 14 }}>
        <StageIndicator current={0} />
      </div>
      <div style={{ marginBottom: 18 }}>
        <ScreenHeading
          title="Add a client"
          lede="Then say where we audit, and run their first audit — about two minutes end to end."
        />
      </div>

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
            // No `eslint-disable` needed — `jsx-a11y/no-autofocus` is not
            // wired into this repo's config, the same reason the deleted
            // modal's own disable comment was already dead code. The
            // justification still holds regardless: landing on this route
            // *is* the operator choosing to add a client, and the name field
            // is the only thing to do here, so autofocus is not stealing
            // attention from anything else on the page.
            autoFocus
            aria-invalid={errorCode === 'invalid_request_body' ? true : undefined}
            aria-describedby={[
              `${nameId}-note`,
              `${nameId}-dup`,
              errorCode === 'invalid_request_body' ? `${nameId}-error` : null,
            ]
              .filter(Boolean)
              .join(' ')}
            style={inputStyle}
          />
          <span id={`${nameId}-note`} style={noteStyle}>
            Used for their address, e.g. /clients/rosewood-dental.
          </span>
          {/* Always mounted, text toggled — not mounted only when duplicate.
              Mounting the region and the text together is the classic way to
              ship a confirmation nobody hears, the same defect `toast.tsx`
              documents; a live region has to already be on the page for
              assistive technology to be watching it when the text arrives.
              That same always-mounted node is also listed in the name
              field's `aria-describedby` above, so it does double duty on
              purpose: it announces the hint as a live region when the text
              changes, and it is read as part of the field's description on
              focus even while empty. Deliberate — don't split it into a
              separate description-only node under the mistaken impression
              the live region is accidentally leaking into the description. */}
          <span role="status" id={`${nameId}-dup`} style={{ ...noteStyle, color: T.inkSoft }}>
            {duplicate
              ? `You already have a client named ${name.trim()} — adding this one creates a second client, not an update.`
              : ''}
          </span>
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

        {errorMessage ? (
          <p id={`${nameId}-error`} role="alert" style={errorStyle}>
            {errorMessage}
          </p>
        ) : null}

        <span style={{ display: 'flex', gap: 10 }}>
          <button
            type="submit"
            {...inertWhen(blocked, () => {})}
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
              opacity: blocked ? 0.55 : 1,
              cursor: blocked ? 'not-allowed' : 'pointer',
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
