'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { JourneyRunRefusal } from '../../../../domain/platform';
import { inertWhen } from '../../lib/inert-button';
import { FONT, T } from '../../lib/tokens';

/**
 * Start a run, from the screen that shows the journey.
 *
 * The journeys page is a Server Component, so this is extracted as a client
 * child exactly the way the findings screen extracts `TriageControl`.
 *
 * It polls rather than refreshing once. `startRun` answers 202 with the run
 * still going, so a bare `router.refresh()` would render the `running`
 * placeholder and then never update — a screen that says "scanning" forever is
 * a worse lie than one that says nothing. The poll has a ceiling: past it the
 * button stops watching and says so. The run itself is unaffected, and a run
 * that dies is reconciled by `run-staleness` either way.
 */

const POLL_INTERVAL_MS = 3000;
/** ~5 minutes: `maxDuration` plus slack. */
const MAX_POLLS = 100;

/**
 * What the route can answer *after* a click.
 *
 * The two refusal codes belong in `REFUSAL_LABELS` below and nowhere here:
 * this button only renders when there is no refusal, and no route changes a
 * journey's target or steps, so it cannot be clicked into one. They were
 * duplicated here and were dead copy — the same reason the `journey_has_no_
 * steps` entry came out of `glossary.ts`. `invalid_journey_steps` stays,
 * because a journey whose steps are the right shape and not valid steps
 * passes the refusal check and fails at the route.
 */
const MESSAGES: Record<string, string> = {
  invalid_journey_steps: 'This journey’s stored steps are not valid. Record it again.',
  journey_not_found: 'That journey is no longer on this client.',
  unauthorized: 'Your session expired. Reload and sign in again.',
  run_budget_exceeded: 'The run budget for this window is used up. Try again later.',
};

/**
 * Said in place of the button, so it has to say the *right* one.
 *
 * These are the same two codes the route answers with, taken from the same
 * `journeyRunRefusal`, so the label an operator reads before clicking and the
 * error they would have got by clicking cannot disagree.
 */
const REFUSAL_LABELS: Record<JourneyRunRefusal, string> = {
  journey_not_runnable: 'Not runnable — no target URL',
  journey_has_no_steps: 'Not runnable — no steps recorded',
};

type Phase = 'idle' | 'starting' | 'running' | 'slow';

export function RunJourneyButton({
  clientId,
  journeyId,
  journeyName,
  runRefusal,
}: {
  clientId: string;
  journeyId: string;
  journeyName: string;
  runRefusal: JourneyRunRefusal | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  // Stops the poll when the operator navigates away mid-run. Without this the
  // loop kept running against an unmounted component and called `setPhase` on
  // it — the ref was read but nothing ever set it, so it read as if it
  // cancelled something and did not.
  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  if (runRefusal) {
    // Said rather than hidden: an operator looking for the button needs to know
    // why it is not there, and which of the two things is missing is exactly
    // what makes the answer actionable.
    return (
      <span style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}>
        {REFUSAL_LABELS[runRefusal]}
      </span>
    );
  }

  async function poll(pollUrl: string) {
    for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (cancelled.current) return;

      try {
        const response = await fetch(pollUrl);
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
        setError(
          (payload?.error && MESSAGES[payload.error]) ??
            payload?.error ??
            `That did not start (${response.status}).`,
        );
        setPhase('idle');
        return;
      }

      // The row exists as `running` the moment the 202 lands, so refreshing
      // now shows the journey as scanning while the poll waits for the result.
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
        A live region rather than only an unavailable button: a run takes tens
        of seconds, and a screen reader user needs to be told it started and
        told again when it finished.

        This is also why the button below is `aria-disabled` and not
        `disabled` — see `lib/inert-button`. Focus stays on the button the
        operator just pressed, so nothing else has to be focused and announced
        to hold their place, and this region is left to speak.
      */}
      <span role="status" style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}>
        {phase === 'running' ? 'Running…' : phase === 'slow' ? 'Still running — reload later' : ''}
      </span>

      <button
        type="button"
        // `start` writes `cancelled.current`, and passing it to a call made
        // during render is enough for the rule — see `lib/inert-button`, which
        // records why this is the argument position and not the ref.
        // eslint-disable-next-line react-hooks/refs
        {...inertWhen(busy, start)}
        // Every row is otherwise another identically-named control in a screen
        // reader's list. It also holds the name *still* while the run goes:
        // the visible label changes underneath it, and renaming the focused
        // control is the other way to talk over the live region.
        aria-label={`Run ${journeyName} now`}
        style={{
          fontFamily: FONT.sans,
          fontSize: 12.5,
          fontWeight: 600,
          padding: '6px 12px',
          borderRadius: 8,
          border: `1px solid ${T.rule}`,
          background: busy ? T.surfaceSunk : T.surface,
          color: busy ? T.inkMuted : T.ink,
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        {/* The label changes, not just the colour. */}
        {phase === 'starting' ? 'Starting…' : phase === 'running' ? 'Running…' : 'Run now'}
      </button>
    </span>
  );
}
