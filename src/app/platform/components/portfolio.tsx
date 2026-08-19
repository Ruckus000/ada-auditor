'use client';

import { useRouter } from 'next/navigation';
import type { PortfolioRow } from '../../../services/portfolio';
import { VERDICT_CHIP, verdictWords } from '../lib/verdict-chip';
import { T } from '../lib/tokens';
import { FONT } from '../lib/tokens';
import { Avatar, ChevronRight, Pill, ScreenHeading, TableHead, TableShell } from './ui';

const COLUMNS =
  'minmax(160px,2.4fr) minmax(96px,1fr) minmax(64px,0.7fr) minmax(56px,0.7fr) minmax(70px,0.8fr) minmax(90px,1.1fr) minmax(56px,0.8fr) 44px';

/** Initials for the owner avatar; the column is blank when nobody owns it. */
function initials(owner: string | undefined): string {
  if (!owner) return '—';
  const words = owner.split(/\s+/).filter(Boolean);
  return `${words[0]?.[0] ?? ''}${words.length > 1 ? words[words.length - 1][0] : ''}`.toUpperCase();
}

/** Absolute date rather than "2h ago": a relative string rendered on the
 *  server is wrong the moment the page sits open, and rendering it on the
 *  client is a hydration mismatch waiting to happen. */
function runDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function PortfolioScreen({ clients }: { clients: PortfolioRow[] }) {
  const router = useRouter();
  const hasClients = clients.length > 0;

  return (
    <div
      data-screen-label="Portfolio"
      style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <ScreenHeading
          title="Portfolio"
          lede={
            hasClients
              ? `${clients.length} ${clients.length === 1 ? 'client' : 'clients'}, newest run first.`
              : 'Nobody yet.'
          }
        />
      </div>

      {hasClients ? (
        <>
          <TableShell>
            <TableHead
              template={COLUMNS}
              columns={[
                'CLIENT',
                'VERDICT',
                'MUST FIX',
                'SCORE',
                'PAGES',
                'LAST RUN',
                'OWNER',
                '',
              ]}
            />
            {clients.map((client) => {
              const badge = VERDICT_CHIP[client.lastRun?.verdict ?? 'scan'];
              const mustFix = client.lastRun?.mustFix ?? 0;

              return (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => router.push(`/clients/${client.id}`)}
                  // The visible row is a grid of cells; without this the
                  // button's name would be every cell run together.
                  aria-label={`${client.name} — ${
                    client.lastRun ? verdictWords(client.lastRun.verdict) : 'never audited'
                  }, ${mustFix} must fix`}
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
                    <span style={{ fontSize: 13.5, fontWeight: 650 }}>{client.name}</span>
                    <span style={{ fontFamily: FONT.mono, fontSize: 11, color: T.inkMuted }}>
                      {client.journeyCount === 1 ? '1 journey' : `${client.journeyCount} journeys`}
                    </span>
                  </span>

                  <span>
                    {client.lastRun ? (
                      <Pill bg={badge.bg} color={badge.color} border={badge.border}>
                        {badge.label}
                      </Pill>
                    ) : (
                      <span style={{ fontSize: 12.5, color: T.inkMuted }}>Never audited</span>
                    )}
                  </span>

                  <span style={{ fontSize: 14, fontWeight: 700, color: mustFix > 0 ? T.fail : T.inkMuted }}>
                    {client.lastRun ? mustFix : '—'}
                  </span>

                  {/* An em dash, not a zero: a run we could not score is not a
                      run that scored badly. */}
                  <span style={{ fontSize: 14, fontWeight: 650, color: T.inkSoft }}>
                    {client.lastRun?.score ?? '—'}
                  </span>

                  <span style={{ fontSize: 12.5, color: T.inkMuted }}>
                    {client.lastRun ? client.lastRun.pagesAudited : '—'}
                  </span>

                  <span style={{ fontSize: 12.5, color: T.inkMuted }}>
                    {client.lastRun ? runDate(client.lastRun.createdAt) : '—'}
                  </span>

                  <Avatar initials={initials(client.owner)} />

                  <span style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                    <ChevronRight />
                  </span>
                </button>
              );
            })}
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
            No clients yet
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
            Add the first one. Then record a journey through their site — a checkout, a booking, a
            sign-in — and every run walks it and reports what a real user would hit.
          </span>
          <button
            type="button"
            onClick={() => router.push('/clients/new')}
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
            Add the first client
          </button>
        </div>
      )}
    </div>
  );
}
