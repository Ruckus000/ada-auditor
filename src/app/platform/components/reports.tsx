'use client';

import { REPORT_DEFS } from '../lib/data';
import {
  AUDIENCES,
  criteriaFor,
  draftReport,
  findingsFor,
  fixesFor,
  paperKickerFor,
  reportPaper,
  reportSections,
  reportTitleFor,
  reportsForClient,
  sevSummary,
  shareLink,
  standardChips,
  type ClientView,
} from '../lib/derive';
import { usePlatform } from '../lib/state';
import { FONT, SHADOW, T } from '../lib/tokens';
import { Avatar, Eyebrow, RadioCard, ScreenHeading, SwitchRow } from './ui';

const COLUMNS = 'minmax(180px,2.4fr) minmax(62px,1fr) minmax(76px,1fr) minmax(96px,1.1fr) 128px';

const LINK_OPTIONS: Array<[string, boolean, string, string]> = [
  ['lk1', true, 'Anyone with the link can read it', 'No account needed. Good for forwarding to counsel.'],
  ['lk2', true, 'Hide dismissed findings', 'Dismissals and their reasons stay internal.'],
  ['lk3', false, 'Let them comment', 'The client can reply on any finding. Replies land in Activity.'],
  ['lk4', true, 'Expire on 30 August 2026', 'The link stops working; the report stays in your library.'],
];

