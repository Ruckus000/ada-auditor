'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { usePlatform } from '../lib/state';
import { FONT, T } from '../lib/tokens';
import { Modal, ModalFooter } from './ui';

/**
 * How a real client gets into the system.
 *
 * The prototype's "Add a client site" modal was scenery: read-only fields, and
 * a confirm button that jumped to a hardcoded fixture. This one posts to
 * `/api/platform/clients` and shows what the server says.
 *
 * It asks for a name and an owner, and nothing else. Starting URL, standard and
 * schedule all belonged to a journey, not a client — a client can have several
 * journeys against different URLs, and nothing in this system schedules
 * anything. Asking for them here would have been asking the operator to fill in
 * fields we then discard.
 */
export function AddClientModal() {
  const { actions } = usePlatform();
  const router = useRouter();
  const nameId = useId();
  const ownerId = useId();

  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => actions.patch({ modal: null });

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

      if (!response.ok) {
        // The server's message, not a generic one: "a name is required" and
        // "your session expired" need different things from the operator.
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Could not add the client (${response.status}).`);
        return;
      }

      close();
      // The portfolio is a Server Component; without this the new row does not
      // appear until something else happens to re-render it.
      router.refresh();
      actions.flash(`${name.trim()} added.`);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      screenLabel="Add a client"
      title="Add a client"
      subtitle="Then record a journey for them, and audit it."
      onClose={close}
      width={520}
    >
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Field
          id={nameId}
          label="Client name"
          value={name}
          onChange={setName}
          placeholder="Rosewood Dental"
          required
          autoFocus
          // The name becomes the URL, so it is worth saying so before they
          // type rather than after we have derived something they dislike.
          note="Used for their address, e.g. /clients/rosewood-dental."
          invalid={error !== null}
          errorId={error ? `${nameId}-error` : undefined}
        />

        <Field
          id={ownerId}
          label="Owner"
          value={owner}
          onChange={setOwner}
          placeholder="Optional"
          note="Who at your agency answers for this account."
        />

        {error ? (
          <p
            id={`${nameId}-error`}
            role="alert"
            style={{
              margin: 0,
              padding: '9px 12px',
              borderRadius: 8,
              background: T.failWash,
              border: `1px solid ${T.failEdge}`,
              color: T.failDeep,
              fontFamily: FONT.sans,
              fontSize: 12.5,
            }}
          >
            {error}
          </p>
        ) : null}

        <ModalFooter>
          <button type="button" onClick={close} className="ph-ghost" style={ghostButton}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || name.trim() === ''}
            className="ph-primary"
            style={{
              ...primaryButton,
              opacity: saving || name.trim() === '' ? 0.55 : 1,
              cursor: saving || name.trim() === '' ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Adding…' : 'Add client'}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  note,
  required = false,
  autoFocus = false,
  invalid = false,
  errorId,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  note?: string;
  required?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  errorId?: string;
}) {
  const noteId = `${id}-note`;

  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label
        htmlFor={id}
        style={{ fontFamily: FONT.sans, fontSize: 12, fontWeight: 650, color: T.inkSoft }}
      >
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog's own
        // focus management already moves focus here on open; this keeps the
        // first field focused rather than the close button.
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        aria-describedby={[note ? noteId : null, errorId].filter(Boolean).join(' ') || undefined}
        style={{
          padding: '9px 11px',
          borderRadius: 8,
          border: `1px solid ${invalid ? T.failEdge : T.rule}`,
          background: '#fff',
          fontFamily: FONT.sans,
          fontSize: 13.5,
          color: T.ink,
        }}
      />
      {note ? (
        <span id={noteId} style={{ fontFamily: FONT.sans, fontSize: 11.5, color: T.inkMuted }}>
          {note}
        </span>
      ) : null}
    </span>
  );
}

const ghostButton = {
  padding: '9px 15px',
  borderRadius: 9,
  border: `1px solid ${T.rule}`,
  background: '#fff',
  fontFamily: FONT.sans,
  fontSize: 12.5,
  fontWeight: 600,
  color: T.inkSoft,
  cursor: 'pointer',
} as const;

const primaryButton = {
  padding: '9px 15px',
  borderRadius: 9,
  border: 'none',
  background: T.accent,
  fontFamily: FONT.sans,
  fontSize: 12.5,
  fontWeight: 650,
  color: '#fff',
} as const;
