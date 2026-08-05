'use client';

import {
  ACTIVITY_FILTER_NAMES,
  activityCountLabel,
  activityCounts,
  activityDays,
  type ClientView,
} from '../lib/derive';
import { usePlatform } from '../lib/state';
import { FONT, T } from '../lib/tokens';
import { Avatar, DropMenu, Eyebrow, FilterChip, ScreenHeading } from './ui';

export function ActivityScreen({ client }: { client: ClientView | null }) {
  const { state, actions } = usePlatform();
  const inClient = client !== null;
  const selected = inClient ? client.name : state.activityClient;
  const days = activityDays(selected, state.undone);
  const shown = days.reduce((n, d) => n + d.rows.length, 0);
  const { total, byClient } = activityCounts();

  return (
    <div data-screen-label="Activity" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <ScreenHeading
          title="Activity"
          lede="Every decision anyone made, and how to take it back. Kept for seven years for legal."
        />
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <DropMenu
            menu={{
              ...actions.menu('people', 'All people', [
                'All people',
                'Jules Reyes',
                'Mira Sato',
                'Tomás Lund',
                'Automated runs',
              ]),
              width: 186,
            }}
          />
          <DropMenu
            menu={{
              ...actions.menu('range', 'Last 7 days', [
                'Last 24 hours',
                'Last 7 days',
                'Last 30 days',
                'Everything',
              ]),
              width: 172,
            }}
          />
          <button
            type="button"
            onClick={() => actions.flash('Activity log exported as CSV.')}
            className="ph-ghost"
            style={{
              padding: '7px 13px',
              border: `1px solid ${T.ruleStrong}`,
              borderRadius: 8,
              background: T.surface,
              color: T.inkSoft,
              fontFamily: FONT.sans,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Export log
          </button>
        </span>
      </div>

      {!inClient ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            border: `1px solid ${T.rule}`,
            borderRadius: 11,
            background: T.surface,
            flexWrap: 'wrap',
          }}
        >
          <Eyebrow>CLIENT</Eyebrow>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <FilterChip
              label="All clients"
              count={total}
              active={selected === 'all'}
              onPick={() => actions.patch({ activityClient: 'all' })}
            />
            {ACTIVITY_FILTER_NAMES.map((name) => (
              <FilterChip
                key={name}
                label={name}
                count={byClient[name] ?? 0}
                active={selected === name}
                onPick={() => actions.patch({ activityClient: name })}
              />
            ))}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: T.inkMuted }}>
            {activityCountLabel(shown, selected)}
          </span>
        </div>
      ) : null}

      {days.map((day) => (
        <div key={day.label} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: '0.07em',
              color: T.inkMuted,
            }}
          >
            {day.label}
          </span>
          <div
            style={{
              border: `1px solid ${T.rule}`,
              borderRadius: 12,
              background: T.surface,
              overflowX: 'auto',
            }}
          >
            {day.rows.map((row) => (
              <div
                key={`${row.target}-${row.when}`}
                className="ph-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '13px 18px',
                  borderBottom: `1px solid ${T.ruleFaint}`,
                }}
              >
                <Avatar initials={row.initials} size={28} bg={row.avBg} color={row.avColor} />
                <span
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  <span style={{ fontSize: 13, lineHeight: 1.4, textWrap: 'pretty' }}>
                    <span style={{ fontWeight: 650 }}>{row.who}</span> {row.action}{' '}
                    <span style={{ fontWeight: 600 }}>{row.target}</span>
                  </span>
                  <span style={{ fontSize: 11.5, color: T.inkMuted }}>{row.detail}</span>
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    padding: '3px 9px',
                    borderRadius: 7,
                    background: T.paperDeep,
                    color: T.inkSoft,
                    fontSize: 11,
                    fontWeight: 650,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.client}
                </span>
                <span style={{ fontSize: 11.5, color: T.inkMuted, whiteSpace: 'nowrap' }}>
                  {row.when}
                </span>
                {row.revertable ? (
                  <button
                    type="button"
                    onClick={() =>
                      actions.patch({
                        modal: 'undo',
                        undoRow: {
                          who: row.who,
                          action: row.action,
                          target: row.target,
                          when: row.when,
                          client: row.client,
                          detail: row.detail,
                        },
                      })
                    }
                    className="ph-ghost-danger"
                    style={{
                      padding: '5px 12px',
                      border: `1px solid ${T.ruleStrong}`,
                      borderRadius: 7,
                      background: T.surface,
                      color: T.inkSoft,
                      fontFamily: FONT.sans,
                      fontSize: 11.5,
                      fontWeight: 650,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Undo this
                  </button>
                ) : null}
                {row.reverted ? (
                  <span
                    style={{
                      padding: '5px 12px',
                      borderRadius: 7,
                      background: T.paperDeep,
                      color: T.inkMuted,
                      fontSize: 11.5,
                      fontWeight: 650,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Undone
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ))}

      {shown === 0 ? (
        <span
          style={{
            padding: 34,
            border: `1px dashed ${T.ruleStrong}`,
            borderRadius: 12,
            background: T.surface,
            textAlign: 'center',
            fontSize: 13,
            color: T.inkMuted,
          }}
        >
          Nobody has touched this client in the last 7 days.
        </span>
      ) : null}
    </div>
  );
}
