import type { ClientDetail, JourneySummary } from '../../../../services/client-detail';
import { FONT, T } from '../../lib/tokens';
import { JourneyStepsEditor } from '../client/journey-steps-editor';
import { CredentialList, StepList } from '../client/client-journeys';
import { FirstRunControl } from './first-run-control';
import { StageHeading } from './stage-heading';
import { VerifyButton } from './verify-button';

/**
 * Stage 4: the first audit, and the watch while it runs.
 *
 * `runningRequestId` is present only for the `running` stage: the same
 * screen serves "not started yet" and "in flight", because the difference is
 * one row — whether `FirstRunControl` mounts idle or already polling.
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StageHeading>{runningRequestId ? 'First audit running…' : 'Run the first audit'}</StageHeading>
      <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13.5, color: T.inkSoft, maxWidth: 480, textWrap: 'pretty' }}>
        {runningRequestId
          ? 'A real browser is walking the path and evaluating every page it reaches. This page will show the results when it finishes — usually under a minute.'
          : `This walks “${journey.name}” in a real browser, evaluates every page it reaches against ~100 accessibility rules, and saves the results — scored, on the record.`}
      </p>
      <FirstRunControl
        clientId={detail.id}
        journeyId={journey.id}
        journeyName={journey.name}
        {...(runningRequestId ? { pollUrl: `/api/audit/runs/${runningRequestId}` } : {})}
      />

      {/*
        The run button is the headline, but the path stays editable and
        verifiable until the first audit is on the record. Before this, the
        stage machine flipped `steps` → `first-run` the moment valid steps
        saved, so "save steps, then verify" — the flow `StepsStage` itself
        advertises — was unreachable: there was never a `steps` render with
        anything to verify, and fixing a stale selector meant leaving the
        wizard for the journeys screen mid-onboarding. Composed exactly like
        `FailedStage`'s recovery section, because the need is the same one:
        a stale selector is the common reason a first run does not go well,
        and the fix should not cost the operator their place in the wizard.

        Withheld while running: a mid-run edit is the journeys screen's
        problem, not the wizard's, and this component's mounted instance is
        also the one watching the run (see `FirstRunControl`'s `watching`
        ref) — an editor swapping in here would compete with that for the
        operator's attention without being able to change what is already
        in flight.
      */}
      {!runningRequestId ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h3
            style={{
              margin: 0,
              fontFamily: FONT.sans,
              fontSize: 13,
              fontWeight: 650,
              color: T.inkSoft,
            }}
          >
            The path
          </h3>

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
      ) : null}
    </div>
  );
}
