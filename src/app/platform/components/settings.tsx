'use client';

import { INTEGRATIONS, PEOPLE } from '../lib/data';
import {
  CREDENTIAL_SKIN,
  clientExtra,
  configFor,
  type ClientView,
} from '../lib/derive';
import { usePlatform, type SettingsTab } from '../lib/state';
import { FONT, T } from '../lib/tokens';
import { Avatar, ReadOnlyField, SectionHeading, Switch, SwitchRow } from './ui';

const WORKSPACE_NAV: Array<[SettingsTab, string]> = [
  ['people', 'People and roles'],
  ['tools', 'Connected tools'],
  ['reportDefaults', 'Report defaults'],
  ['display', 'Display'],
];

const CLIENT_NAV: Array<[SettingsTab, string]> = [
  ['scanning', 'Scanning'],
  ['standard', 'Standard'],
  ['schedule', 'Schedule'],
];

const LEVELS: Array<[string, string, boolean]> = [
  ['WCAG 2.2 AA', 'The contractual standard for this client.', true],
  ['WCAG 2.2 AAA', 'Extra checks, reported separately.', false],
  ['Section 508', 'Required for public-sector clients.', false],
];

const THRESHOLDS = [
  {
    label: 'MUST FIX',
    rule: 'Blocks a journey step, or fails a Level A criterion.',
    chipBg: '#96231c',
    chipColor: '#fff',
    chipBorder: '#96231c',
  },
  {
    label: 'SHOULD FIX',
    rule: 'Makes a task slow or confusing, or fails a Level AA criterion.',
    chipBg: '#fdf3e2',
    chipColor: '#7a4e0a',
    chipBorder: '#dfba79',
  },
  {
    label: 'NICE TO FIX',
    rule: 'Below best practice but nobody is blocked or slowed.',
    chipBg: '#f3efe6',
    chipColor: '#55636b',
    chipBorder: '#ddd6c8',
  },
];

const NOTIFY: Array<[string, boolean, string]> = [
  ['nt1', true, 'A new must-fix appears'],
  ['nt2', true, 'A fixed finding comes back'],
  ['nt3', false, 'Every run finishes, pass or fail'],
  ['nt4', true, 'A run fails or pages are skipped'],
];

const REPORT_DEFAULTS: Array<[string, boolean, string, string]> = [
  ['rd1', true, 'Print the untested-pages disclosure on the cover', 'Anything we could not reach is named, not silently excluded.'],
  ['rd2', true, 'Keep AI suggestions out of client reports', 'They only appear once an auditor has confirmed them.'],
  ['rd3', false, 'Include dismissed findings in an appendix', 'Off by default — dismissal reasons are internal.'],
];

const ZOOM_OPTIONS: Array<[string, number]> = [
  ['Compact', 1],
  ['Comfortable', 1.15],
  ['Large', 1.3],
  ['Largest', 1.5],
];

const panel = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 14,
  padding: 20,
  border: `1px solid ${T.rule}`,
  borderRadius: 12,
  background: T.surface,
};

