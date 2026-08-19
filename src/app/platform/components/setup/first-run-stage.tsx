import type { ClientDetail, JourneySummary } from '../../../../services/client-detail';
import { FONT, T } from '../../lib/tokens';
import { FirstRunControl } from './first-run-control';
import { StageHeading } from './stage-heading';

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
    </div>
  );
}
