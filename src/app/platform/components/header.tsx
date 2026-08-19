'use client';

import { useRouter } from 'next/navigation';
import { FONT, SHADOW, T } from '../lib/tokens';
import { usePlatform, type WorkspaceScreen } from '../lib/state';


const WORKSPACE_TABS: Array<[WorkspaceScreen, string]> = [
  ['portfolio', 'Portfolio'],
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
  const router = useRouter();
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
        {WORKSPACE_TABS.map(([key, label]) => {
          // `parseRoute` resolves anything that is not a workspace path to the
          // portfolio, so on `/clients/acme` this marked Portfolio as the
          // current page and painted it accented. A client screen is not any
          // of these tabs.
          const on = state.scope === 'ws' && state.screen === key;

          return (
          <button
            key={key}
            type="button"
            onClick={() => actions.goWorkspace(key)}
            aria-current={on ? 'page' : undefined}
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
              ...tabStyle(on),
            }}
          >
            {label}
          </button>
          );
        })}
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
        {/* The ⌘K client search lived here. It searched eight invented
            clients and navigated by fixture index, so against real clients
            every result was a 404. Deleted rather than left looking
            functional; it returns when there is a real index to search. */}

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
          onClick={() => router.push('/clients/new')}
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
          Add a client
        </button>

        {/* The signed-in operator, not a person we made up. The name is
            resolved by the platform layout, on the server, from the current
            principal — with `AUDITOR_OPERATOR_NAME` as the configured
            fallback for machine principals, which is why it can still render
            "Operator" when nobody set one.

            The initials had a `title` attribute, which most assistive
            technology never announces on a non-interactive element: the name
            was effectively absent rather than merely wrong. */}
        <span
          aria-label={`Signed in as ${state.operator.name}`}
          role="img"
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
          {state.operator.initials}
        </span>
      </span>
    </header>
  );
}
