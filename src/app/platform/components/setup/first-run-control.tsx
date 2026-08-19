'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { inertWhen } from '../../lib/inert-button';
import { FONT, T } from '../../lib/tokens';

/**
 * Start the wizard's first audit, or pick up watching one already running.
 *
 * Adapted from `RunJourneyButton` — same poll mechanics, same MESSAGES map,
 * same live region and inert pattern — with the differences the wizard
 * needs: this is the headline action (accent styling, not the row's quiet
 * button), it never renders a refusal (the dispatcher only reaches this
 * stage for a runnable journey), and it can *mount already running*.
 *
 * `pollUrl` arrives whenever the setup route derives the `running` stage —
 * a run started on an earlier render of this page (or a previous visit) is
 * already in flight, and the effect below starts watching it immediately
 * rather than showing an idle "Run the first audit" button for a run that
 * has already started.
 */

const POLL_INTERVAL_MS = 3000;
/** 100 × 3s ≈ 300s of watching — the same ceiling as `maxDuration`; the
 *  fetches themselves are the only slack. */
const MAX_POLLS = 100;

const MESSAGES: Record<string, string> = {
  invalid_journey_steps: 'This journey’s stored steps are not valid. Record it again.',
  journey_not_found: 'That journey is no longer on this client.',
  unauthorized: 'Your session expired. Reload and sign in again.',
  run_budget_exceeded: 'The run budget for this window is used up. Try again later.',
};

type Phase = 'idle' | 'starting' | 'running' | 'slow';

export function FirstRunControl({
  clientId,
  journeyId,
  journeyName,
  pollUrl,
}: {
  clientId: string;
  journeyId: string;
  journeyName: string;
  pollUrl?: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(pollUrl ? 'running' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  /**
   * One watcher, however many entry paths. A run started by this instance's
   * own click reaches `poll` twice: once from `start()`'s tail, and once from
   * the `[pollUrl]` effect after the refresh re-derives the stage as
   * `running` and hands this same mounted instance a `pollUrl`. Whichever
   * arrives first owns the watch; the other bails here — without this, both
   * loops ran for the life of the run, doubling the poll load and firing two
   * refreshes at completion.
   */
  const watching = useRef(false);

  // Stops the poll when the operator navigates away mid-run. Without this the
  // loop kept running against an unmounted component and called `setPhase` on
  // it — the ref was read but nothing ever set it, so it read as if it
  // cancelled something and did not.
  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  async function poll(url: string) {
    if (watching.current) return;
    watching.current = true;
    try {
      for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (cancelled.current) return;

        try {
          const response = await fetch(url);
          if (!response.ok) continue;

          const payload = (await response.json()) as { run?: { status?: string } };
          const status = payload.run?.status;
          if (status === 'complete' || status === 'failed') {
            setPhase('idle');
            router.refresh();
            return;
          }
        } catch {
          // A failed poll is not a failed run. Keep watching.
        }
      }

      // Out of patience, not out of run.
      setPhase('slow');
      router.refresh();
    } finally {
      watching.current = false;
    }
  }

  // Mounts already running: `pollUrl` means a run is in flight on the record
  // this page just rendered, not one this component instance started. The
  // effect (not the click handler) is what starts watching it.
  useEffect(() => {
    if (!pollUrl) return;
    cancelled.current = false;
    void poll(pollUrl);
    // `poll` closes over nothing reactive besides `pollUrl` itself — `router`
    // and the `cancelled` ref are both stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollUrl]);

  async function start() {
    setPhase('starting');
    setError(null);
    cancelled.current = false;

    try {
      const response = await fetch(
        `/api/platform/clients/${clientId}/journeys/${journeyId}/runs`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      );

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; pollUrl?: string }
        | null;

      if (!response.ok) {
        // The MESSAGES lookup first; an unmapped code never reaches the
        // screen raw — `payload.error` is a machine code (house rule: error
        // codes in state, human messages derived), not a sentence an
        // operator should read.
        setError(
          (payload?.error && MESSAGES[payload.error]) ??
            `That did not start (${response.status}). Try again.`,
        );
        setPhase('idle');
        return;
      }

      // The row exists as `running` the moment the 202 lands, so refreshing
      // now shows this stage as running while the poll waits for the result.
      setPhase('running');
      router.refresh();

      if (payload?.pollUrl) await poll(payload.pollUrl);
      else setPhase('idle');
    } catch {
      setError('Could not reach the server.');
      setPhase('idle');
    }
  }

  const busy = phase === 'starting' || phase === 'running';

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {error && (
        <span role="alert" style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.fail }}>
          {error}
        </span>
      )}

      {/*
        A live region rather than only an unavailable button — see
        `run-journey-button.tsx`. This is also why the button below is
        `aria-disabled` and not `disabled`: focus stays on the button the
        operator just pressed, and this region is left to speak.
      */}
      <span role="status" style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}>
        {phase === 'starting'
          ? 'Starting the audit…'
          : phase === 'running'
            ? 'Running…'
            : phase === 'slow'
              ? 'Still running — reload to check.'
              : ''}
      </span>

      <button
        type="button"
        // eslint-disable-next-line react-hooks/refs -- `start` reads refs only when the click invokes it; `inertWhen` just builds props at render
        {...inertWhen(busy, start)}
        aria-label={`Run the first audit of ${journeyName}`}
        style={{
          fontFamily: FONT.sans,
          fontSize: 12.5,
          fontWeight: 650,
          padding: '9px 18px',
          borderRadius: 9,
          border: 'none',
          background: busy ? T.accentDeep : T.accent,
          color: '#fff',
          opacity: busy ? 0.85 : 1,
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        {phase === 'starting' ? 'Starting…' : phase === 'running' ? 'Running…' : 'Run the first audit'}
      </button>
    </span>
  );
}
