'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FONT, T } from '../../lib/tokens';

/**
 * Assign a finding to somebody.
 *
 * `finding_triage.state` has always allowed `assigned`, the store has always
 * had it, and the route has always required an assignee — but no control ever
 * offered it, because there was nobody to point at. One shared token meant one
 * anonymous operator. Named accounts are what make this reachable, and this is
 * the control that reaches it.
 *
 * The list is fetched rather than passed down because the findings screen is a
 * Server Component rendering one of these per row: threading operators through
 * would mean loading them for a page that may never assign anything.
 */

export function AssignControl({
  clientId,
  findingKey,
  findingCode,
  pageUrl,
  selector,
}: {
  clientId: string;
  findingKey: string;
  findingCode: string;
  pageUrl?: string;
  selector?: string;
}) {
  const router = useRouter();
  const selectId = useId();
  const [operators, setOperators] = useState<Array<{ id: string; name: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/platform/operators')
      .then((response) => (response.ok ? response.json() : { operators: [] }))
      .then((payload: { operators?: Array<{ id: string; name: string }> }) => {
        if (!cancelled) setOperators(payload.operators ?? []);
      })
      .catch(() => {
        if (!cancelled) setOperators([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing to assign to yet. Rendering an empty select would be a control
  // that cannot do anything, which is the kind of scenery this codebase
  // deleted a phase ago.
  if (operators !== null && operators.length === 0) return null;

  async function assign(operatorId: string) {
    if (!operatorId) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/platform/clients/${clientId}/triage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          findingKey,
          state: 'assigned',
          assigneeOperatorId: operatorId,
          assignee: operators?.find((operator) => operator.id === operatorId)?.name,
          ...(pageUrl ? { pageUrl } : {}),
          ...(selector ? { selector } : {}),
        }),
      });

      if (!response.ok) {
        const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(parsed?.error ?? `That did not save (${response.status}).`);
        return;
      }

      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {error ? (
        <span role="alert" style={{ fontFamily: FONT.sans, fontSize: 11.5, color: T.fail }}>
          {error}
        </span>
      ) : null}

      {/*
        A real label, not a placeholder option. `select-name` is asserted at
        zero violations across these screens, and every row would otherwise be
        another unnamed select in a screen reader's list.
      */}
      <label
        htmlFor={selectId}
        style={{ fontFamily: FONT.sans, fontSize: 11.5, color: T.inkMuted }}
      >
        Assign {findingCode}
        {pageUrl ? ` on ${pageUrl}` : ''} to
      </label>
      <select
        id={selectId}
        defaultValue=""
        disabled={busy || operators === null}
        onChange={(event) => assign(event.target.value)}
        style={{
          fontFamily: FONT.sans,
          fontSize: 11.5,
          padding: '4px 6px',
          borderRadius: 6,
          border: `1px solid ${T.rule}`,
          background: busy ? T.surfaceSunk : T.surface,
          color: T.ink,
        }}
      >
        <option value="">Nobody</option>
        {(operators ?? []).map((operator) => (
          <option key={operator.id} value={operator.id}>
            {operator.name}
          </option>
        ))}
      </select>
    </span>
  );
}