export function SettingsScreen({ client }: { client: ClientView | null }) {
  const { state, actions } = usePlatform();
  const inClient = client !== null;
  const nav = inClient ? CLIENT_NAV : WORKSPACE_NAV;
  const tab = state.settingsTab;

  return (
    <div data-screen-label="Settings" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>
          {inClient ? `Settings · ${client.name}` : 'Workspace settings · Meridian Access'}
        </h1>
        <span style={{ fontSize: 13, color: T.inkMuted }}>
          {inClient
            ? 'Applies to every future run of this client. Past runs keep the settings they were run with.'
            : 'Applies to everyone in this workspace and to every client account.'}
        </span>
      </span>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'clamp(168px,15vw,210px) minmax(0,1fr)',
          gap: 20,
          alignItems: 'start',
        }}
      >
        <nav
          aria-label="Settings sections"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            position: 'sticky',
            top: 78,
          }}
        >
          {nav.map(([key, label]) => {
            const on = tab === key;
            const badge = inClient && key === 'schedule' && client.hasSkipped;
            return (
              <button
                key={key}
                type="button"
                onClick={() => actions.patch({ settingsTab: key })}
                aria-current={on ? 'true' : undefined}
                className="ph-menu-item"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '9px 12px',
                  border: 'none',
                  borderRadius: 8,
                  textAlign: 'left',
                  fontFamily: FONT.sans,
                  fontSize: 13,
                  cursor: 'pointer',
                  background: on ? T.accentWash : 'transparent',
                  color: on ? T.accentInk : T.inkMuted,
                  fontWeight: on ? 650 : 400,
                }}
              >
                {label}
                {badge ? (
                  <span
                    style={{
                      marginLeft: 'auto',
                      display: 'inline-flex',
                      padding: '2px 7px',
                      borderRadius: 6,
                      background: T.cautionWashDeep,
                      border: `1px solid ${T.cautionEdge}`,
                      color: T.caution,
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    ACTION
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {inClient && tab === 'scanning' ? <ScanningPanel client={client} /> : null}
          {inClient && tab === 'standard' ? <StandardPanel /> : null}
          {inClient && tab === 'schedule' ? <SchedulePanel client={client} /> : null}
          {!inClient && tab === 'people' ? <PeoplePanel /> : null}
          {!inClient && tab === 'tools' ? <ToolsPanel /> : null}
          {!inClient && tab === 'reportDefaults' ? <ReportDefaultsPanel /> : null}
          {!inClient && tab === 'display' ? <DisplayPanel /> : null}
        </div>
      </div>
    </div>
  );
}

function ScanningPanel({ client }: { client: ClientView }) {
  const { state, actions } = usePlatform();
  const cfg = configFor(client.name);
  const removed = state.removedPaths[client.name] ?? [];
  const skipPaths = cfg[1].filter((p) => !removed.includes(p));
  const backend = actions.toggle('backend', true);

  return (
    <div style={{ ...panel, gap: 16 }}>
      <SectionHeading size={15}>What we crawl</SectionHeading>
      <ReadOnlyField label="Starting URL" value={cfg[0]} mono />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(158px,1fr))',
          gap: 14,
        }}
      >
        <ReadOnlyField label="Page limit" value="250 pages" />
        <ReadOnlyField label="Crawl depth" value="4 levels" />
        <ReadOnlyField label="Viewports tested" value="Desktop + mobile" />
      </div>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: T.inkSoft }}>Skip these paths</span>
        <span
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            padding: 9,
            border: `1px solid ${T.ruleStrong}`,
            borderRadius: 9,
            background: T.surface,
          }}
        >
          {skipPaths.map((path) => (
            <span
              key={path}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 9px',
                borderRadius: 7,
                background: T.paperDeep,
                fontFamily: FONT.mono,
                fontSize: 11.5,
                color: T.inkSoft,
              }}
            >
              {path}
              <button
                type="button"
                aria-label={`Stop skipping ${path}`}
                onClick={() => {
                  actions.patch({
                    removedPaths: {
                      ...state.removedPaths,
                      [client.name]: [...removed, path],
                    },
                  });
                  actions.flash(`${path} will be crawled from the next run.`);
                }}
                style={{
                  border: 'none',
                  background: 'none',
                  padding: 0,
                  color: T.inkMuted,
                  fontSize: 11,
                  cursor: 'pointer',
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() =>
              actions.flash('Type a path pattern such as /blog/* — it takes effect on the next run.')
            }
            style={{
              padding: '4px 9px',
              border: `1px dashed ${T.ruleStrong}`,
              borderRadius: 7,
              background: 'none',
              fontFamily: FONT.sans,
              fontSize: 11.5,
              color: T.inkMuted,
              cursor: 'pointer',
            }}
          >
            + add a pattern
          </button>
        </span>
      </span>
      <span
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 11,
          padding: 13,
          borderRadius: 10,
          background: T.surfaceSunk,
          border: `1px solid ${T.ruleFaint}`,
        }}
      >
        <Switch
          on={backend.on}
          onFlip={backend.flip}
          label="Test the server response as well as the page"
          style={{ marginTop: 1 }}
        />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 12.5, fontWeight: 650 }}>
            Test the server response as well as the page
          </span>
          <span
            style={{ fontSize: 11.5, color: T.inkSoft, lineHeight: 1.45, textWrap: 'pretty' }}
          >
            Adds backend findings — missing language attributes, untagged PDFs, status codes — as
            square markers in the ledger.
          </span>
        </span>
      </span>
    </div>
  );
}

