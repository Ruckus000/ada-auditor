import type { ClientDetail } from '../../../../services/client-detail';
import { StageHeading } from './stage-heading';

/**
 * Setup is done: a completed audit exists. Placeholder — the results summary
 * and the way out of the wizard arrive in Task 11.
 *
 * Rendered rather than redirected so the route stays idempotent: a deep link
 * to `/setup` on a finished client is a page, not a bounce.
 */
export function ResultsStage({ detail }: { detail: ClientDetail }) {
  void detail;

  return <StageHeading>Setup complete</StageHeading>;
}
