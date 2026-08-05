'use client';

import { COVER_GROUPS, COVER_STATS, SCAN_STATS, type CoverTone } from '../lib/data';
import { clientLinkView } from '../lib/derive';
import { usePlatform } from '../lib/state';
import { FONT, T } from '../lib/tokens';
import { ScreenHeading } from './ui';

const STATUS_TONE: Record<CoverTone, [string, string, string]> = {
  done: [T.accentWash, T.accent, T.accentEdge],
  scope: [T.paperDeep, T.inkMuted, T.rule],
  hide: [T.cautionWashDeep, T.caution, T.cautionEdge],
};

export function StatesScreen() {
  const { actions } = usePlatform();

  return (
    <div
      data-screen-label="States gallery"
      style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
    >
      <ScreenHeading
        title="The unglamorous states"
        lede="Each one says what happened, what we know so far, and the single next thing to do."
      />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          padding: 26,
          border: `1px solid ${T.rule}`,
          borderRadius: 12,
          background: T.surface,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.09em',
              color: T.inkMuted,
            }}
          >
            SCAN IN PROGRESS
          </span>
          <span style={{ fontSize: 12.5, color: T.inkMuted }}>
            — you can read findings as they land
          </span>
        </span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>
            Walking acmeoutfitters.com
          </span>
          <span style={{ fontSize: 13, color: T.inkMuted }}>
            142 of about 250 pages · roughly 2 minutes left
          </span>
        </span>
        <span
          role="progressbar"
          aria-valuenow={57}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Scan progress"
          style={{
            height: 8,
            borderRadius: 999,
            background: T.ruleFaint,
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              display: 'block',
              height: '100%',
              width: '57%',
              borderRadius: 999,
              background: T.accent,
            }}
          />
        </span>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))',
            gap: 12,
          }}
        >
          {SCAN_STATS.map((stat) => (
            <span
              key={stat.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                padding: '12px 14px',
                border: `1px solid ${T.ruleFaint}`,
                borderRadius: 10,
                background: T.surfaceSunk,
              }}
            >
              <span style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, color: stat.color }}>
                {stat.n}
              </span>
              <span style={{ fontSize: 11.5, color: T.inkMuted }}>{stat.label}</span>
            </span>
          ))}
        </div>
        <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted }}>
          now reading /collections/outerwear/trail-jacket
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))',
          gap: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: 26,
            border: `1px solid ${T.accentEdge}`,
            borderRadius: 12,
            background: T.accentWashDeep,
            textAlign: 'center',
            alignItems: 'center',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 46,
              height: 46,
              borderRadius: '50%',
              background: T.accent,
              color: '#fff',
              fontSize: 20,
            }}
          >
            ✓
          </span>
          <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.01em' }}>
            Nothing left to fix
          </span>
          <span
            style={{
              fontSize: 13.5,
              color: T.inkSoft,
              lineHeight: 1.55,
              maxWidth: 420,
              textWrap: 'pretty',
            }}
          >
            All 24 pages pass WCAG 2.2 AA. Cedar &amp; Co has been clean for 6 runs straight.
            Automated checks catch about 40% of barriers — a manual review is the honest next step.
          </span>
          <span style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => actions.patch({ modal: 'generate' })}
              className="ph-primary"
              style={{
                padding: '9px 16px',
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
              Issue the report
            </button>
            <button
              type="button"
              onClick={() =>
                actions.flash('Request sent. An auditor will confirm a date by email.')
              }
              style={{
                padding: '9px 16px',
                border: `1px solid ${T.accentEdge}`,
                borderRadius: 9,
                background: T.surface,
                color: T.accent,
                fontFamily: FONT.sans,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Book a manual review
            </button>
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: 26,
            border: `1px dashed ${T.ruleStrong}`,
            borderRadius: 12,
            background: T.surface,
            textAlign: 'center',
            alignItems: 'center',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 46,
              height: 46,
              borderRadius: 12,
              background: T.paperDeep,
              color: T.inkMuted,
              fontSize: 19,
            }}
          >
            ◷
          </span>
          <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.01em' }}>
            No runs yet
          </span>
          <span
            style={{
              fontSize: 13.5,
              color: T.inkSoft,
              lineHeight: 1.55,
              maxWidth: 400,
              textWrap: 'pretty',
            }}
          >
            Point us at a URL and we will crawl it, follow the journeys you care about, and come
            back with findings in plain language. The first run usually takes four minutes.
          </span>
          <button
            type="button"
            onClick={() => actions.patch({ modal: 'audit' })}
            className="ph-primary"
            style={{
              marginTop: 4,
              padding: '9px 18px',
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
            Start the first run
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))',
          gap: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: 22,
            border: `1px solid ${T.failEdge}`,
            borderRadius: 12,
            background: T.failWash,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                display: 'inline-flex',
                padding: '3px 10px',
                borderRadius: 999,
                background: T.fail,
                color: '#fff',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.04em',
              }}
            >
              RUN FAILED
            </span>
            <span style={{ fontSize: 12, color: T.inkMuted }}>08:04 · attempt 2 of 3</span>
          </span>
          <span
            style={{
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              textWrap: 'pretty',
            }}
          >
            We could not reach northwindhealth.org
          </span>
          <span
            style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.55, textWrap: 'pretty' }}
          >
            The server closed the connection after 30 seconds on every attempt. Nothing was tested,
            and your last passing results from 29 July are untouched.
          </span>
          <span
            style={{
              padding: 11,
              borderRadius: 9,
              background: T.surface,
              border: `1px solid ${T.failEdge}`,
              fontFamily: FONT.mono,
              fontSize: 11.5,
              color: T.fail,
            }}
          >
            ETIMEDOUT · 3 attempts · last 08:04:22 UTC
          </span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() =>
                actions.flash('Run queued for Northwind Health. Findings appear as they land.')
              }
              className="ph-primary-danger"
              style={{
                padding: '8px 15px',
                border: 'none',
                borderRadius: 8,
                background: T.fail,
                color: '#fff',
                fontFamily: FONT.sans,
                fontSize: 12.5,
                fontWeight: 650,
                cursor: 'pointer',
              }}
            >
              Try again now
            </button>
            <button
              type="button"
              onClick={() =>
                actions.flash('Crawler IPs copied. Add them to the site’s allow-list, then re-run.')
              }
              style={{
                padding: '8px 15px',
                border: `1px solid ${T.failEdge}`,
                borderRadius: 8,
                background: T.surface,
                color: T.fail,
                fontFamily: FONT.sans,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Allow-list our crawler
            </button>
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: 22,
            border: `1px solid ${T.cautionEdge}`,
            borderRadius: 12,
            background: T.cautionWash,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                display: 'inline-flex',
                padding: '3px 10px',
                borderRadius: 999,
                background: T.cautionWashDeep,
                border: `1px solid ${T.cautionEdge}`,
                color: T.caution,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.04em',
              }}
            >
              PARTIAL COVERAGE
            </span>
            <span style={{ fontSize: 12, color: T.inkMuted }}>run #131</span>
          </span>
          <span
            style={{
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              textWrap: 'pretty',
            }}
          >
            6 pages sit behind a sign-in we do not have
          </span>
          <span
            style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.55, textWrap: 'pretty' }}
          >
            Order history, saved cards and three account pages were never loaded. They are excluded
            from the score rather than counted as passing — a report issued today would say so on
            the cover.
          </span>
          <span
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
              padding: 11,
              borderRadius: 9,
              background: T.surface,
              border: `1px solid ${T.cautionEdgeSoft}`,
              fontFamily: FONT.mono,
              fontSize: 11.5,
              color: T.inkSoft,
            }}
          >
            <span>/account/orders</span>
            <span>/account/cards</span>
            <span style={{ color: T.inkMuted }}>+ 4 more</span>
          </span>
          <button
            type="button"
            onClick={() => actions.flash('Add the test account under Settings → Schedule.')}
            style={{
              alignSelf: 'flex-start',
              padding: '8px 15px',
              border: 'none',
              borderRadius: 8,
              background: T.caution,
              color: '#fff',
              fontFamily: FONT.sans,
              fontSize: 12.5,
              fontWeight: 650,
              cursor: 'pointer',
            }}
          >
            Add a test account
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClientLinkScreen() {
  const { state, actions } = usePlatform();
  const lp = clientLinkView(state.linkClient ?? 'Acme Outfitters', state.findOverrides);

  return (
    <div
      data-screen-label="Client link — read-only view"
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '11px 15px',
          border: `1px solid ${T.infoEdge}`,
          borderRadius: 11,
          background: T.infoWash,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 650, color: T.info }}>
          You are previewing what the client sees at {lp.url}
        </span>
        <span style={{ fontSize: 12, color: T.inkSoft }}>
          Read-only · dismissed findings hidden · no internal notes
        </span>
        <button
          type="button"
          onClick={() =>
            state.linkReturn === 'client'
              ? actions.patch({ scope: 'client', clientTab: 'reports', screen: 'reports' })
              : actions.patch({ scope: 'ws', screen: 'reports' })
          }
          style={{
            marginLeft: 'auto',
            padding: '6px 12px',
            border: `1px solid ${T.infoEdge}`,
            borderRadius: 8,
            background: T.surface,
            color: T.info,
            fontFamily: FONT.sans,
            fontSize: 12,
            fontWeight: 650,
            cursor: 'pointer',
          }}
        >
          Exit preview
        </button>
      </div>

      <div
        style={{
          maxWidth: 920,
          width: '100%',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: '34px 38px',
          border: `1px solid ${T.rule}`,
          borderRadius: 12,
          background: T.surface,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 14,
            paddingBottom: 16,
            borderBottom: `1px solid ${T.ruleFaint}`,
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '0.12em',
                color: T.inkMuted,
              }}
            >
              SHARED BY MERIDIAN ACCESS
            </span>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>
              {lp.name} — accessibility status
            </h1>
            <span style={{ fontSize: 12.5, color: T.inkMuted }}>{lp.meta}</span>
          </span>
          <span
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              padding: '6px 13px',
              borderRadius: 999,
              background: lp.verdictBg,
              color: '#fff',
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
            }}
          >
            {lp.verdict}
          </span>
        </div>

        <p
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.6,
            color: T.inkSoft,
            textWrap: 'pretty',
          }}
        >
          {lp.intro}
        </p>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))',
            gap: 10,
          }}
        >
          {lp.summary.map((row) => (
            <span
              key={row.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                padding: '13px 15px',
                border: `1px solid ${T.ruleFaint}`,
                borderRadius: 10,
                background: T.surfaceSunk,
              }}
            >
              <span style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: row.color }}>
                {row.n}
              </span>
              <span style={{ fontSize: 12, fontWeight: 650, color: T.inkSoft }}>{row.label}</span>
              <span style={{ fontSize: 11, color: T.inkMuted }}>{row.note}</span>
            </span>
          ))}
        </div>

        {lp.findings.map((finding) => (
          <span
            key={finding.what}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              padding: 14,
              border: `1px solid ${T.ruleFaint}`,
              borderRadius: 10,
              background: T.surfaceSunk,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
              <span
                style={{
                  display: 'inline-flex',
                  padding: '3px 9px',
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  background: finding.sevBg,
                  color: finding.sevColor,
                  border: `1px solid ${finding.sevBorder}`,
                }}
              >
                {finding.sev}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 650 }}>{finding.what}</span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontFamily: FONT.mono,
                  fontSize: 11,
                  color: T.inkMuted,
                }}
              >
                {finding.wcag}
              </span>
            </span>
            <span
              style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.5, textWrap: 'pretty' }}
            >
              {finding.plain}
            </span>
          </span>
        ))}

        <span
          style={{
            padding: 13,
            borderRadius: 10,
            background: T.paperDeep,
            fontSize: 11.5,
            color: T.inkMuted,
            lineHeight: 1.5,
            textWrap: 'pretty',
          }}
        >
          {lp.footer}
        </span>
      </div>
    </div>
  );
}

