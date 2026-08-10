'use client';

/**
 * The read-only view a client sees behind a share link.
 *
 * Lifted out of `review-screens.tsx` when the two design-review surfaces it
 * shared a file with (States, Coverage) were deleted. This one is not a review
 * surface — it becomes the `/r/[token]` route, rendered from the run the
 * report was issued against rather than from whatever ran last.
 */

import { clientLinkView } from '../lib/derive';
import { usePlatform } from '../lib/state';
import { FONT, T } from '../lib/tokens';
import { ScreenHeading } from './ui';

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

