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
 */
function stageIndex(stage: SetupStage['stage']): 0 | 1 | 2 {
  if (stage === 'site' || stage === 'steps') return 1;
  return 2; // first-run, running, failed, done
}

export function SetupScreen({ detail, stage }: { detail: ClientDetail; stage: SetupStage }) {
  const current = stageIndex(stage.stage);

  return (
    <div data-screen-label="Client setup" style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }}>
      <StageIndicator current={current} />

      {stage.stage === 'site' ? <WhereScreen clientId={detail.id} /> : null}
      {stage.stage === 'steps' ? <StepsStage detail={detail} journey={stage.journey} /> : null}
      {stage.stage === 'first-run' ? <FirstRunStage detail={detail} journey={stage.journey} /> : null}
      {stage.stage === 'running' ? (
        <FirstRunStage detail={detail} journey={stage.journey} runningRequestId={stage.requestId} />
      ) : null}
      {stage.stage === 'failed' ? (
        <FailedStage detail={detail} journey={stage.journey} failureReason={stage.failureReason} />
      ) : null}
      {stage.stage === 'done' ? <ResultsStage detail={detail} /> : null}
    </div>
  );
}
