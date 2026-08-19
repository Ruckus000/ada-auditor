import type { ClientDetail, JourneySummary } from '../../../../services/client-detail';
import { StageHeading } from './stage-heading';

/**
 * Stage 3: author the steps, then verify them by replay. Placeholder — the
 * step editor and the verify button arrive in Task 11.
 */
export function StepsStage({
  detail,
  journey,
}: {
  detail: ClientDetail;
  journey: JourneySummary;
}) {
  void detail;
  void journey;

  return <StageHeading>Teach us the path</StageHeading>;
}
