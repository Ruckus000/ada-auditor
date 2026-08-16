'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { JourneyRunRefusal } from '../../../../domain/platform';
import { FONT, T } from '../../lib/tokens';

/**
 * How often a journey re-runs.
 *
 * Three words rather than a cron field. `compareToBaseline` has always
 * computed what changed since the previous run, which is the product's actual
 * promise; until the scheduler existed nothing ever produced the second run,
 * so an operator had to remember. This is the control that makes it stop being
 * somebody's job to remember.
 *
 * A real `<label>`, not a placeholder option: the axe suite runs over these
 * screens at zero violations, and `select-name` fails outright without one.
 */

const OPTIONS: Array<{ value: 'off' | 'daily' | 'weekly'; label: string }> = [
  { value: 'off', label: 'No schedule' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

const MESSAGES: Record<string, string> = {
  journey_not_runnable: 'A journey with no target URL cannot be scheduled.',
  journey_not_found: 'That journey is no longer on this client.',
  unauthorized: 'Your session expired. Reload and sign in again.',
};

export function JourneySchedule({
  clientId,
  journeyId,
  journeyName,
  schedule,
  runRefusal,
}: {
  clientId: string;
  journeyId: string;
  journeyName: string;
  schedule: 'off' | 'daily' | 'weekly';
  runRefusal: JourneyRunRefusal | null;
}) {
  const router = useRouter();
  const selectId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Scheduling something that cannot run would book a recurring failure. The
  // route refuses it; saying so here is better than offering a control that
  // always errors. `RunJourneyButton` prints the reason on the same row, so
  // this one stays hidden rather than saying it twice.
  if (runRefusal) return null;

  async function change(next: string) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/platform/clients/${clientId}/journeys/${journeyId}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ schedule: next }),
        },
      );

      if (!response.ok) {
        const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(
          (parsed?.error && MESSAGES[parsed.error]) ??
            parsed?.error ??
            `That did not save (${response.status}).`,
        );
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
      {error && (
        <span role="alert" style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.fail }}>
          {error}
        </span>
      )}

      {/* Visible and associated. Every row is another select otherwise. */}
      <label
        htmlFor={selectId}
        style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}
      >
        Schedule for {journeyName}
      </label>
      <select
        id={selectId}
        value={schedule}
        disabled={busy}
        onChange={(event) => change(event.target.value)}
        style={{
          fontFamily: FONT.sans,
          fontSize: 12.5,
          padding: '5px 8px',
          borderRadius: 8,
          border: `1px solid ${T.rule}`,
          background: busy ? T.surfaceSunk : T.surface,
          color: T.ink,
        }}
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}
