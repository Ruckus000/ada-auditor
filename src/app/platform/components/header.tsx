'use client';

import { useEffect, useRef } from 'react';
import { FONT, SHADOW, T } from '../lib/tokens';
import { searchHint, searchResults, type ClientView } from '../lib/derive';
import { usePlatform, type ClientTab, type WorkspaceScreen } from '../lib/state';
import { CloseIcon, Pill, SearchIcon } from './ui';

const WORKSPACE_TABS: Array<[WorkspaceScreen, string]> = [
  ['portfolio', 'Portfolio'],
  ['reports', 'Reports'],
  ['activity', 'Activity'],
  ['settings', 'Settings'],
];

const CLIENT_TABS: Array<[ClientTab, string]> = [
  ['overview', 'Overview'],
  ['journeys', 'Journeys'],
  ['findings', 'Findings'],
  ['reports', 'Reports'],
  ['activity', 'Activity'],
  ['settings', 'Settings'],
];

function tabStyle(on: boolean) {
  return {
    color: on ? T.accent : T.inkMuted,
    fontWeight: on ? 650 : 400,
    boxShadow: on ? `inset 0 -2px 0 ${T.accent}` : 'none',
  };
}

export function PlatformHeader() {
  const { state, actions } = usePlatform();
  const inClient = state.scope === 'client';
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.search) searchRef.current?.focus();
  }, [state.search]);

  const results = searchResults(state.query, state.findOverrides);

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'clamp(12px,1.6vw,26px)',
        padding: '0 clamp(14px,1.8vw,28px)',
        height: 56,
        borderBottom: `1px solid ${T.rule}`,
        background: T.surface,
        position: 'sticky',
        top: 0,
        zIndex: 30,
      }}
    >
      <button
        type="button"
        onClick={() => actions.goWorkspace('portfolio')}
        title="ADA Auditor — back to Portfolio"
        aria-label="ADA Auditor — back to Portfolio"
        style={{
          display: 'flex',
          alignItems: 'baseline',
          padding: 0,
          border: 'none',
          background: 'none',
          fontFamily: FONT.sans,
          fontSize: 19,
          fontWeight: 700,
          letterSpacing: '-0.04em',
          flexShrink: 0,
          lineHeight: 1,
          cursor: 'pointer',
        }}
      >
        <span style={{ color: T.ink }}>A</span>
        <span style={{ color: T.accent }}>A</span>
      </button>

      <nav
        aria-label="Workspace"
        style={{ display: 'flex', alignItems: 'center', gap: 2, height: '100%', minWidth: 0 }}
      >
        {WORKSPACE_TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => actions.goWorkspace(key)}
            aria-current={!inClient && state.screen === key ? 'page' : undefined}
            className="ph-nav"
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '0 clamp(8px,0.9vw,14px)',
              height: '100%',
              border: 'none',
              background: 'none',
              fontFamily: FONT.sans,
              fontSize: 13.5,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              ...tabStyle(!inClient && state.screen === key),
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      <span
        style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 'clamp(8px,0.9vw,12px)',
          minWidth: 0,
        }}
      >
        {state.search ? (
          <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <SearchIcon
              color={T.inkMuted}
              style={{ position: 'absolute', left: 10, pointerEvents: 'none' }}
            />
            <input
              ref={searchRef}
              type="text"
              value={state.query}
              onChange={(e) => actions.patch({ query: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') actions.patch({ search: false, query: '' });
              }}
              placeholder="Search clients by name or domain"
              aria-label="Find a client"
              style={{
                width: 'clamp(220px,22vw,308px)',
                height: 32,
                padding: '0 30px 0 32px',
                border: `1px solid ${T.accent}`,
                borderRadius: 8,
                background: T.surface,
                color: T.ink,
                fontFamily: FONT.sans,
                fontSize: 12.5,
                outline: 'none',
                boxShadow: '0 0 0 3px rgba(11,95,88,0.12)',
              }}
            />
            <button
              type="button"
              onClick={() => actions.patch({ search: false, query: '' })}
              aria-label="Close search"
              className="ph-icon-button"
              style={{
                position: 'absolute',
                right: 7,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 20,
                border: 'none',
                borderRadius: 5,
                background: 'none',
                color: T.inkFaint,
                cursor: 'pointer',
              }}
            >
              <CloseIcon />
            </button>
            <span
              className="ph-pop"
              style={{
                position: 'absolute',
                top: 38,
                right: 0,
                width: 392,
                zIndex: 40,
                display: 'flex',
                flexDirection: 'column',
                padding: 5,
                border: `1px solid ${T.rule}`,
                borderRadius: 12,
                background: T.surface,
                boxShadow: SHADOW.popover,
              }}
            >
              <span
                style={{
                  padding: '8px 9px 7px',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.09em',
                  color: T.inkFaint,
                }}
              >
                {searchHint(state.query, results)}
              </span>
              {results.map((result) => (
                <button
                  key={result.name}
                  type="button"
                  onClick={() => {
                    actions.openClient(result.index);
                    actions.patch({ search: false, query: '' });
                  }}
                  className="ph-menu-item"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 9px',
                    border: 'none',
                    borderRadius: 8,
                    background: 'transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontFamily: FONT.sans,
                  }}
                >
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 650, color: T.ink }}>
                      {result.name}
                    </span>
                    <span style={{ fontFamily: FONT.mono, fontSize: 11, color: T.inkMuted }}>
                      {result.domain}
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
                    <span style={{ fontSize: 11.5, fontWeight: 650, color: result.mustColor }}>
                      {result.mustLabel}
                    </span>
                    <Pill
                      bg={result.chipBg}
                      color={result.chipColor}
                      border={result.chipBorder}
                      size={10}
                      padding="2px 8px"
                    >
                      {result.chipLabel}
                    </Pill>
                  </span>
                </button>
              ))}
              {results.length === 0 ? (
                <span
                  style={{
                    padding: '14px 10px 16px',
                    fontSize: 12.5,
                    color: T.inkMuted,
                    lineHeight: 1.5,
                    textWrap: 'pretty',
                  }}
                >
                  No client matches “{state.query}”. Check the spelling, or add the site if it is
                  not audited yet.
                </span>
              ) : null}
            </span>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => actions.patch({ search: true, query: '' })}
            aria-label="Find a client"
            className="ph-search-trigger"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: 'clamp(150px,15vw,236px)',
              height: 32,
              padding: '0 8px 0 10px',
              border: `1px solid ${T.rule}`,
              borderRadius: 8,
              background: T.surfaceSunk,
              color: T.inkFaint,
              fontFamily: FONT.sans,
              fontSize: 12.5,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              cursor: 'pointer',
              transition: 'border-color 120ms, background 120ms',
            }}
          >
            <SearchIcon />
            Find a client
            <span
              aria-hidden="true"
              style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 1,
                height: 19,
                padding: '0 6px',
                border: '1px solid #e2ddd0',
                borderRadius: 5,
                background: T.surface,
                color: T.inkFaint,
                fontFamily: FONT.mono,
                fontSize: 10.5,
                fontWeight: 500,
                lineHeight: 1,
              }}
            >
              ⌘K
            </span>
          </button>
        )}

        {inClient ? (
          <a
            href="#annotated-ledger"
            className="ph-quiet-link"
            style={{ fontSize: 12.5, color: T.inkMuted, textDecoration: 'none' }}
          >
            Audit view ↗
          </a>
        ) : null}

        {/* Not in the source design, which specifies this header exactly and
            gives the avatar no menu. Added because moving the console to
            /console left it reachable only by typing the URL. A plain anchor,
            not a client-side link: the console is a separate surface with its
            own stylesheet, so a full navigation is the honest behaviour. */}
        <a
          href="/console"
          className="ph-quiet-link"
          style={{
            fontSize: 12.5,
            color: T.inkMuted,
            textDecoration: 'none',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          Console ↗
        </a>

        <button
          type="button"
          onClick={() => actions.patch({ modal: 'audit' })}
          className="ph-primary"
          style={{
            padding: '8px clamp(11px,1.1vw,16px)',
            border: 'none',
            borderRadius: 8,
            background: T.accent,
            color: '#fff',
            fontFamily: FONT.sans,
            fontSize: 13,
            fontWeight: 650,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          Add a client site
        </button>

        <span
          title="Signed in as Jules Reyes, lead auditor"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            flexShrink: 0,
            borderRadius: '50%',
            background: T.accentWash,
            color: T.accentInk,
            fontSize: 12.5,
            fontWeight: 700,
            border: `1px solid ${T.ruleStrong}`,
          }}
        >
          JR
        </span>
      </span>
    </header>
  );
}