const COVER_COLUMNS =
  'minmax(130px,1.5fr) minmax(220px,2.3fr) minmax(120px,1.2fr) minmax(94px,0.7fr)';

export function CoverageScreen() {
  return (
    <div
      data-screen-label="Coverage index"
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <ScreenHeading
        title="Coverage index"
        lede={
          <>
            Every screen, state and modal in this design, and where to find it. Anything marked{' '}
            <span style={{ fontWeight: 650, color: T.fail }}>out of scope</span> is deliberately not
            designed — do not invent it during build.
          </>
        }
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))',
          gap: 12,
        }}
      >
        {COVER_STATS.map((stat) => (
          <span
            key={stat.label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '14px 16px',
              border: `1px solid ${T.rule}`,
              borderRadius: 11,
              background: T.surface,
            }}
          >
            <span style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, color: stat.color }}>
              {stat.n}
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 650, color: T.inkSoft }}>{stat.label}</span>
          </span>
        ))}
      </div>

      {COVER_GROUPS.map((group) => (
        <div key={group.label} style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: '0.07em',
              color: T.inkMuted,
            }}
          >
            {group.label}
          </h2>
          <div
            style={{
              border: `1px solid ${T.rule}`,
              borderRadius: 12,
              background: T.surface,
              overflowX: 'auto',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: COVER_COLUMNS,
                gap: 'clamp(8px,0.8vw,12px)',
                padding: '10px 16px',
                borderBottom: `1px solid ${T.rule}`,
                background: T.paperDeep,
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: '0.07em',
                color: T.inkMuted,
              }}
            >
              <span>SCREEN OR STATE</span>
              <span>WHAT IT COVERS</span>
              <span>HOW TO REACH IT</span>
              <span>STATUS</span>
            </div>
            {group.rows.map(([name, covers, where, tone, status]) => {
              const [bg, color, border] = STATUS_TONE[tone];
              return (
                <div
                  key={name}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: COVER_COLUMNS,
                    gap: 'clamp(8px,0.8vw,12px)',
                    alignItems: 'center',
                    padding: '12px 16px',
                    borderBottom: `1px solid ${T.ruleFaint}`,
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 650 }}>{name}</span>
                  <span
                    style={{
                      fontSize: 12,
                      color: T.inkSoft,
                      lineHeight: 1.45,
                      textWrap: 'pretty',
                    }}
                  >
                    {covers}
                  </span>
                  <span style={{ fontSize: 11.5, color: T.inkMuted, lineHeight: 1.4 }}>
                    {where}
                  </span>
                  <span>
                    <span
                      style={{
                        display: 'inline-flex',
                        padding: '3px 9px',
                        borderRadius: 7,
                        fontSize: 10.5,
                        fontWeight: 700,
                        letterSpacing: '0.03em',
                        background: bg,
                        color,
                        border: `1px solid ${border}`,
                      }}
                    >
                      {status}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
