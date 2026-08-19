import type { ClientDetail } from '../../../../services/client-detail';
import type { SetupStage } from '../../../../services/setup-state';
import { FailedStage } from './failed-stage';
import { FirstRunStage } from './first-run-stage';
import { ResultsStage } from './results-stage';
import { StageIndicator } from './stage-indicator';
import { StepsStage } from './steps-stage';
import { WhereScreen } from './where-screen';

/**
 * One of five stages, plus the indicator that says which (`StageIndicator`,
 * shared with `/clients/new`, which renders it at stage 0).
 *
 * A new stage must claim its indicator slot here — `satisfies` makes tsc
 * refuse a union member this map has no answer for.
 */
const STAGE_INDEX = {
  site: 1,
  steps: 1,
  'first-run': 2,
  running: 2,
  failed: 2,
  done: 2,
} satisfies Record<SetupStage['stage'], 0 | 1 | 2>;

function stageIndex(stage: SetupStage['stage']): 0 | 1 | 2 {
  return STAGE_INDEX[stage];
}

export function SetupScreen({ detail, stage }: { detail: ClientDetail; stage: SetupStage }) {
  const current = stageIndex(stage.stage);

  return (
    <div data-screen-label="Client setup" style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }}>
      <StageIndicator current={current} />

      {stage.stage === 'site' ? <WhereScreen clientId={detail.id} /> : null}
      {stage.stage === 'steps' ? <StepsStage detail={detail} journey={stage.journey} /> : null}
      {/* ONE slot for `first-run` and `running`, deliberately — the opposite
          of every other transition here. JSX position decides remounting, and
          this transition is the one an operator's own click causes: the run
          button they just pressed must survive it (see `inert-button.ts` and
          the commit "Do not take a control away from the operator who just
          pressed it"). One stable position keeps the same `FirstRunStage`
          instance, so focus stays on the pressed button and
          `FirstRunControl`'s live region announces the change; two slots
          would remount, destroy the pressed button, and dump focus. It also
          means `StageHeading` changes text here without refocusing — the
          documented exception in stage-heading.tsx — and that `FirstRunControl`
          receives `pollUrl` on its mounted instance, which is why its
          `watching` guard exists. */}
      {stage.stage === 'first-run' || stage.stage === 'running' ? (
        <FirstRunStage
          detail={detail}
          journey={stage.journey}
          {...(stage.stage === 'running' ? { runningRequestId: stage.requestId } : {})}
        />
      ) : null}
      {stage.stage === 'failed' ? (
        <FailedStage detail={detail} journey={stage.journey} failureReason={stage.failureReason} />
      ) : null}
      {stage.stage === 'done' ? <ResultsStage detail={detail} /> : null}
    </div>
  );
}
