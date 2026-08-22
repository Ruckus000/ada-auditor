'use client';

import { useEffect, useState } from 'react';
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

  /**
   * One watch, cancelled by whoever started it.
   *
   * A plain object rather than a ref, because the thing being cancelled is a
   * *particular* watch and not the component. The previous shape was one
   * shared `cancelled` ref plus a `watching` ref to stop two entry paths
   * racing into the same loop — a guard around a design that permitted the
   * defect. There is one entry path now (see the effect below), so the guard
   * has nothing to guard, and a token per watch means a superseded loop stops
   * because its own token was cancelled rather than because a shared flag
   * happened to be in the right state when it next looked.
   */
  async function poll(url: string, token: { cancelled: boolean }) {
    for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (token.cancelled) return;

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
  }

  /**
   * The only way a watch ever starts.
   *
   * `pollUrl` means a run is in flight on the record this page rendered —
   * whether it was started on a previous visit or by this instance's own
   * click a moment ago, because `start()` refreshes and the server hands the
   * same mounted instance a `pollUrl`.
   *
   * That second case is why `start()` no longer polls. It used to, and the
   * effect fired as well, so one run was watched twice: two loops for its
   * whole life, double the request rate, two refreshes at completion. A
   * `watching` ref made whichever arrived first win, which is a guard around
   * a design that permits the defect rather than a design that does not. One
   * caller means there is nothing to arbitrate.
   *
   * The cost, stated because it is real: watching begins after the refresh
   * lands rather than the instant the 202 does — a few hundred milliseconds
   * later, against a 3s poll interval, while the live region already says the
   * audit is starting.
   *
   * The cleanup is what makes a superseded watch stop. It covers unmount,
   * which a separate mount effect used to do, and also a `pollUrl` that
   * changes to a different run — previously that started a second loop and
   * relied on the ref to refuse it.
   */
  useEffect(() => {
    if (!pollUrl) return;

    const token = { cancelled: false };
    // eslint-disable-next-line react-hooks/set-state-in-effect -- `poll` sets state only after `await`ing a 3s timer, so nothing here runs during the effect; the rule cannot see past the async boundary, and this is the case its own docs describe as legitimate — synchronising React with an external system that reports back later
    void poll(pollUrl, token);

    return () => {
      token.cancelled = true;
    };
    // `poll` is redeclared each render and closes over nothing reactive but
    // `pollUrl`; `router` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollUrl]);

  async function start() {
    setPhase('starting');
    setError(null);

    try {
      const response = await fetch(
        `/api/platform/clients/${clientId}/journeys/${journeyId}/runs`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      );

      // `pollUrl` is deliberately not read from here. The 202 carries one,
      // and using it was the second entry into the watcher; where the run is
      // watched from is the server's answer after the refresh, not this
      // response's.
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

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
      // now re-derives this stage with a `pollUrl`, and the effect above picks
      // the run up. This function's job ends here.
      //
      // There is no `else setPhase('idle')` any more, and its absence is the
      // point: what happens next is whatever the server says the stage is. A
      // run that finished inside the round-trip re-derives a different stage
      // and this component is replaced rather than left holding a phase it
      // decided for itself.
      setPhase('running');
      router.refresh();
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
