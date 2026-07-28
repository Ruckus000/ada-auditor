'use client';

import { useEffect, useState } from 'react';
import { InfoTip } from './info-tip';

export type ReadyState = 'loading' | 'ok' | 'needs-token' | 'unreachable';

export interface SystemStatus {
  state: ReadyState;
  chaosEnabled: boolean;
  checkedAt: number | null;
}

const COPY: Record<ReadyState, { headline: string; tone: string }> = {
  loading: { headline: 'Checking the auditor service…', tone: 'loading' },
  ok: { headline: 'Ready to run audits.', tone: 'ok' },
  'needs-token': { headline: 'Almost ready — the server needs a run token.', tone: 'warn' },
  unreachable: { headline: 'Cannot reach the auditor service.', tone: 'bad' },
};

function useRelativeTime(timestamp: number | null): string {
  const [, force] = useState(0);

  useEffect(() => {
    if (timestamp == null) return;
    const id = setInterval(() => force((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, [timestamp]);

  if (timestamp == null) return '';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
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
