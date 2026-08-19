import type { ClientDetail, JourneySummary } from '../../../../services/client-detail';
import { StageHeading } from './stage-heading';

/**
 * Stage 4: the first audit, and the watch while it runs. Placeholder — the run
 * control and its polling arrive in Task 11.
 *
 * `runningRequestId` is present only for the `running` stage: the same screen
 * serves "not started yet" and "in flight", because the difference is one row.
 */
export function FirstRunStage({
  detail,
  journey,
  runningRequestId,
}: {
  detail: ClientDetail;
  journey: JourneySummary;
  runningRequestId?: string;
}) {
  void detail;
  void journey;

  return <StageHeading>{runningRequestId ? 'Auditing…' : 'Run the first audit'}</StageHeading>;
}
