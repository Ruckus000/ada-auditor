'use client';

import { KPIS } from '../lib/data';
import { siteViews } from '../lib/derive';
import { usePlatform } from '../lib/state';
import { T } from '../lib/tokens';
import { FONT } from '../lib/tokens';
import { Avatar, ChevronRight, DropMenu, Pill, ScreenHeading, TableHead, TableShell } from './ui';

const COLUMNS =
  'minmax(150px,2.1fr) minmax(88px,0.9fr) minmax(58px,0.7fr) minmax(50px,0.7fr) minmax(84px,1fr) minmax(78px,1fr) minmax(52px,0.8fr) 44px';

export function PortfolioScreen() {
  const { state, actions } = usePlatform();
  const sites = siteViews(state.findOverrides);
  const hasClients = !state.firstRun;

  return (
    <div
      data-screen-label="Portfolio"
      style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <ScreenHeading
          title="Portfolio"
          lede="Sorted so the work that has to happen this week is at the top."
        />
        {hasClients ? (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <DropMenu
              menu={actions.menu('sort', 'Sort: most urgent', [
                'Sort: most urgent',
                'Sort: lowest score',
                'Sort: recently run',
                'Sort: name A–Z',
              ])}
            />
            <DropMenu
              menu={{
                ...actions.menu('owner', 'All owners', [
                  'All owners',
                  'Jules Reyes',
                  'Mira Sato',
                  'Tomás Lund',
                ]),
                width: 180,
              }}
            />
          </span>
        ) : null}
      </div>

      {hasClients ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))',
              gap: 14,
            }}
          >
            {KPIS.map((kpi) => (
              <div
                key={kpi.label}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '16px 18px',
                  border: `1px solid ${T.rule}`,
                  borderRadius: 12,
                  background: T.surface,
                }}
              >
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 650,
                    letterSpacing: '0.06em',
                    color: T.inkMuted,
                  }}
                >
                  {kpi.label}
                </span>
                <span
                  style={{
                    fontSize: 30,
                    fontWeight: 700,
                    letterSpacing: '-0.03em',
                    lineHeight: 1,
                    color: kpi.color,
                  }}
                >
                  {kpi.value}
                </span>
                <span style={{ fontSize: 12, color: T.inkMuted }}>{kpi.note}</span>
              </div>
            ))}
          </div>

          <TableShell>
            <TableHead
              template={COLUMNS}
              columns={[
                'CLIENT',
                'VERDICT',
                'MUST FIX',
                'SCORE',
                'SINCE LAST RUN',
                'LAST RUN',
                'OWNER',
                '',
              ]}
            />
            {sites.map((site) => (
              <button
                key={site.name}
                type="button"
                onClick={() => actions.openClient(site.index)}
                // The visible row is a grid of cells; without this the button's
                // name would be every cell run together.
                aria-label={`${site.name} — ${site.chipLabel.replace(/[^A-Za-z ]/g, '').trim()}, ${site.must} must fix, score ${site.score}`}
                className="ph-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: COLUMNS,
                  gap: 'clamp(8px,0.8vw,12px)',
                  alignItems: 'center',
                  width: '100%',
                  padding: '13px 18px',
                  border: 'none',
                  borderBottom: `1px solid ${T.ruleFaint}`,
                  background: 'transparent',
                  textAlign: 'left',
                  fontFamily: FONT.sans,
                  color: T.ink,
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 650 }}>{site.name}</span>
                  <span style={{ fontFamily: FONT.mono, fontSize: 11, color: T.inkMuted }}>
                    {site.domain}
                  </span>
                </span>
                <span>
                  <Pill bg={site.chipBg} color={site.chipColor} border={site.chipBorder}>
                    {site.chipLabel}
                  </Pill>
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: site.mustColor }}>
                  {site.must}
                </span>
                <span style={{ fontSize: 14, fontWeight: 650, color: site.scoreColor }}>
                  {site.score}
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: site.deltaColor }}>
                  {site.deltaLong}
                </span>
                <span style={{ fontSize: 12.5, color: T.inkMuted }}>{site.last}</span>
                <Avatar initials={site.owner} />
                <span
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: 9,
                  }}
                >
                  {site.flagged ? (
                    <span title={site.flag} style={{ color: T.fail, fontSize: 17, lineHeight: 1 }}>
                      ⚑
                    </span>
                  ) : null}
                  <ChevronRight />
                </span>
              </button>
            ))}
          </TableShell>
        </>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: 46,
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
              maxWidth: 440,
              textWrap: 'pretty',
            }}
          >
            Add your first client site and we will crawl it, follow the journeys you care about, and
            come back with findings in plain language. The first run usually takes four minutes.
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
            Add a client site
          </button>
        </div>
      )}
    </div>
  );
}
