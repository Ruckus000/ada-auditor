'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import type { FindingView } from '../../../../services/findings-view';
import { FONT, T } from '../../lib/tokens';

/**
 * Dismissing a finding, and undoing it.
 *
 * The only interactive part of the findings screen, and a client component on
 * its own so the rest of the tree stays server-rendered. It is deliberately
 * small: a reason and a button. The prototype's dismissal modal offered five
 * canned reasons ("handled elsewhere", "accepted risk, signed off"), which is a
 * taxonomy nobody has agreed to yet — the note is free text until somebody has.
 *
 * A dismissed finding stays on the screen, dimmed, with its reason. The
 * decision to ignore a barrier is itself something an auditor has to be able
 * to review, so hiding it would be the wrong kind of tidy.
 */
export function TriageControl({
  clientId,
  finding,
  pageUrl,
}: {
  clientId: string;
  finding: FindingView;
  /** Stored alongside the decision; the key alone cannot be split back apart. */
  pageUrl?: string;
}) {
  const router = useRouter();
  const noteId = useId();

  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: unknown, method: 'POST' | 'DELETE') {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/platform/clients/${clientId}/triage`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(parsed?.error ?? `That did not save (${response.status}).`);
        return;
      }

      setOpen(false);
      setNote('');
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  if (finding.triage !== null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => send({ findingKey: finding.key }, 'DELETE')}
          aria-label={`Reopen ${finding.code}${pageUrl ? ` on ${pageUrl}` : ''}`}
          style={link}
        >
          {busy ? 'Reopening…' : 'Reopen this finding'}
        </button>
        {error ? <Error>{error}</Error> : null}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        // Every row's control would otherwise be one more "Dismiss this
        // finding" in a screen reader's list of controls, with nothing to tell
        // them apart.
        aria-label={`Dismiss ${finding.code}${pageUrl ? ` on ${pageUrl}` : ''}`}
        style={link}
      >
        Dismiss this finding
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        void send(
          {
            findingKey: finding.key,
            state: 'dismissed',
            note,
            ...(pageUrl ? { pageUrl } : {}),
            ...(finding.selector ? { selector: finding.selector } : {}),
          },
          'POST',
        );
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <label
        htmlFor={noteId}
        style={{ fontFamily: FONT.sans, fontSize: 11.5, fontWeight: 650, color: T.inkSoft }}
      >
        Why is this not a barrier?
      </label>
      <textarea
        id={noteId}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        required
        rows={2}
        // Required, and enforced by the route too. A dismissal without a reason
        // is indistinguishable from a mistake, and this is the record an
        // auditor defends later.
        placeholder="Decorative, and hidden from the accessibility tree."
        style={{
          padding: '7px 9px',
          borderRadius: 7,
          border: `1px solid ${T.rule}`,
          fontFamily: FONT.sans,
          fontSize: 12.5,
          color: T.ink,
          resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="submit" disabled={busy || note.trim() === ''} style={primary}>
          {busy ? 'Saving…' : 'Dismiss'}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={link}>
          Cancel
        </button>
        {error ? <Error>{error}</Error> : null}
      </div>
    </form>
  );
}

function Error({ children }: { children: React.ReactNode }) {
  return (
    <span
      role="alert"
      style={{ fontFamily: FONT.sans, fontSize: 11.5, color: T.failDeep }}
    >
      {children}
    </span>
  );
}

const link = {
  padding: 0,
  border: 'none',
  background: 'none',
  fontFamily: FONT.sans,
  fontSize: 12,
  fontWeight: 600,
  color: T.accent,
  textDecoration: 'underline',
  cursor: 'pointer',
} as const;

const primary = {
  padding: '6px 12px',
  border: 'none',
  borderRadius: 7,
  background: T.accent,
  fontFamily: FONT.sans,
  fontSize: 12,
  fontWeight: 650,
  color: '#fff',
  cursor: 'pointer',
} as const;
