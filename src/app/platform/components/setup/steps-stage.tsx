import type { ClientDetail, JourneySummary } from '../../../../services/client-detail';
import { FONT, T } from '../../lib/tokens';
import { JourneyStepsEditor } from '../client/journey-steps-editor';
import { CredentialList, StepList } from '../client/client-journeys';
import { StageHeading } from './stage-heading';
import { VerifyButton } from './verify-button';

/**
 * Stage 3: the path, in the same structured editor the journeys screen uses —
 * same policy, same redaction, same tests. What this stage adds is the walk: a
 * real browser follows the steps, no audit and nothing saved, and it starts on
 * its own when the editor saves rather than waiting to be asked.
 */
export function StepsStage({ detail, journey }: { detail: ClientDetail; journey: JourneySummary }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StageHeading>Add the steps to check</StageHeading>
      <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13.5, color: T.inkSoft, maxWidth: 480, textWrap: 'pretty' }}>
        Add each page, click, and form entry. Add a final check to confirm the task worked. Saving
        the steps also tests them; it does not run an accessibility audit.
      </p>

      <JourneyStepsEditor
        clientId={detail.id}
        journeyId={journey.id}
        journeyName={journey.name}
        environment={journey.environment}
        steps={journey.steps}
      >
        <StepList steps={journey.steps} />
      </JourneyStepsEditor>

      <CredentialList credentials={journey.credentials} />

      <VerifyButton clientId={detail.id} journeyId={journey.id} journeyName={journey.name} />
    </div>
  );
}
