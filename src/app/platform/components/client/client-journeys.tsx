import type { ClientDetail } from '../../../../services/client-detail';
import { FONT, T } from '../../lib/tokens';
import { VERDICT_CHIP } from '../../lib/verdict-chip';
import { Pill } from '../ui';
import { Empty } from './client-overview';
import { JourneySchedule } from './journey-schedule';
import { RunJourneyButton } from './run-journey-button';

/**
 * The journeys recorded for one client, how each last fared, and the button
 * that runs one.
 *
 * Still a Server Component; the one interactive control is extracted as a
 * client child, the way the findings screen extracts `TriageControl`.
 *
 * This page used to say, in this comment, that it "reports, it does not yet
 * author" — because a stored journey was inert, and nothing anywhere read its
 * steps to build a run. That is no longer true: `POST /api/platform/clients/
 * <id>/journeys/<id>/runs` walks the stored journey, so the button is offered
 * rather than withheld. *Recording* a journey is still console and API work.
 */
export function ClientJourneys({ detail }: { detail: ClientDetail }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-0.01em' }}>
        Journeys
      </h2>

      {detail.journeys.length === 0 ? (
        <Empty
          title="No journeys yet"
          body="A journey is the path we re-walk on every run. Record one through the console or POST it to /api/platform/clients/<id>/journeys, and it appears here with a button to run it."
          action={null}
        />
      ) : (
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: 0, padding: 0 }}>
          {detail.journeys.map((journey) => {
            const badge = VERDICT_CHIP[journey.lastRun?.verdict ?? 'scan'];

            return (
              <li
                key={journey.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  flexWrap: 'wrap',
                  padding: '13px 16px',
                  borderRadius: 10,
                  border: `1px solid ${T.rule}`,
                  background: T.surface,
                  listStyle: 'none',
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <span style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 650 }}>
                    {journey.name}
                  </span>
                  <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted }}>
                    {journey.targetUrl ?? journey.id} ·{' '}
                    {journey.stepCount === 1 ? '1 step' : `${journey.stepCount} steps`}
                  </span>
                </span>

                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <JourneySchedule
                    clientId={detail.id}
                    journeyId={journey.id}
                    journeyName={journey.name}
                    schedule={journey.schedule}
                    runnable={journey.runnable}
                  />
                  <RunJourneyButton
                    clientId={detail.id}
                    journeyId={journey.id}
                    journeyName={journey.name}
                    runnable={journey.runnable}
                  />
                  {journey.lastRun ? (
                    <>
                      <Pill bg={badge.bg} color={badge.color} border={badge.border}>
                        {badge.label}
                      </Pill>
                      <span style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}>
                        {journey.lastRun.mustFix} must fix ·{' '}
                        {new Date(journey.lastRun.createdAt).toISOString().slice(0, 10)}
                      </span>
                    </>
                  ) : (
                    <span style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}>
                      Never run
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
