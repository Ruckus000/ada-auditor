import type { ClientDetail } from '../../../../services/client-detail';
import { FONT, T } from '../../lib/tokens';
import { VERDICT_CHIP } from '../../lib/verdict-chip';
import { Pill } from '../ui';
import { Empty } from './client-overview';

/**
 * The journeys recorded for one client, and how each last fared.
 *
 * A Server Component, like the overview: this is a list of records with no
 * interaction in it yet. Recording a journey still happens through the console
 * and the API — this page reports, it does not yet author, and it says so
 * rather than offering a button that does nothing.
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
          body="A journey is the path we re-walk on every run. Record one through the console or POST it to /api/audit/run, and it appears here with its last result."
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
