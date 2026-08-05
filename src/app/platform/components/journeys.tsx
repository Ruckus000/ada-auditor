'use client';

import { journeysFor, type ClientView } from '../lib/derive';
import { usePlatform } from '../lib/state';
import { FONT, T } from '../lib/tokens';
import { Pill, ScreenHeading } from './ui';

export function JourneysScreen({ client }: { client: ClientView }) {
  const { state, actions } = usePlatform();
  const journeys = journeysFor(client.name, state.expanded);

  return (
    <div data-screen-label="Journeys" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <ScreenHeading
          title="Journeys"
          lede="A journey is a task a real person has to finish. We test the whole chain — one broken step breaks the task, however long the chain is."
        />
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => actions.flash('Recording a journey opens the flow builder.')}
            className="ph-primary"
            style={{
              padding: '7px 13px',
              border: 'none',
              borderRadius: 8,
              background: T.accent,
              color: '#fff',
              fontFamily: FONT.sans,
              fontSize: 12.5,
              fontWeight: 650,
              cursor: 'pointer',
            }}
          >
            New journey
          </button>
        </span>
      </div>

      {journeys.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: 34,
            border: `1px dashed ${T.ruleStrong}`,
            borderRadius: 12,
            background: T.surface,
            alignItems: 'center',
            textAlign: 'center',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 42,
              height: 42,
              borderRadius: 11,
              background: T.paperDeep,
              color: T.inkMuted,
              fontSize: 17,
            }}
          >
            ↦
          </span>
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>
            No journeys recorded yet
          </span>
          <span
            style={{
              fontSize: 13,
              color: T.inkSoft,
              maxWidth: 460,
              lineHeight: 1.55,
              textWrap: 'pretty',
            }}
          >
            Page-level checks pass for this client, but nobody has recorded a task yet — so we
            cannot say whether someone can finish a purchase, a booking or a sign-up end to end.
            Walk the task once and we re-test the whole chain every run.
          </span>
          <button
            type="button"
            onClick={() => actions.flash('Recording a journey opens the flow builder.')}
            className="ph-primary"
            style={{
              marginTop: 2,
              padding: '9px 17px',
              border: 'none',
              borderRadius: 9,
              background: T.accent,
              color: '#fff',
              fontFamily: FONT.sans,
              fontSize: 12.5,
              fontWeight: 650,
              cursor: 'pointer',
            }}
          >
            Record a journey
          </button>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {journeys.map((journey) => (
          <div
            key={journey.key}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 13,
              padding: 18,
              border: `1px solid ${T.rule}`,
              borderRadius: 12,
              background: T.surface,
              boxShadow: '0 1px 1px rgba(31,41,38,0.03)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>
                {journey.name}
              </h2>
              <Pill
                bg={journey.chipBg}
                color={journey.chipColor}
                border={journey.chipBorder}
                size={11}
              >
                {journey.chipLabel}
              </Pill>
              <span style={{ fontSize: 12.5, color: T.inkMuted }}>
                {journey.site} · {journey.summary}
              </span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => actions.flash('Editing steps opens the flow builder.')}
                  className="ph-ghost"
                  style={{
                    padding: '6px 13px',
                    border: `1px solid ${T.ruleStrong}`,
                    borderRadius: 8,
                    background: T.surface,
                    color: T.inkSoft,
                    fontFamily: FONT.sans,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Edit steps
                </button>
                <button
                  type="button"
                  onClick={() => actions.flash('Opening this journey in the annotated ledger.')}
                  className="ph-primary"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '6px 13px',
                    border: 'none',
                    borderRadius: 8,
                    background: T.accent,
                    color: '#fff',
                    fontFamily: FONT.sans,
                    fontSize: 12,
                    fontWeight: 650,
                    cursor: 'pointer',
                  }}
                >
                  Open ledger
                </button>
              </span>
            </div>

            <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ display: 'flex', gap: 2, height: 10, alignItems: 'flex-end' }}>
                {journey.ribbon.map((segment, i) => (
                  <span
                    key={i}
                    title={segment.title}
                    style={{ flex: 1, borderRadius: 2, background: segment.bg, height: segment.h }}
                  />
                ))}
              </span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  fontSize: 11.5,
                  color: T.inkMuted,
                }}
              >
                <span>{journey.stepCount} steps</span>
                <span aria-hidden="true">·</span>
                <span style={{ fontWeight: 650, color: journey.firstBreakColor }}>
                  {journey.firstBreak}
                </span>
                {journey.canToggle ? (
                  <button
                    type="button"
                    onClick={() =>
                      actions.patch({
                        expanded: {
                          ...state.expanded,
                          [journey.key]: !state.expanded[journey.key],
                        },
                      })
                    }
                    className="ph-accent-hover"
                    style={{
                      marginLeft: 'auto',
                      padding: '3px 10px',
                      border: `1px solid ${T.rule}`,
                      borderRadius: 7,
                      background: T.surface,
                      color: T.accent,
                      fontFamily: FONT.sans,
                      fontSize: 11,
                      fontWeight: 650,
                      cursor: 'pointer',
                    }}
                  >
                    {journey.toggleLabel}
                  </button>
                ) : null}
              </span>
            </span>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {journey.items.map((item, i) =>
                item.isGap ? (
                  <button
                    key={`gap-${i}`}
                    type="button"
                    onClick={() =>
                      actions.patch({ expanded: { ...state.expanded, [journey.key]: true } })
                    }
                    className="ph-accent-hover-wash"
                    style={{
                      flex: '0 1 132px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      gap: 3,
                      padding: '11px 13px',
                      border: `1px dashed ${T.ruleStrong}`,
                      borderRadius: 10,
                      background: T.surfaceSunk,
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: FONT.sans,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 650, color: T.accent }}>
                      {item.label}
                    </span>
                    <span style={{ fontSize: 11, color: T.inkMuted }}>
                      steps {item.range} · show
                    </span>
                  </button>
                ) : (
                  <span
                    key={`step-${item.num}`}
                    style={{
                      flex: '1 1 168px',
                      maxWidth: 280,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      padding: '11px 13px',
                      border: `1px solid ${item.border}`,
                      borderRadius: 10,
                      background: item.bg,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 18,
                          height: 18,
                          borderRadius: 5,
                          flexShrink: 0,
                          background: item.dot,
                          color: '#fff',
                          fontSize: 10,
                          fontWeight: 700,
                        }}
                      >
                        {item.num}
                      </span>
                      <span style={{ fontSize: 12.5, fontWeight: 650, lineHeight: 1.25 }}>
                        {item.label}
                      </span>
                    </span>
                    <span
                      style={{
                        fontSize: 11.5,
                        color: item.noteColor,
                        fontWeight: item.noteWeight,
                        lineHeight: 1.35,
                        textWrap: 'pretty',
                      }}
                    >
                      {item.note}
                    </span>
                  </span>
                ),
              )}
            </div>

            <span
              style={{
                fontSize: 12,
                color: T.inkMuted,
                paddingTop: 11,
                borderTop: `1px solid ${T.ruleFaint}`,
                textWrap: 'pretty',
              }}
            >
              {journey.footer}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
