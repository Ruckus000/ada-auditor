import type { ClientDetail, JourneySummary } from '../../../../services/client-detail';
import { StageHeading } from './stage-heading';

/**
 * The failed stage: the newest attempt did not finish. Placeholder — the
 * reason, the retry and the start-over button arrive in Task 11.
 */
export function FailedStage({
  detail,
  journey,
  failureReason,
}: {
  detail: ClientDetail;
  journey: JourneySummary;
  failureReason: string | null;
}) {
  void detail;
  void journey;
  void failureReason;

  return <StageHeading>That audit did not finish</StageHeading>;
}
