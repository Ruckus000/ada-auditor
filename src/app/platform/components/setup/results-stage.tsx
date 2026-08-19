import Link from 'next/link';
import type { ClientDetail } from '../../../../services/client-detail';
import { FONT, T } from '../../lib/tokens';
import { Stat } from '../client/client-overview';
import { JourneySchedule } from '../client/journey-schedule';
import { StageHeading } from './stage-heading';

/**
 * Stage 5, and the page a finished client keeps: the first audit's numbers,
 * the way into the findings, and — now that the operator has seen what a run
 * is — the schedule. Idempotent: revisiting /setup shows the latest summary.
 */
export function ResultsStage({ detail }: { detail: ClientDetail }) {
  const run = detail.lastRun;
  // The same selection `setupStage` makes (services/setup-state.ts) — the
  // schedule control below must land on the journey the wizard walked, not
  // drift onto a different one.
  const journey = detail.journeys.find((j) => j.runRefusal === null) ?? detail.journeys[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StageHeading>First audit complete</StageHeading>

      {run ? (
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, margin: 0 }}>
          <Stat label="Score" value={run.score === null ? '—' : String(run.score)} />
          <Stat label="Must fix" value={String(run.mustFix)} tone={run.mustFix > 0} />
          <Stat label="Should fix" value={String(run.shouldFix)} />
          <Stat label="Pages audited" value={String(run.pagesAudited)} />
        </dl>
      ) : null}

      <span style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <Link
          href={`/clients/${detail.id}/findings`}
          style={{
            padding: '9px 18px', borderRadius: 9, background: T.accent, color: '#fff',
            fontFamily: FONT.sans, fontSize: 12.5, fontWeight: 650, textDecoration: 'none',
          }}
        >
          Go to the findings
        </Link>
        {journey ? (
          <JourneySchedule
            clientId={detail.id}
            journeyId={journey.id}
            journeyName={journey.name}
            schedule={journey.schedule}
            runRefusal={journey.runRefusal}
          />
        ) : null}
      </span>
    </div>
  );
}