export function ClientBar({ client }: { client: ClientView }) {
  const { state, actions } = usePlatform();

  return (
    <div
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
        <button
          type="button"
          onClick={() => actions.goWorkspace('portfolio')}
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
            cursor: 'pointer',
          }}
        >
          ← Portfolio
        </button>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minWidth: 0,
            flexWrap: 'wrap',
          }}
        >
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: '-0.015em' }}>
            {client.name}
          </h1>
          <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: T.inkMuted }}>
            {client.domain}
          </span>
          <Pill bg={client.chipBg} color={client.chipColor} border={client.chipBorder}>
            {client.chipLabel}
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
            <span style={{ fontSize: 14, fontWeight: 700, color: client.scoreColor }}>
              {client.score}
            </span>
            <span style={{ fontWeight: 650, color: client.deltaColor }}>{client.delta}</span>
          </span>
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11.5, color: T.inkMuted }}>
            {client.last} · next {client.next}
          </span>
          <button
            type="button"
            onClick={() =>
              actions.flash(`Run queued for ${client.name}. Findings appear as they land.`)
            }
            className="ph-ghost"
            style={{
              padding: '7px 13px',
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
            Re-run now
          </button>
          <button
            type="button"
            onClick={() => actions.patch({ modal: 'generate' })}
            className="ph-primary"
            style={{
              padding: '7px 13px',
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
            Generate report
          </button>
        </span>
      </div>
      <nav
        aria-label={client.name}
        style={{ display: 'flex', gap: 2, padding: '0 clamp(14px,1.8vw,28px)', overflowX: 'auto' }}
      >
        {CLIENT_TABS.map(([key, label]) => {
          const on =
            state.clientTab === key || (key === 'findings' && state.clientTab === 'finding');
          return (
            <button
              key={key}
              type="button"
              onClick={() => actions.goClientTab(key)}
              aria-current={on ? 'page' : undefined}
              className="ph-nav"
              style={{
                padding: '8px 13px',
                border: 'none',
                background: 'none',
                fontFamily: FONT.sans,
                fontSize: 13,
                cursor: 'pointer',
                ...tabStyle(on),
              }}
            >
              {label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
