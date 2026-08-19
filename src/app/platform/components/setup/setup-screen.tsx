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
      {/* Two separate conditional slots, not one ternary picking a prop —
          load-bearing. `first-run` → `running` is a stage change, and JSX
          identity (same slot, same component, same key-less position) is
          what tells React whether to remount. Splitting the slot changes
          the position `FirstRunStage` renders at between these two stages,
          so React tears down and remounts it — which remounts
          `StageHeading` too, re-running its focus-on-mount effect so the
          transition is actually focused and announced. Collapsing this back
          into `{(stage.stage === 'first-run' || stage.stage === 'running')
          ? <FirstRunStage runningRequestId={...} /> : null}` would keep
          `FirstRunStage` at one stable position across both stages, so React
          would reuse the same instance instead of remounting it — the
          heading would silently keep its old focus/announcement state
          through the transition. */}
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