function StandardPanel() {
  const { actions } = usePlatform();
  const ai = actions.toggle('ai', true);

  return (
    <div style={panel}>
      <SectionHeading size={15}>Standard and strictness</SectionHeading>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
          gap: 10,
        }}
      >
        {LEVELS.map(([label, note, on]) => (
          <span
            key={label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: 13,
              border: `1.5px solid ${on ? T.accent : T.rule}`,
              borderRadius: 10,
              background: on ? T.accentWashDeep : T.surface,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 650 }}>{label}</span>
            <span
              style={{ fontSize: 11.5, color: T.inkMuted, lineHeight: 1.4, textWrap: 'pretty' }}
            >
              {note}
            </span>
          </span>
        ))}
      </div>
      <span
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 11,
          padding: 13,
          borderRadius: 10,
          background: T.infoWash,
          border: `1px solid ${T.infoEdge}`,
        }}
      >
        <Switch
          on={ai.on}
          onFlip={ai.flip}
          label="Include AI suggestions"
          accent={T.info}
          style={{ marginTop: 1 }}
        />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 12.5, fontWeight: 650, color: T.info }}>
            Include AI suggestions
          </span>
          <span
            style={{ fontSize: 11.5, color: T.inkSoft, lineHeight: 1.45, textWrap: 'pretty' }}
          >
            Findings a rule cannot prove. They never count against the score and never appear in a
            legal report until a human confirms them.
          </span>
        </span>
      </span>
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
          paddingTop: 14,
          borderTop: `1px solid ${T.ruleFaint}`,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 650 }}>Severity thresholds</span>
        {THRESHOLDS.map((th) => (
          <span
            key={th.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '11px 13px',
              border: `1px solid ${T.ruleFaint}`,
              borderRadius: 10,
              background: T.surfaceSunk,
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                padding: '3px 10px',
                borderRadius: 999,
                background: th.chipBg,
                color: th.chipColor,
                border: `1px solid ${th.chipBorder}`,
                fontSize: 11,
                fontWeight: 700,
                whiteSpace: 'nowrap',
              }}
            >
              {th.label}
            </span>
            <span style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.4, textWrap: 'pretty' }}>
              {th.rule}
            </span>
            <button
              type="button"
              onClick={() => actions.flash('Threshold rules apply from the next run onward.')}
              style={{
                marginLeft: 'auto',
                padding: 0,
                border: 'none',
                background: 'none',
                fontFamily: FONT.sans,
                fontSize: 11.5,
                fontWeight: 650,
                color: T.accent,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Edit
            </button>
          </span>
        ))}
      </span>
    </div>
  );
}

function SchedulePanel({ client }: { client: ClientView }) {
  const { actions } = usePlatform();
  const cfg = configFor(client.name);
  const ex = clientExtra(client.name);
  const cred = CREDENTIAL_SKIN(cfg[5], ex.skipped, ex.run);

  return (
    <div style={panel}>
      <SectionHeading size={15}>Schedule</SectionHeading>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))',
          gap: 14,
        }}
      >
        <ReadOnlyField label="Run" value={cfg[2]} />
        <ReadOnlyField label="Also run on" value={cfg[3]} />
      </div>
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
          paddingTop: 14,
          borderTop: `1px solid ${T.ruleFaint}`,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 650 }}>Sign-in for gated pages</span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '11px 13px',
            border: `1px solid ${cred.border}`,
            borderRadius: 10,
            background: cred.bg,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontFamily: FONT.mono, fontSize: 12, color: T.inkSoft }}>{cfg[4]}</span>
          <span style={{ fontSize: 11.5, fontWeight: 650, color: cred.color }}>{cred.text}</span>
          <button
            type="button"
            onClick={() => actions.flash('Add the test account under Settings → Schedule.')}
            style={{
              marginLeft: 'auto',
              padding: '6px 13px',
              border: `1px solid ${cred.border}`,
              borderRadius: 7,
              background: T.surface,
              color: cred.color,
              fontFamily: FONT.sans,
              fontSize: 11.5,
              fontWeight: 650,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {cred.button}
          </button>
        </span>
        <span style={{ fontSize: 11.5, color: T.inkMuted, textWrap: 'pretty' }}>
          Pages we cannot sign into are excluded from the score rather than counted as passing, and
          the exclusion is printed on every report.
        </span>
      </span>
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
          paddingTop: 14,
          borderTop: `1px solid ${T.ruleFaint}`,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 650 }}>Tell people when</span>
        {NOTIFY.map(([key, fallback, label]) => {
          const t = actions.toggle(key, fallback);
          return (
            <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <Switch on={t.on} onFlip={t.flip} label={label} />
              <span style={{ fontSize: 12.5, color: T.inkSoft }}>{label}</span>
            </span>
          );
        })}
      </span>
    </div>
  );
}

