'use client';

import { journeysFor, type ClientView } from '../lib/derive';
import { usePlatform } from '../lib/state';
import { FONT, T } from '../lib/tokens';
import { Avatar, ChevronRight, Pill, SectionHeading } from './ui';

const panel = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 12,
  padding: 18,
  border: `1px solid ${T.rule}`,
  borderRadius: 12,
  background: T.surface,
};

export function ClientOverviewScreen({ client }: { client: ClientView }) {
  const { state, actions } = usePlatform();
  const journeys = journeysFor(client.name, state.expanded);

  return (
    <div
      data-screen-label="Client overview"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1fr) clamp(270px,23vw,350px)',
        gap: 18,
        alignItems: 'start',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Verdict banner */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            padding: 20,
            border: `1px solid ${client.bannerBorder}`,
            borderRadius: 12,
            background: client.bannerBg,
          }}
        >
          <span
            style={{
              position: 'relative',
              width: 96,
              height: 96,
              flexShrink: 0,
              borderRadius: '50%',
              background: client.ringGradient,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                position: 'absolute',
                inset: 9,
                borderRadius: '50%',
                background: client.bannerBg,
              }}
            />
            <span
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                lineHeight: 1,
              }}
            >
              <span
                style={{
                  fontSize: 29,
                  fontWeight: 700,
                  letterSpacing: '-0.03em',
                  color: client.scoreColor,
                }}
              >
                {client.score}
              </span>
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 650,
                  letterSpacing: '0.06em',
                  color: T.inkMuted,
                  marginTop: 3,
                }}
              >
                OF 100
              </span>
            </span>
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em' }}>
                {client.verdictHead}
              </h2>
              <Pill bg={client.chipBg} color={client.chipColor} border={client.chipBorder}>
                {client.chipLabel}
              </Pill>
            </span>
            <span
              style={{ fontSize: 13.5, color: T.inkSoft, lineHeight: 1.55, textWrap: 'pretty' }}
            >
              {client.verdictBody}
            </span>
            <span style={{ fontSize: 12, color: T.inkMuted }}>
              Contracted standard: {client.standard} · run #{client.run} · {client.pages} pages,{' '}
              {client.journeyCount} journeys tested
            </span>
          </span>
        </div>

        {/* Since the last run */}
        <div style={{ ...panel, gap: 11 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SectionHeading>Since the last run</SectionHeading>
            <span style={{ fontSize: 12, color: T.inkMuted }}>
              run #{client.prevRun} → #{client.run}
            </span>
            <button
              type="button"
              onClick={() =>
                actions.flash(`Comparing run #${client.prevRun} with #${client.run}.`)
              }
              className="ph-ghost"
              style={{
                marginLeft: 'auto',
                padding: '5px 11px',
                border: `1px solid ${T.ruleStrong}`,
                borderRadius: 7,
                background: T.surface,
                color: T.inkSoft,
                fontFamily: FONT.sans,
                fontSize: 11.5,
                fontWeight: 650,
                cursor: 'pointer',
              }}
            >
              Compare runs
            </button>
          </span>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
              gap: 10,
            }}
          >
            {client.diff.map((tile) => (
              <button
                key={tile.label}
                type="button"
                onClick={() => actions.goClientTab('findings')}
                aria-label={`${tile.n} ${tile.label} — ${tile.note}. Open the findings list.`}
                className="ph-accent-hover"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  padding: '12px 14px',
                  border: `1px solid ${tile.border}`,
                  borderRadius: 10,
                  background: tile.bg,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: FONT.sans,
                }}
              >
                <span style={{ fontSize: 23, fontWeight: 700, lineHeight: 1, color: tile.color }}>
                  {tile.n}
                </span>
                <span style={{ fontSize: 12, fontWeight: 650, color: T.inkSoft }}>
                  {tile.label}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: T.inkMuted,
                    lineHeight: 1.35,
                    textWrap: 'pretty',
                  }}
                >
                  {tile.note}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Blocking */}
        <div style={panel}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SectionHeading>What is blocking the verdict</SectionHeading>
            <button
              type="button"
              onClick={() => actions.goClientTab('findings')}
              style={{
                marginLeft: 'auto',
                padding: '5px 11px',
                border: 'none',
                background: 'none',
                color: T.accent,
                fontFamily: FONT.sans,
                fontSize: 12,
                fontWeight: 650,
                cursor: 'pointer',
              }}
            >
              All findings →
            </button>
          </span>
          {client.hasBlocking ? (
            client.blocking.map((row) => (
              <button
                key={row.what}
                type="button"
                onClick={() =>
                  actions.patch({
                    scope: 'client',
                    clientTab: 'finding',
                    findIndex: row.findingIndex,
                  })
                }
                aria-label={`Must fix: ${row.what}. ${row.file}, ${row.scope}.`}
                className="ph-soft-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 13px',
                  border: `1px solid ${T.ruleFaint}`,
                  borderRadius: 10,
                  background: T.surfaceSunk,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: FONT.sans,
                  color: T.ink,
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    padding: '3px 9px',
                    borderRadius: 999,
                    background: T.fail,
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    flexShrink: 0,
                  }}
                >
                  MUST FIX
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 650,
                      lineHeight: 1.35,
                      textWrap: 'pretty',
                    }}
                  >
                    {row.what}
                  </span>
                  <span style={{ fontSize: 11.5, color: T.inkMuted }}>
                    {row.file} · {row.scope}
                  </span>
                </span>
                <span
                  style={{
                    marginLeft: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    flexShrink: 0,
                  }}
                >
                  <Avatar initials={row.who} size={22} fontSize={9.5} />
                  <ChevronRight />
                </span>
              </button>
            ))
          ) : (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: 14,
                border: `1px solid ${T.accentEdge}`,
                borderRadius: 10,
                background: T.accentWashDeep,
                fontSize: 13,
                color: T.inkSoft,
                textWrap: 'pretty',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: T.accent,
                  color: '#fff',
                  fontSize: 13,
                  flexShrink: 0,
                }}
              >
                ✓
              </span>
              Nothing blocks the verdict. Automated checks catch about 40% of barriers — book a
              manual review to go further.
            </span>
          )}
        </div>

        {/* Journeys */}
        <div style={panel}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SectionHeading>Journeys</SectionHeading>
            <button
              type="button"
              onClick={() => actions.goClientTab('journeys')}
              style={{
                marginLeft: 'auto',
                padding: '5px 11px',
                border: 'none',
                background: 'none',
                color: T.accent,
                fontFamily: FONT.sans,
                fontSize: 12,
                fontWeight: 650,
                cursor: 'pointer',
              }}
            >
              Open journeys →
            </button>
          </span>
          {journeys.length > 0 ? (
            journeys.map((journey) => (
              <button
                key={journey.key}
                type="button"
                onClick={() => actions.goClientTab('journeys')}
                aria-label={`${journey.name} — ${journey.stepCount} steps, ${journey.firstBreak}. Open journeys.`}
                className="ph-card-hover"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '12px 13px',
                  border: `1px solid ${T.ruleFaint}`,
                  borderRadius: 10,
                  background: T.surfaceSunk,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: FONT.sans,
                  color: T.ink,
                }}
              >
                <span
                  style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}
                >
                  <span style={{ fontSize: 13, fontWeight: 650 }}>{journey.name}</span>
                  <span style={{ fontSize: 11.5, color: T.inkMuted }}>
                    {journey.stepCount} steps
                  </span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 11.5,
                      fontWeight: 650,
                      color: journey.firstBreakColor,
                    }}
                  >
                    {journey.firstBreak}
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 2, height: 9, alignItems: 'flex-end' }}>
                  {journey.ribbon.map((segment, i) => (
                    <span
                      key={i}
                      style={{ flex: 1, borderRadius: 2, background: segment.bg, height: segment.h }}
                    />
                  ))}
                </span>
              </button>
            ))
          ) : (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 16,
                border: `1px dashed ${T.ruleStrong}`,
                borderRadius: 10,
                background: T.surfaceSunk,
                fontSize: 12.5,
                color: T.inkMuted,
                textWrap: 'pretty',
              }}
            >
              No journeys recorded for this client yet. Record one to test a whole task rather than
              single pages.
              <button
                type="button"
                onClick={() => actions.flash('Recording a journey opens the flow builder.')}
                className="ph-primary"
                style={{
                  marginLeft: 'auto',
                  padding: '7px 13px',
                  border: 'none',
                  borderRadius: 8,
                  background: T.accent,
                  color: '#fff',
                  fontFamily: FONT.sans,
                  fontSize: 12,
                  fontWeight: 650,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                Record a journey
              </button>
            </span>
          )}
        </div>
      </div>

      {/* Right rail */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          position: 'sticky',
          top: 146,
        }}
      >
        <div style={{ ...panel, gap: 11, padding: 16 }}>
          <SectionHeading size={13.5}>Run history</SectionHeading>
          {client.runs.map((run) => (
            <span
              key={run.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 8,
                background: run.bg,
              }}
            >
              <span
                style={{ fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted, width: 38 }}
              >
                #{run.id}
              </span>
              <span style={{ fontSize: 13, fontWeight: 650, color: run.scoreColor, width: 26 }}>
                {run.score}
              </span>
              <span
                style={{ fontSize: 11.5, fontWeight: 650, color: run.deltaColor, width: 34 }}
              >
                {run.delta}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: T.inkMuted }}>
                {run.when}
              </span>
            </span>
          ))}
          <button
            type="button"
            onClick={() =>
              actions.flash(`Showing all ${client.runCount} runs for ${client.name}.`)
            }
            className="ph-ghost"
            style={{
              padding: 8,
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
            All {client.runCount} runs
          </button>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              paddingTop: 11,
              borderTop: `1px solid ${T.ruleFaint}`,
              fontSize: 12,
              color: T.inkMuted,
            }}
          >
            <Avatar initials={client.owner} size={22} fontSize={9.5} />
            Auditor on this account
          </span>
        </div>

        <div style={{ ...panel, gap: 10, padding: 16 }}>
          <SectionHeading size={13.5}>Coverage</SectionHeading>
          {client.coverage.map((row) => (
            <span
              key={row.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                fontSize: 12.5,
                color: T.inkSoft,
              }}
            >
              <span
                aria-hidden="true"
                style={{ width: 8, height: 8, borderRadius: 2, background: row.color, flexShrink: 0 }}
              />
              {row.label}
              <span style={{ marginLeft: 'auto', fontWeight: 650 }}>{row.n}</span>
            </span>
          ))}
          {client.hasSkipped ? (
            <span
              style={{
                padding: 10,
                borderRadius: 9,
                background: T.cautionWash,
                border: `1px solid ${T.cautionEdge}`,
                fontSize: 11.5,
                color: T.caution,
                lineHeight: 1.4,
                textWrap: 'pretty',
              }}
            >
              Skipped pages are excluded from the score, not counted as passing. Every report says
              so on the cover.
            </span>
          ) : null}
        </div>

        <a
          id="annotated-ledger"
          href="#annotated-ledger"
          onClick={(e) => {
            e.preventDefault();
            actions.flash('Opening the annotated ledger for this run.');
          }}
          className="ph-ledger-link"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            padding: 12,
            border: `1px solid ${T.ruleStrong}`,
            borderRadius: 10,
            background: T.surface,
            color: T.accent,
            fontSize: 12.5,
            fontWeight: 650,
            textDecoration: 'none',
          }}
        >
          Open the annotated ledger ↗
        </a>
      </div>
    </div>
  );
}
