'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ClientDetail } from '../../../../services/client-detail';
import { FONT, T } from '../../lib/tokens';
import { VERDICT_CHIP } from '../../lib/verdict-chip';
import { Pill } from '../ui';

/**
 * The bar and tabs above every client screen.
 *
 * Replaces `ClientBar`, which took a `ClientView` off the fixtures and showed a
 * domain, a trend arrow, a coverage percentage and a next-run time. None of
 * those exist in the record. What is here is what a run actually reports.
 *
 * The tabs are `<Link>`s rather than buttons that call the router: a client
 * screen is a place, and a place you cannot open in a new tab or copy out of
 * the address bar is not one.
 */
export function ClientShell({
  detail,
  children,
}: {
  detail: ClientDetail;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const tabs: Array<[label: string, href: string]> = [
    ['Overview', `/clients/${detail.id}`],
    ['Findings', `/clients/${detail.id}/findings`],
    ['Journeys', `/clients/${detail.id}/journeys`],
  ];

  const badge = VERDICT_CHIP[detail.lastRun?.verdict ?? 'scan'];

  return (
    <>
      {/* A labelled region, not a bare div: this sits between the banner and
          <main>, so without a landmark a screen-reader user moving by landmark
          skips the client's name, verdict and last run entirely. Our own engine
          reported it as `region` on every client route. */}
      <section
        aria-label={`${detail.name} summary`}
        style={{
          position: 'sticky',
          top: 56,
          zIndex: 25,
          display: 'flex',
          flexDirection: 'column',
          background: T.surfaceSunk,
          borderBottom: `1px solid ${T.rule}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'clamp(9px,1vw,14px)',
            padding: '11px clamp(14px,1.8vw,28px) 10px',
            flexWrap: 'wrap',
          }}
        >
          <Link
            href="/"
            className="ph-ghost"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 11px',
              border: `1px solid ${T.ruleStrong}`,
              borderRadius: 8,
              background: T.surface,
              color: T.inkMuted,
              fontFamily: FONT.sans,
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            ← Portfolio
          </Link>

          <span
            style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flexWrap: 'wrap' }}
          >
            <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: '-0.015em' }}>
              {detail.name}
            </h1>

            {detail.lastRun ? (
              <>
                <Pill bg={badge.bg} color={badge.color} border={badge.border}>
                  {badge.label}
                </Pill>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'baseline',
                    gap: 4,
                    fontSize: 12.5,
                    color: T.inkMuted,
                  }}
                >
                  score
                  <span style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>
                    {detail.lastRun.score ?? '—'}
                  </span>
                </span>
              </>
            ) : (
              <span style={{ fontSize: 12.5, color: T.inkMuted }}>Never audited</span>
            )}
          </span>

          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: T.inkMuted }}>
            {detail.owner ? `Owner ${detail.owner}` : 'No owner set'}
          </span>
        </div>

        <nav
          aria-label={detail.name}
          style={{
            display: 'flex',
            gap: 2,
            padding: '0 clamp(14px,1.8vw,28px)',
            overflowX: 'auto',
          }}
        >
          {tabs.map(([label, href]) => {
            const on = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={on ? 'page' : undefined}
                className="ph-nav"
                style={{
                  padding: '8px 13px',
                  fontFamily: FONT.sans,
                  fontSize: 13,
                  textDecoration: 'none',
                  fontWeight: on ? 650 : 500,
                  color: on ? T.ink : T.inkMuted,
                  borderBottom: `2px solid ${on ? T.accent : 'transparent'}`,
                }}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </section>

      {children}
    </>
  );
}
