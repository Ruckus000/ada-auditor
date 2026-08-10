import Link from 'next/link';
import type { ActivityRow } from '../../../services/activity-view';
import { FONT, T } from '../lib/tokens';

/**
 * What has actually happened, newest first.
 *
 * Every row was written by something somebody did: a client added, a journey
 * recorded, a finding dismissed or reopened. The screen this replaces invented
 * an audit trail — signatures, approvals, deliveries, comment threads — which
 * is a strange thing to fake in a product whose value is that its record can
 * be trusted.
 *
 * Runs are not here. They have their own table and their own screens, and two
 * records of the same event can disagree.
 */
export function ActivityScreen({ rows }: { rows: ActivityRow[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: '-0.015em' }}>
          Activity
        </h1>
        <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13, color: T.inkMuted }}>
          Decisions and changes, newest first. Runs have their own history.
        </p>
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            padding: '30px 26px',
            borderRadius: 12,
            border: `1px dashed ${T.ruleStrong}`,
            background: T.surface,
            fontFamily: FONT.sans,
            fontSize: 13.5,
            color: T.inkSoft,
            maxWidth: 520,
            textWrap: 'pretty',
          }}
        >
          Nothing yet. Adding a client, recording a journey or dismissing a finding all land here,
          with who did it and when.
        </div>
      ) : (
        <ol style={{ display: 'flex', flexDirection: 'column', gap: 1, margin: 0, padding: 0 }}>
          {rows.map((row) => (
            <li
              key={row.id}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 12,
                flexWrap: 'wrap',
                padding: '11px 15px',
                borderBottom: `1px solid ${T.ruleFaint}`,
                listStyle: 'none',
                fontFamily: FONT.sans,
              }}
            >
              <span style={{ fontSize: 13.5, color: T.ink }}>
                <strong style={{ fontWeight: 650 }}>{row.actor}</strong> {row.action}
                {row.subject ? <> — {row.subject}</> : null}
              </span>

              {row.clientId ? (
                <span style={{ fontSize: 12.5 }}>
                  {row.clientName ? (
                    <Link href={`/clients/${row.clientId}`} style={{ color: T.accent }}>
                      {row.clientName}
                    </Link>
                  ) : (
                    // The client is gone, but the event is not rewritten to
                    // match the present — that is the one thing an audit log
                    // must never do.
                    <span style={{ color: T.inkMuted }}>{row.clientId} (removed)</span>
                  )}
                </span>
              ) : null}

              <time
                dateTime={row.createdAt}
                style={{ marginLeft: 'auto', fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted }}
              >
                {row.createdAt ? row.createdAt.replace('T', ' ').slice(0, 16) : '—'}
              </time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