function PeoplePanel() {
  const { actions } = usePlatform();
  const columns = 'minmax(160px,1.6fr) minmax(104px,1.1fr) minmax(170px,2fr) 66px';

  return (
    <div style={panel}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <SectionHeading size={15}>People on this account</SectionHeading>
        <button
          type="button"
          onClick={() => actions.patch({ modal: 'invite' })}
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
          }}
        >
          Invite someone
        </button>
      </span>
      <div style={{ border: `1px solid ${T.ruleFaint}`, borderRadius: 10, overflowX: 'auto' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: columns,
            gap: 'clamp(8px,0.8vw,12px)',
            padding: '10px 14px',
            background: T.paperDeep,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.07em',
            color: T.inkMuted,
          }}
        >
          <span>PERSON</span>
          <span>ROLE</span>
          <span>WHAT THEY SEE</span>
          <span />
        </div>
        {PEOPLE.map(([initials, name, email, role, sees]) => {
          const isClient = role.startsWith('Client');
          return (
            <div
              key={email}
              style={{
                display: 'grid',
                gridTemplateColumns: columns,
                gap: 'clamp(8px,0.8vw,12px)',
                alignItems: 'center',
                padding: '12px 14px',
                borderTop: `1px solid ${T.ruleFaint}`,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                <Avatar
                  initials={initials}
                  size={26}
                  fontSize={10}
                  bg={initials === 'SYS' ? T.infoWash : T.accentWash}
                  color={initials === 'SYS' ? T.info : T.accentInk}
                />
                <span
                  style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 650 }}>{name}</span>
                  <span
                    style={{
                      fontSize: 11,
                      color: T.inkMuted,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {email}
                  </span>
                </span>
              </span>
              <span>
                <span
                  style={{
                    display: 'inline-flex',
                    padding: '3px 10px',
                    borderRadius: 7,
                    background: isClient ? T.infoWash : T.accentWash,
                    color: isClient ? T.info : T.accentInk,
                    border: `1px solid ${isClient ? T.infoEdge : T.accentEdge}`,
                    fontSize: 11,
                    fontWeight: 650,
                  }}
                >
                  {role}
                </span>
              </span>
              <span
                style={{
                  fontSize: 11.5,
                  color: T.inkMuted,
                  lineHeight: 1.4,
                  textWrap: 'pretty',
                }}
              >
                {sees}
              </span>
              <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() =>
                    actions.flash('Role changes take effect the next time that person signs in.')
                  }
                  style={{
                    padding: 0,
                    border: 'none',
                    background: 'none',
                    fontFamily: FONT.sans,
                    fontSize: 11.5,
                    fontWeight: 650,
                    color: T.accent,
                    cursor: 'pointer',
                  }}
                >
                  Change
                </button>
              </span>
            </div>
          );
        })}
      </div>
      <span style={{ fontSize: 11.5, color: T.inkMuted, textWrap: 'pretty' }}>
        Client roles never see dismissal reasons or internal notes. Only an auditor can change a
        verdict.
      </span>
    </div>
  );
}

function ToolsPanel() {
  const { actions } = usePlatform();
  return (
    <div style={{ ...panel, gap: 12 }}>
      <SectionHeading size={15}>Connected tools</SectionHeading>
      {INTEGRATIONS.map(([name, mark, iconBg, iconColor, note, btn, btnBorder, btnColor]) => (
        <span
          key={name}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: 12,
            border: `1px solid ${T.ruleFaint}`,
            borderRadius: 10,
            background: T.surfaceSunk,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 30,
              height: 30,
              borderRadius: 8,
              background: iconBg,
              color: iconColor,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {mark}
          </span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 13, fontWeight: 650 }}>{name}</span>
            <span style={{ fontSize: 11.5, color: T.inkMuted }}>{note}</span>
          </span>
          <button
            type="button"
            onClick={() =>
              actions.flash('Connecting opens that tool’s own authorisation page.')
            }
            style={{
              marginLeft: 'auto',
              padding: '5px 12px',
              border: `1px solid ${btnBorder}`,
              borderRadius: 7,
              background: T.surface,
              color: btnColor,
              fontFamily: FONT.sans,
              fontSize: 11.5,
              fontWeight: 650,
              cursor: 'pointer',
            }}
          >
            {btn}
          </button>
        </span>
      ))}
    </div>
  );
}

