import Link from 'next/link';
import type {
  ClientDetail,
  JourneySummary,
  RunSummary,
} from '../../../../services/client-detail';
import { FONT, T } from '../../lib/tokens';
import { Stat } from '../client/client-overview';
import { JourneySchedule } from '../client/journey-schedule';
import { StageHeading } from './stage-heading';

/**
 * Stage 5, and the page a finished client keeps: the first audit's numbers,
 * the way into the findings, and — now that the operator has seen what a run
 * is — the schedule. Idempotent: revisiting /setup shows the same summary.
 *
 * Both the run and the journey arrive from `setupStage`, resolved once, and
 * neither is re-derived here. This screen used to do both itself and get both
 * wrong: `detail.lastRun` is the newest run of *any* status, so a later failed
 * rerun rendered as "First audit complete" with a score of "—" and zero pages;
 * and its own copy of the journey heuristic could hand the schedule control a
 * different journey than the numbers beside it came from, so setting "Daily"
 * scheduled a journey the operator had never run.
 *
 * `journey` is null when that journey has since been archived — the completed
 * audit still stands, so there is nothing to schedule and no reason to pretend
 * otherwise.
 */
export function ResultsStage({
  detail,
  journey,
  run,
}: {
  detail: ClientDetail;
  journey: JourneySummary | null;
  run: RunSummary;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StageHeading>First audit complete</StageHeading>

      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, margin: 0 }}>
        <Stat label="Score" value={run.score === null ? '—' : String(run.score)} />
        <Stat label="Must fix" value={String(run.mustFix)} tone={run.mustFix > 0} />
        <Stat label="Should fix" value={String(run.shouldFix)} />
        <Stat label="Pages audited" value={String(run.pagesAudited)} />
      </dl>

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
