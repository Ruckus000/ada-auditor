'use client';

import { useEffect, useState } from 'react';
import { InfoTip } from './info-tip';

export type ReadyState = 'loading' | 'ok' | 'needs-token' | 'needs-store' | 'unreachable';

export interface SystemStatus {
  state: ReadyState;
  chaosEnabled: boolean;
  checkedAt: number | null;
  /**
   * Problems that do not stop the service. Reported rather than gating,
   * because a degraded security speed bump is not a reason to tell every
   * operator the auditor is down.
   */
  warnings: string[];
}

const COPY: Record<ReadyState, { headline: string; tone: string }> = {
  loading: { headline: 'Checking the auditor service…', tone: 'loading' },
  ok: { headline: 'Ready to run audits.', tone: 'ok' },
  'needs-token': { headline: 'Almost ready — the server needs a run token.', tone: 'warn' },
  // Distinct from `unreachable` on purpose. The server answered; it simply has
  // nowhere to record a run. Saying "cannot reach the service" would send an
  // operator to check the wrong thing entirely.
  'needs-store': { headline: 'Almost ready — the server has no database.', tone: 'warn' },
  unreachable: { headline: 'Cannot reach the auditor service.', tone: 'bad' },
};

/**
 * How long ago `timestamp` was, refreshed on a timer.
 *
 * The clock is read in the interval callback and kept in state rather than read
 * during render: `Date.now()` in a render body is impure, and it would also
 * make this component's output depend on which machine rendered it. The reading
 * is stamped with the timestamp it was taken for, so a fresh check reads as
 * "just now" immediately instead of briefly showing the age of the previous
 * one — no state reset, which an effect body is not allowed to do.
 */
function useRelativeTime(timestamp: number | null): string {
  const [reading, setReading] = useState<{ of: number | null; elapsedMs: number }>({
    of: timestamp,
    elapsedMs: 0,
  });

  useEffect(() => {
    if (timestamp == null) return;
    const id = setInterval(
      () => setReading({ of: timestamp, elapsedMs: Date.now() - timestamp }),
      5_000,
    );
    return () => clearInterval(id);
  }, [timestamp]);

  if (timestamp == null) return '';
  const elapsedMs = reading.of === timestamp ? reading.elapsedMs : 0;
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

export function StatusRail({
  status,
  onRefresh,
}: {
  status: SystemStatus;
  onRefresh: () => void;
}) {
  const copy = COPY[status.state];
  const checked = useRelativeTime(status.checkedAt);

  return (
    // Deliberately not a heading: this is a status message, and the page's only
    // <h1> is the run form. Labelled for the landmark instead.
    <section className={`status-rail tone-${copy.tone}`} aria-label="Service status">
      <div className="status-row">
        <span className={`status-dot ${copy.tone}`} aria-hidden="true" />
        <p className="status-headline">{copy.headline}</p>
        <InfoTip termKey="canRunAudits" />
        <button type="button" className="ghost-btn" onClick={onRefresh}>
          Re-check
        </button>
      </div>

      {/* Announce state changes without making the whole rail a live region. */}
      <p className="sr-only" role="status" aria-live="polite">
        {copy.headline}
      </p>

      {status.state === 'needs-token' && (
        <div className="status-fix">
          <p>The server authorises audits with a secret that has not been set yet. To fix it:</p>
          <ol>
            <li>
              Add <code>AUDITOR_RUN_TOKEN=any-long-random-string</code> to{' '}
              <code>.env.local</code> in the project root.
            </li>
            <li>Stop and restart the app so it picks up the new value.</li>
            <li>
              Press <strong>Re-check</strong> above.
            </li>
          </ol>
        </div>
      )}

      {status.state === 'needs-store' && (
        <div className="status-fix">
          <p>
            The server is running but has no database to record runs in, so an audit would fail
            partway through. To fix it:
          </p>
          <ol>
            <li>
              Provision Postgres: <code>vercel integration add neon</code>
            </li>
            <li>
              Pull the credentials: <code>vercel env pull .env.local --yes</code>
            </li>
            <li>
              Apply the schema: <code>npm run migrate</code>
            </li>
            <li>
              Restart the app, then press <strong>Re-check</strong>.
            </li>
          </ol>
        </div>
      )}

      {status.warnings.length > 0 && (
        <ul className="status-warnings">
          {status.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {status.state === 'unreachable' && (
        <div className="status-fix">
          <p>
            The page loaded but the server is not answering. Check that the app is still running in
            your terminal, then press <strong>Re-check</strong>.
          </p>
        </div>
      )}

      {checked && (
        <p className="status-checked">
          Last checked {checked}
          {status.state !== 'loading' && ' · rechecks automatically every 30s'}
        </p>
      )}
    </section>
  );
}