export function ReportsLibraryScreen({ client }: { client: ClientView | null }) {
  const { state, actions } = usePlatform();
  const inClient = client !== null;
  const rows = inClient
    ? reportsForClient(client.name)
    : REPORT_DEFS.map((r, index) => ({ ...r, index }));

  const linkClientName = inClient ? client.name : 'Acme Outfitters';
  const linkRun = inClient ? client.run : 131;
  const link = shareLink(linkClientName, linkRun);

  return (
    <div
      data-screen-label="Reports library"
      style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
        <ScreenHeading
          level={inClient ? 2 : 1}
          title="Reports"
          lede={
            inClient
              ? `Reports issued for ${client.name}. Open one to edit it and re-issue. An ACR is the formal Accessibility Conformance Report.`
              : 'Everything issued to a client, and who still has access to it. An ACR is the formal Accessibility Conformance Report.'
          }
        />
        <button
          type="button"
          onClick={() =>
            inClient
              ? actions.patch({ modal: 'generate' })
              : actions.patch({ reportOpen: 0, audience: 'legal', dirty: false, draft: false })
          }
          className="ph-primary"
          style={{
            marginLeft: 'auto',
            padding: '8px 15px',
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
          {inClient ? 'Generate report' : 'New report'}
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) clamp(290px,25vw,380px)',
          gap: 18,
          alignItems: 'start',
        }}
      >
        {rows.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: 30,
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
                width: 40,
                height: 40,
                borderRadius: 11,
                background: T.paperDeep,
                color: T.inkMuted,
                fontSize: 17,
              }}
            >
              ◷
            </span>
            <span style={{ fontSize: 17, fontWeight: 700 }}>No reports issued yet</span>
            <span
              style={{
                fontSize: 13,
                color: T.inkSoft,
                maxWidth: 420,
                lineHeight: 1.55,
                textWrap: 'pretty',
              }}
            >
              {client?.reportState}
            </span>
            <button
              type="button"
              onClick={() => actions.patch({ modal: 'generate' })}
              className="ph-primary"
              style={{
                marginTop: 2,
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
              Generate the first one
            </button>
          </div>
        ) : (
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
                gridTemplateColumns: COLUMNS,
                gap: 'clamp(8px,0.8vw,12px)',
                padding: '11px 18px',
                borderBottom: `1px solid ${T.rule}`,
                background: T.paperDeep,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.07em',
                color: T.inkMuted,
              }}
            >
              <span>REPORT</span>
              <span>TYPE</span>
              <span>ISSUED</span>
              <span>ACCESS</span>
              <span />
            </div>
            {rows.map((report) => (
              <div
                key={report.title}
                className="ph-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: COLUMNS,
                  gap: 'clamp(8px,0.8vw,12px)',
                  alignItems: 'center',
                  padding: '14px 18px',
                  borderBottom: `1px solid ${T.ruleFaint}`,
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 650 }}>{report.title}</span>
                  <span style={{ fontSize: 11.5, color: T.inkMuted }}>{report.sub}</span>
                </span>
                <span>
                  <span
                    style={{
                      display: 'inline-flex',
                      padding: '3px 9px',
                      borderRadius: 7,
                      background: T.paperDeep,
                      color: T.inkSoft,
                      fontSize: 11,
                      fontWeight: 650,
                    }}
                  >
                    {report.type}
                  </span>
                </span>
                <span style={{ fontSize: 12.5, color: T.inkMuted }}>{report.issued}</span>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    color: report.accessColor,
                    fontWeight: 600,
                  }}
                >
                  {report.access}
                </span>
                <span style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                  <button
                    type="button"
                    title="Preview the client link"
                    onClick={() =>
                      // The share preview is a route of its own now, on its way
                      // to `/r/[token]`. Disabled until that route exists
                      // rather than left pointing at a screen the router can no
                      // longer reach.
                      actions.flash('The client link preview arrives with share tokens.')
                    }
                    className="ph-ghost-info"
                    style={{
                      padding: '5px 10px',
                      border: `1px solid ${T.ruleStrong}`,
                      borderRadius: 7,
                      background: T.surface,
                      color: T.inkMuted,
                      fontFamily: FONT.sans,
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Link
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      actions.patch({
                        reportOpen: report.index,
                        audience: report.aud,
                        dirty: false,
                        draft: false,
                      })
                    }
                    className="ph-ghost"
                    style={{
                      padding: '5px 13px',
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
                    Open
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            padding: 18,
            border: `1px solid ${T.rule}`,
            borderRadius: 12,
            background: T.surface,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 700 }}>
              Client link · {linkClientName}
            </h2>
            {!link.live ? (
              <span
                style={{
                  marginLeft: 'auto',
                  display: 'inline-flex',
                  padding: '3px 9px',
                  borderRadius: 7,
                  background: T.paperDeep,
                  border: `1px solid ${T.rule}`,
                  color: T.inkMuted,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                }}
              >
                {link.deadLabel}
              </span>
            ) : null}
          </span>
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 11px',
              border: `1px solid ${T.rule}`,
              borderRadius: 9,
              background: T.surfaceSunk,
              fontFamily: FONT.mono,
              fontSize: 11.5,
              color: link.urlColor,
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textDecoration: link.urlDecoration,
              }}
            >
              {link.url}
            </span>
            {link.live ? (
              <button
                type="button"
                onClick={() => actions.flash('Client link copied to the clipboard.')}
                style={{
                  marginLeft: 'auto',
                  padding: '4px 9px',
                  border: `1px solid ${T.ruleStrong}`,
                  borderRadius: 6,
                  background: T.surface,
                  fontFamily: FONT.sans,
                  fontSize: 11,
                  fontWeight: 650,
                  cursor: 'pointer',
                  color: T.accent,
                }}
              >
                Copy
              </button>
            ) : null}
          </span>
          <span
            style={{ fontSize: 11.5, color: T.inkMuted, lineHeight: 1.45, textWrap: 'pretty' }}
          >
            {link.note}
          </span>
          {link.live ? (
            <button
              type="button"
              onClick={() =>
                actions.flash('Link revoked. Anyone opening it now sees an expiry notice.')
              }
              className="ph-ghost-wash"
              style={{
                alignSelf: 'flex-start',
                padding: '6px 12px',
                border: `1px solid ${T.failEdge}`,
                borderRadius: 8,
                background: T.surface,
                color: T.fail,
                fontFamily: FONT.sans,
                fontSize: 11.5,
                fontWeight: 650,
                cursor: 'pointer',
              }}
            >
              Revoke this link
            </button>
          ) : null}
          <span style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {LINK_OPTIONS.map(([key, fallback, label, note]) => {
              const t = actions.toggle(key, fallback);
              return (
                <SwitchRow key={key} on={t.on} label={label} note={note} onFlip={t.flip} />
              );
            })}
          </span>
          {link.viewers.length > 0 ? (
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                paddingTop: 14,
                borderTop: `1px solid ${T.ruleFaint}`,
              }}
            >
              <Eyebrow>WHO HAS OPENED IT</Eyebrow>
              {link.viewers.map((viewer) => (
                <span
                  key={viewer.name}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5 }}
                >
                  <Avatar initials={viewer.initials} bg={T.paperDeep} color={T.inkSoft} />
                  <span>{viewer.name}</span>
                  <span style={{ marginLeft: 'auto', color: T.inkMuted, fontSize: 11.5 }}>
                    {viewer.when}
                  </span>
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ReportBuilderScreen({ client }: { client: ClientView }) {
  const { state, actions } = usePlatform();
  const records = findingsFor(client.name, state.findOverrides);
  const paper =
    state.draft && state.reportOpen !== null
      ? draftReport(client, records)
      : reportPaper(state.reportOpen ?? 0);
  const aud = state.audience;
  const sections = reportSections(aud);
  // Inside a client the sticky bar already owns the page's h1.
  const Title = state.scope === 'client' ? 'h2' : 'h1';

  return (
    <div
      data-screen-label="Report builder"
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => actions.patch({ reportOpen: null, dirty: false, draft: false })}
          className="ph-ghost"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '7px 13px',
            border: `1px solid ${T.ruleStrong}`,
            borderRadius: 8,
            background: T.surface,
            color: T.inkSoft,
            fontFamily: FONT.sans,
            fontSize: 12.5,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          ← All reports
        </button>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Title style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {paper.title}
          </Title>
          <span style={{ fontSize: 12.5, color: T.inkMuted }}>
            {paper.sub}
            {state.draft ? '' : ` · issued ${paper.issued}`}
          </span>
        </span>
        {state.dirty ? (
          <span
            style={{
              marginLeft: 'auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              borderRadius: 8,
              background: T.cautionWash,
              border: `1px solid ${T.cautionEdge}`,
              fontSize: 12,
              fontWeight: 650,
              color: T.caution,
            }}
          >
            Unsaved changes — re-issue to update the client link
          </span>
        ) : null}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'clamp(280px,24vw,360px) minmax(0,1fr)',
          gap: 20,
          alignItems: 'start',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            padding: 18,
            border: `1px solid ${T.rule}`,
            borderRadius: 12,
            background: T.surface,
            position: 'sticky',
            top: 78,
          }}
        >
          <span
            role="radiogroup"
            aria-label="Who is reading it"
            style={{ display: 'flex', flexDirection: 'column', gap: 9 }}
          >
            <Eyebrow>WHO IS READING IT</Eyebrow>
            {AUDIENCES.map(([key, label, note]) => (
              <RadioCard
                key={key}
                on={aud === key}
                label={label}
                note={note}
                onPick={() => actions.patch({ audience: key, dirty: true })}
              />
            ))}
          </span>

          <span style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <Eyebrow>
              WHAT GOES IN{' '}
              <span style={{ fontWeight: 500, letterSpacing: 0, textTransform: 'none' }}>
                · set by the audience
              </span>
            </Eyebrow>
            {sections.map((section) => (
              <span
                key={section.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 12.5,
                  color: T.inkSoft,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 17,
                    height: 17,
                    borderRadius: 5,
                    background: section.boxBg,
                    border: `1px solid ${section.boxBorder}`,
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {section.tick}
                </span>
                {section.label}
                {section.locked ? (
                  <span style={{ marginLeft: 'auto', fontSize: 10.5, color: T.inkMuted }}>
                    required
                  </span>
                ) : null}
              </span>
            ))}
          </span>

          <span style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <Eyebrow>STANDARD</Eyebrow>
            <span style={{ display: 'flex', gap: 6 }}>
              {standardChips(paper).map((sd) => (
                <span
                  key={sd.label}
                  title="Set by the client’s contracted standard, in Settings"
                  style={{
                    flex: 1,
                    padding: 7,
                    border: `1px solid ${sd.border}`,
                    borderRadius: 8,
                    background: sd.bg,
                    color: sd.color,
                    fontSize: 12,
                    fontWeight: sd.weight,
                    textAlign: 'center',
                  }}
                >
                  {sd.label}
                </span>
              ))}
            </span>
          </span>

          <span
            style={{
              display: 'flex',
              gap: 8,
              paddingTop: 14,
              borderTop: `1px solid ${T.ruleFaint}`,
            }}
          >
            <button
              type="button"
              onClick={() =>
                actions.flash('PDF downloading. The wording is frozen against this run.')
              }
              className="ph-ghost"
              style={{
                flex: 1,
                padding: 10,
                border: `1px solid ${T.ruleStrong}`,
                borderRadius: 9,
                background: T.surface,
                color: T.inkSoft,
                fontFamily: FONT.sans,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Download PDF
            </button>
            <button
              type="button"
              onClick={() => {
                actions.patch({ dirty: false });
                actions.flash('Re-issued. The client link now shows this version.');
              }}
              className="ph-primary"
              style={{
                flex: 1,
                padding: 10,
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
              Re-issue
            </button>
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 11.5, color: T.inkMuted }}>
            Preview · page {paper.preview} · updates as you change the settings
          </span>
          <div
            style={{
              padding: 'clamp(28px,3.4vw,52px) clamp(30px,3.6vw,56px)',
              border: `1px solid ${T.rule}`,
              borderRadius: 4,
              background: '#fff',
              boxShadow: SHADOW.paper,
              display: 'flex',
              flexDirection: 'column',
              gap: 26,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 14,
                paddingBottom: 20,
                borderBottom: `2px solid ${T.ink}`,
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.14em',
                    color: T.inkMuted,
                  }}
                >
                  {paperKickerFor(aud)}
                </span>
                <span style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-0.02em' }}>
                  {reportTitleFor(aud, paper)}
                </span>
                <span style={{ fontSize: 13, color: T.inkMuted }}>
                  Prepared by Meridian Access · {paper.issued} · {paper.standard}
                </span>
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '6px 14px',
                  borderRadius: 999,
                  background: paper.verdictBg,
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  whiteSpace: 'nowrap',
                }}
              >
                {paper.verdict}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>1 · Where this site stands</span>
              <span
                style={{
                  fontSize: 13.5,
                  lineHeight: 1.62,
                  color: T.inkSoft,
                  textWrap: 'pretty',
                }}
              >
                {paper.para1}
              </span>
              <span
                style={{
                  fontSize: 13.5,
                  lineHeight: 1.62,
                  color: T.inkSoft,
                  textWrap: 'pretty',
                }}
              >
                {paper.para2}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>2 · Findings by severity</span>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))',
                  gap: 10,
                }}
              >
                {sevSummary(paper.sev).map((sv) => (
                  <span
                    key={sv.label}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                      padding: 12,
                      border: '1px solid #e6e2d8',
                      borderRadius: 6,
                    }}
                  >
                    <span
                      style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: sv.color }}
                    >
                      {sv.n}
                    </span>
                    <span style={{ fontSize: 11.5, fontWeight: 650, color: T.inkSoft }}>
                      {sv.label}
                    </span>
                    <span style={{ fontSize: 10.5, color: T.inkMuted, lineHeight: 1.35 }}>
                      {sv.note}
                    </span>
                  </span>
                ))}
              </div>
            </div>

            {aud !== 'exec' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>3 · Success criteria</span>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    border: '1px solid #e6e2d8',
                    borderRadius: 6,
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '90px 1fr 130px',
                      gap: 10,
                      padding: '8px 12px',
                      background: T.paper,
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      color: T.inkMuted,
                    }}
                  >
                    <span>CRITERION</span>
                    <span>NAME</span>
                    <span>CONFORMANCE</span>
                  </span>
                  {criteriaFor(paper.crit).map((cr) => (
                    <span
                      key={cr.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '90px 1fr 130px',
                        gap: 10,
                        padding: '9px 12px',
                        borderTop: '1px solid #eeebe3',
                        fontSize: 12.5,
                        color: T.inkSoft,
                      }}
                    >
                      <span style={{ fontFamily: FONT.mono, fontSize: 11.5 }}>{cr.id}</span>
                      <span>{cr.name}</span>
                      <span style={{ fontWeight: 650, color: cr.color }}>{cr.status}</span>
                    </span>
                  ))}
                </div>
                <span style={{ fontSize: 11.5, color: T.inkMuted }}>
                  Plain-language notes for each criterion continue on {paper.notesPages}.
                </span>
              </div>
            ) : null}

            {aud === 'dev' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>4 · Fixes by file</span>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    border: '1px solid #e6e2d8',
                    borderRadius: 6,
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.4fr 1.3fr 90px',
                      gap: 10,
                      padding: '8px 12px',
                      background: T.paper,
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      color: T.inkMuted,
                    }}
                  >
                    <span>FINDING</span>
                    <span>FILE THAT OWNS IT</span>
                    <span>AFFECTS</span>
                  </span>
                  {fixesFor(paper.crit).map((fx) => (
                    <span
                      key={fx.what}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1.4fr 1.3fr 90px',
                        gap: 10,
                        padding: '9px 12px',
                        borderTop: '1px solid #eeebe3',
                        fontSize: 12.5,
                        color: T.inkSoft,
                      }}
                    >
                      <span>{fx.what}</span>
                      <span style={{ fontFamily: FONT.mono, fontSize: 11 }}>{fx.file}</span>
                      <span style={{ color: T.inkMuted }}>{fx.scope}</span>
                    </span>
                  ))}
                </div>
                <span style={{ fontSize: 11.5, color: T.inkMuted }}>
                  Each finding’s before-and-after markup follows on the next pages.
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
