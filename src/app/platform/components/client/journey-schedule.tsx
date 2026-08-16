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

/**
 * Only what this control can actually provoke.
 *
 * The two refusal codes are absent on purpose: a journey that earns one has no
 * cadence picker, only an off switch, and the route always allows `off`. What
 * *is* reachable is a journey whose steps are the right shape and not valid
 * steps — `journeyRunRefusal` cannot see that, so the picker is offered and
 * the route refuses on parse.
 */
const MESSAGES: Record<string, string> = {
  invalid_journey_steps:
    'This journey’s stored steps are not valid, so a schedule could never run it. Record it again.',
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

  /**
   * A journey that cannot run gets no cadence picker: every option but the one
   * it already has would be refused, and `RunJourneyButton` prints the reason
   * on this same row rather than saying it twice.
   *
   * The route is more permissive than this — it always allows `off`, so a
   * journey booked before that guard existed can still be cleared. No screen
   * offers that, deliberately: the state needs a row that is both scheduled
   * and unrunnable, no route can produce one now, and production holds none.
   * A control for a row that does not exist is a control nobody can reach.
   */
  if (runRefusal) return null;

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