function ReportDefaultsPanel() {
  const { actions } = usePlatform();
  return (
    <div style={{ ...panel, gap: 16 }}>
      <SectionHeading size={15}>Report defaults</SectionHeading>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))',
          gap: 14,
        }}
      >
        <ReadOnlyField label="Default audience" value="Compliance and legal" />
        <ReadOnlyField label="Client link expires after" value="30 days" />
      </div>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: T.inkSoft }}>
          Evaluator statement printed on every ACR
        </span>
        <span
          style={{
            padding: '12px 13px',
            border: `1px solid ${T.ruleStrong}`,
            borderRadius: 9,
            background: T.surfaceSunk,
            fontSize: 12.5,
            lineHeight: 1.55,
            color: T.inkSoft,
            textWrap: 'pretty',
          }}
        >
          Testing was performed by Meridian Access using automated checks and manual review with
          NVDA, VoiceOver and keyboard-only navigation. Automated checks alone detect roughly 40% of
          accessibility barriers.
        </span>
      </span>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))',
          gap: 14,
        }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: T.inkSoft }}>Cover logo</span>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 13px',
              border: `1px dashed ${T.ruleStrong}`,
              borderRadius: 9,
              background: T.surface,
              fontSize: 12.5,
              color: T.inkMuted,
            }}
          >
            meridian-mark.svg
            <button
              type="button"
              onClick={() => actions.flash('Upload a replacement mark for the report cover.')}
              style={{
                marginLeft: 'auto',
                border: 'none',
                background: 'none',
                padding: 0,
                color: T.accent,
                fontFamily: FONT.sans,
                fontSize: 12.5,
                fontWeight: 650,
                cursor: 'pointer',
              }}
            >
              Replace
            </button>
          </span>
        </span>
        <ReadOnlyField label="Signed off by" value="Jules Reyes, Lead Auditor" />
      </div>
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 9,
          paddingTop: 14,
          borderTop: `1px solid ${T.ruleFaint}`,
        }}
      >
        {REPORT_DEFAULTS.map(([key, fallback, label, note]) => {
          const t = actions.toggle(key, fallback);
          return <SwitchRow key={key} on={t.on} label={label} note={note} onFlip={t.flip} />;
        })}
      </span>
    </div>
  );
}

function DisplayPanel() {
  const { state, actions } = usePlatform();
  return (
    <div style={{ ...panel, gap: 16 }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <SectionHeading size={15}>Interface size</SectionHeading>
        <span
          style={{ fontSize: 12.5, color: T.inkMuted, lineHeight: 1.5, textWrap: 'pretty' }}
        >
          Scales the whole tool, including the ledger overlay. Auditors read findings all day — pick
          the size you can work in, not the one that fits the most rows.
        </span>
      </span>
      <div
        role="radiogroup"
        aria-label="Interface size"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(148px,1fr))',
          gap: 10,
        }}
      >
        {ZOOM_OPTIONS.map(([label, value]) => {
          const on = Math.abs(state.zoom - value) < 0.001;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => actions.patch({ zoom: value })}
              className="ph-accent-hover"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: 13,
                border: `1.5px solid ${on ? T.accent : T.rule}`,
                borderRadius: 10,
                background: on ? T.accentWashDeep : T.surface,
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: FONT.sans,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 15,
                    height: 15,
                    borderRadius: '50%',
                    border: `1.5px solid ${on ? T.accent : T.ruleStrong}`,
                    background: on ? T.accent : T.surface,
                    flexShrink: 0,
                    boxShadow: on ? `inset 0 0 0 2.5px ${T.surface}` : 'none',
                  }}
                />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: on ? 650 : 500,
                    color: on ? T.accent : T.inkSoft,
                  }}
                >
                  {label}
                </span>
              </span>
              <span style={{ fontSize: 11.5, color: T.inkMuted }}>
                {Math.round(value * 100)}%
              </span>
            </button>
          );
        })}
      </div>
      <span
        style={{
          display: 'block',
          padding: '12px 14px',
          borderRadius: 10,
          background: T.surfaceSunk,
          border: `1px solid ${T.ruleFaint}`,
          fontSize: 12,
          lineHeight: 1.5,
          color: T.inkMuted,
          textWrap: 'pretty',
        }}
      >
        Currently {Math.round(state.zoom * 100)}%. This is a per-person preference — it does not
        change what anyone else sees, and it never changes a report.
      </span>
    </div>
  );
}
