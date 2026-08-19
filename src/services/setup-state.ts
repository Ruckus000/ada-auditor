import type { ClientDetail, JourneySummary } from './client-detail';

/**
 * Which setup screen a client's record has earned.
 *
 * Derived on every render and stored nowhere — the wizard has no state of its
 * own, so refresh, back, and deep links cannot disagree with the database.
 * Ordering is the contract: `done` wins over everything (a completed audit is
 * completed setup, whatever happened since), and a run in flight is watched
 * rather than offered a second Run button.
 */
export type SetupStage =
  | { stage: 'site' }
  | { stage: 'steps'; journey: JourneySummary }
  | { stage: 'first-run'; journey: JourneySummary }
  | { stage: 'running'; journey: JourneySummary; requestId: string }
  | { stage: 'failed'; journey: JourneySummary; requestId: string; failureReason: string | null }
  | { stage: 'done' };

export function setupStage(detail: ClientDetail): SetupStage {
  if (detail.hasCompletedRun) return { stage: 'done' };
  if (detail.journeys.length === 0) return { stage: 'site' };

  // The wizard walks one journey to its first result. A runnable one wins so
  // an abandoned draft cannot hold the flow hostage.
  const journey = detail.journeys.find((j) => j.runRefusal === null) ?? detail.journeys[0];

  if (journey.runRefusal) return { stage: 'steps', journey };

  const lastRun = journey.lastRun;
  if (!lastRun) return { stage: 'first-run', journey };
  if (lastRun.verdict === 'scan') {
    return { stage: 'running', journey, requestId: lastRun.requestId };
  }
  // No completed run exists (first branch) and this one is not in flight:
  // the newest attempt failed. `failureReason` is absent on rows recorded
  // before failures were classified.
  return {
    stage: 'failed',
    journey,
    requestId: lastRun.requestId,
    failureReason: lastRun.failureReason ?? null,
  };
}
