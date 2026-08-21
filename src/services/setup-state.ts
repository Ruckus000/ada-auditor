import type { ClientDetail, JourneySummary, RunSummary } from './client-detail';

/**
 * Which setup screen a client's record has earned.
 *
 * Derived on every render and stored nowhere — the wizard has no state of its
 * own, so refresh, back, and deep links cannot disagree with the database.
 * Ordering is the contract: `done` wins over everything (a completed audit is
 * completed setup, whatever happened since), and a run in flight is watched
 * rather than offered a second Run button.
 *
 * Every stage carries its journey, and that is not decoration. The results
 * screen used to re-derive its own — a second copy of the expression below,
 * evaluated independently — so the schedule control could end up writing a
 * cadence onto a different journey than the numbers above it described.
 */
export type SetupStage =
  | { stage: 'site' }
  | { stage: 'steps'; journey: JourneySummary }
  | { stage: 'first-run'; journey: JourneySummary }
  | { stage: 'running'; journey: JourneySummary; requestId: string }
  | { stage: 'failed'; journey: JourneySummary; requestId: string; failureReason: string | null }
  /**
   * `journey` is null when the completed run's journey has since been
   * archived: the client is still onboarded — the run is still on the record —
   * but there is no live journey to offer a schedule for.
   */
  | { stage: 'done'; journey: JourneySummary | null; run: RunSummary };

/**
 * The one journey the wizard walks, resolved once.
 *
 * A runnable journey wins, so an abandoned draft cannot hold the flow hostage.
 * Oldest wins among those, and that is the part worth explaining: both stores
 * list journeys `order by name asc`, so picking the first runnable one meant
 * the wizard's subject moved whenever a second journey was added — from the
 * journeys tab's discovery panel, the API, or a teammate — or whenever an
 * existing one was renamed. The operator pressed Run on a journey they never
 * authored. `createdAt` cannot be edited into a different answer; the id
 * settles the tie two rows written in the same millisecond would otherwise
 * leave open.
 */
export function wizardJourney(
  journeys: readonly JourneySummary[],
): JourneySummary | undefined {
  const runnable = journeys.filter((journey) => journey.runRefusal === null);
  const candidates = runnable.length > 0 ? runnable : journeys;

  return [...candidates].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )[0];
}

export function setupStage(detail: ClientDetail): SetupStage {
  const completed = detail.completedRun;
  if (completed) {
    return {
      stage: 'done',
      journey: detail.journeys.find((j) => j.id === completed.journeyId) ?? null,
      run: completed.run,
    };
  }

  const journey = wizardJourney(detail.journeys);
  if (!journey) return { stage: 'site' };

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
