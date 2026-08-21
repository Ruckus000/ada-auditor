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
      <StageHeading>Record the path</StageHeading>
      <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13.5, color: T.inkSoft, maxWidth: 480, textWrap: 'pretty' }}>
        Add the steps a real user takes — go to a page, click, fill, then say what &ldquo;arrived&rdquo; looks
        like. Save them and we walk the path in a real browser straight away, showing you where it
        ends up. Nothing is audited or saved by a verify, and you can walk it again any time.
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
