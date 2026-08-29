import Link from 'next/link';
import type { ClientDetail } from '../../../../services/client-detail';
import { FONT, T } from '../../lib/tokens';
import { Stat } from '../client/client-overview';
import { JourneySchedule } from '../client/journey-schedule';
import { StageHeading } from './stage-heading';
import { SCORE_STAT_LABEL, scoreStatValue } from '../../../../services/presentation/verdict';

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
          <Stat label={SCORE_STAT_LABEL} value={scoreStatValue(run.score)} />
          <Stat label="Must fix" value={String(run.mustFix)} tone={run.mustFix > 0} />
          <Stat label="Should fix" value={String(run.shouldFix)} />
          <Stat label="Needs review" value={String(run.needsReview)} />
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

      {/*
        The enrichment prompt, and it stops asking once it has been answered.
        Shown only while this client still has the single journey the wizard
        walked: an operator who has already recorded a second one has done the
        thing this asks for, and repeating it then would be the screen nagging
        about work already finished. `detail.journeys` excludes archived
        journeys (`listJourneys` filters them at the store, deliberately), so
        this counts what the client actually has rather than what it ever had.

        It links to the journeys screen rather than back into the wizard. The
        spec says "Stage 3 authoring", and at the time that meant the wizard's
        step editor — but a client with a completed run derives the terminal
        stage, so /setup cannot show stage 3 again without lying about what the
        record says. Authoring a *second* journey now lives on the journeys
        screen, where the discovery panel is "the way a journey gets made".
        Sending an operator somewhere that works beats honouring the wording of
        a sentence written before that screen existed.
      */}
      {detail.journeys.length === 1 ? (
        <p
          style={{
            margin: 0,
            padding: '11px 14px',
            borderRadius: 9,
            border: `1px dashed ${T.ruleStrong}`,
            fontFamily: FONT.sans,
            fontSize: 13,
            color: T.inkSoft,
            maxWidth: 520,
            textWrap: 'pretty',
          }}
        >
          Real users sign in and check out — record that journey to audit what they actually hit.{' '}
          <Link href={`/clients/${detail.id}/journeys`} style={{ color: T.accentInk, fontWeight: 650 }}>
            Record another journey
          </Link>
        </p>
      ) : null}
    </div>
  );
}
