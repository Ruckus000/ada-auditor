import type { ClientDetail, JourneySummary } from '../../../../services/client-detail';
import { describeRunFailure } from '../../lib/run-failure-copy';
import { FONT, T } from '../../lib/tokens';
import { JourneyStepsEditor } from '../client/journey-steps-editor';
import { StepList } from '../client/client-journeys';
import { FirstRunControl } from './first-run-control';
import { StageHeading } from './stage-heading';
import { StartOverButton } from './start-over-button';
import { VerifyButton } from './verify-button';

/**
 * The failed stage: the newest attempt did not finish.
 *
 * Recovery, not a dead end — the same structured editor and verify button
 * `StepsStage` uses (a stale selector is the common cause of a failed walk),
 * a way to run again without re-typing anything, and a way out for the case
 * neither of those fixes: the URL itself was wrong from the start.
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StageHeading>The first audit stopped</StageHeading>

      <p
        style={{
          margin: 0,
          padding: '11px 14px',
          borderRadius: 9,
          background: T.failWash,
          border: `1px solid ${T.failEdge}`,
          color: T.failDeep,
          fontFamily: FONT.sans,
          fontSize: 13,
        }}
      >
        {/* `failureReason` is absent on rows recorded before failures were
            classified — `audit_run_failed` is the same "could not
            categorise" fallback `describeRunFailure` itself uses for an
            unrecognised code, so an unclassified failure and an
            unrecognised one read identically here. */}
        <strong>Stopped:</strong> {describeRunFailure(failureReason ?? 'audit_run_failed')}
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

      <VerifyButton clientId={detail.id} journeyId={journey.id} journeyName={journey.name} />

      <FirstRunControl clientId={detail.id} journeyId={journey.id} journeyName={journey.name} />

      <StartOverButton clientId={detail.id} journeyId={journey.id} />
    </div>
  );
}
