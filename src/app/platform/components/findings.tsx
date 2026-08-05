'use client';

import {
  FIND_FILTERS,
  findingDetail,
  findingFilterCount,
  findingHistory,
  findingRows,
  findingSummary,
  findingsFor,
  type ClientView,
} from '../lib/derive';
import { usePlatform } from '../lib/state';
import { FONT, T } from '../lib/tokens';
import { Avatar, ChevronRight, DropMenu, FilterChip, SectionHeading } from './ui';

const COLUMNS =
  '100px minmax(190px,2.4fr) minmax(66px,1fr) minmax(80px,0.8fr) minmax(58px,0.9fr) minmax(62px,0.8fr) 30px';

export function FindingsListScreen({ client }: { client: ClientView }) {
  const { state, actions } = usePlatform();
  const records = findingsFor(client.name, state.findOverrides);
  const rows = findingRows(records, state.findFilter);

  return (
    <div
      data-screen-label="Client findings list"
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>
          Findings
        </h1>
        <span style={{ fontSize: 12.5, color: T.inkMuted }}>
          {findingSummary(records, client.run)}
        </span>
        <button
          type="button"
          onClick={() => actions.flash('Opening these findings in the annotated ledger.')}
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
          Open in the ledger ↗
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '10px 14px',
          border: `1px solid ${T.rule}`,
          borderRadius: 11,
          background: T.surface,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FIND_FILTERS.map(([key, label]) => (
            <FilterChip
              key={key}
              label={label}
              count={findingFilterCount(records, key)}
              active={state.findFilter === key}
              onPick={() => actions.patch({ findFilter: key })}
            />
          ))}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <DropMenu
            compact
            menu={{
              ...actions.menu('pages', 'All pages', [
                'All pages',
                'Checkout only',
                'Account pages',
                'Templates (back end)',
              ]),
              width: 194,
              top: 36,
            }}
          />
          <DropMenu
            compact
            menu={{
              ...actions.menu('status', 'Open only', [
                'Open only',
                'Assigned',
                'Retest due',
                'Everything including fixed',
              ]),
              width: 216,
              top: 36,
            }}
          />
        </span>
      </div>

      {records.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: 34,
            border: `1px solid ${T.accentEdge}`,
            borderRadius: 12,
            background: T.accentWashDeep,
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
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: T.accent,
              color: '#fff',
              fontSize: 19,
            }}
          >
            ✓
          </span>
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>
            Nothing left to fix
          </span>
          <span
            style={{
              fontSize: 13.5,
              color: T.inkSoft,
              maxWidth: 460,
              lineHeight: 1.55,
              textWrap: 'pretty',
            }}
          >
            {client.name} passes every check at {client.standard} in run #{client.run}. Automated
            checks catch about 40% of barriers, so a manual review is the honest next step before
            anyone relies on this publicly.
          </span>
          <span style={{ display: 'flex', gap: 8, marginTop: 2 }}>
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
      ) : rows.length === 0 ? (
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
          <span style={{ fontSize: 17, fontWeight: 700 }}>Nothing at this severity</span>
          <span
            style={{
              fontSize: 13,
              color: T.inkSoft,
              maxWidth: 400,
              lineHeight: 1.55,
              textWrap: 'pretty',
            }}
          >
            This client has findings, but none match the filter you picked.
          </span>
          <button
            type="button"
            onClick={() => actions.patch({ findFilter: 'all' })}
            className="ph-ghost"
            style={{
              marginTop: 2,
              padding: '8px 15px',
              border: `1px solid ${T.ruleStrong}`,
              borderRadius: 9,
              background: T.surface,
              color: T.inkSoft,
              fontFamily: FONT.sans,
              fontSize: 12.5,
              fontWeight: 650,
              cursor: 'pointer',
            }}
          >
            Show everything open
          </button>
        </div>
      ) : (
        <>
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
              <span>SEVERITY</span>
              <span>FINDING</span>
              <span>CRITERION</span>
              <span>WHERE</span>
              <span>PAGES</span>
              <span>STATUS</span>
              <span />
            </div>
            {rows.map((row) => (
              <button
                key={row.index}
                type="button"
                onClick={() => actions.patch({ clientTab: 'finding', findIndex: row.index })}
                aria-label={`${row.sev}: ${row.what}. WCAG ${row.wcag}, ${row.area}, ${row.pages}, ${row.status}.`}
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
                <span>
                  <span
                    style={{
                      display: 'inline-flex',
                      padding: '3px 9px',
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      background: row.sevBg,
                      color: row.sevColor,
                      border: `1px solid ${row.sevBorder}`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {row.sev}
                  </span>
                </span>
                <span
                  style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35, textWrap: 'pretty' }}
                >
                  {row.what}
                </span>
                <span style={{ fontFamily: FONT.mono, fontSize: 11, color: T.inkMuted }}>
                  {row.wcag}
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11.5,
                    color: T.inkSoft,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 9,
                      height: 9,
                      background: row.areaColor,
                      borderRadius: row.areaRadius,
                      flexShrink: 0,
                    }}
                  />
                  {row.area}
                </span>
                <span style={{ fontSize: 12, color: T.inkSoft }}>{row.pages}</span>
                <span style={{ fontSize: 11.5, fontWeight: 650, color: row.statusColor }}>
                  {row.status}
                </span>
                <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <ChevronRight />
                </span>
              </button>
            ))}
          </div>
          <span
            style={{
              display: 'flex',
              gap: 16,
              flexWrap: 'wrap',
              fontSize: 11.5,
              color: T.inkMuted,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span
                aria-hidden="true"
                style={{ width: 9, height: 9, borderRadius: '50%', background: T.info }}
              />
              Front end — found in the rendered page
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span
                aria-hidden="true"
                style={{ width: 9, height: 9, borderRadius: 2, background: T.caution }}
              />
              Back end — found in the server response
            </span>
          </span>
        </>
      )}
    </div>
  );
}

export function FindingDetailScreen({ client }: { client: ClientView }) {
  const { state, actions } = usePlatform();
  const records = findingsFor(client.name, state.findOverrides);
  const safeIndex = Math.min(state.findIndex, Math.max(0, records.length - 1));
  const finding = findingDetail(client.name, records, safeIndex, client.run);
  if (!finding) return null;
  const history = findingHistory(records[safeIndex], client.run, client.prevRun);

  return (
    <div
      data-screen-label="Finding detail"
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <span
        style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, color: T.inkMuted }}
      >
        <button
          type="button"
          onClick={() => actions.goClientTab('findings')}
          style={{
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
          ← Findings
        </button>
        <span>{finding.crumb}</span>
      </span>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr) clamp(260px,21vw,320px)',
          gap: 20,
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: 20,
              border: `1px solid ${T.rule}`,
              borderRadius: 12,
              background: T.surface,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span
                style={{
                  display: 'inline-flex',
                  padding: '4px 11px',
                  borderRadius: 999,
                  background: finding.sevBg,
                  color: finding.sevColor,
                  border: `1px solid ${finding.sevBorder}`,
                  fontSize: 11.5,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                }}
              >
                {finding.sev}
              </span>
              <span style={{ fontSize: 12, fontFamily: FONT.mono, color: T.inkMuted }}>
                {finding.wcagLabel}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  padding: '3px 10px',
                  borderRadius: 7,
                  background: T.paperDeep,
                  color: T.inkSoft,
                  fontSize: 11.5,
                  fontWeight: 650,
                }}
              >
                {finding.pagesChip}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 10px',
                  borderRadius: 7,
                  background: T.paperDeep,
                  color: T.inkSoft,
                  fontSize: 11.5,
                  fontWeight: 650,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 8,
                    height: 8,
                    background: finding.areaColor,
                    borderRadius: finding.areaRadius,
                  }}
                />
                {finding.area}
              </span>
            </span>
            <h1
              style={{
                margin: 0,
                fontSize: 26,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                lineHeight: 1.2,
                textWrap: 'pretty',
              }}
            >
              {finding.what}
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: 14.5,
                lineHeight: 1.6,
                color: T.inkSoft,
                textWrap: 'pretty',
              }}
            >
              {finding.plain}
            </p>
            {finding.hasBlocks ? (
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '11px 13px',
                  borderRadius: 9,
                  background: T.failWashDeep,
                  border: `1px solid ${T.failEdge}`,
                  fontSize: 12.5,
                  color: T.fail,
                  fontWeight: 650,
                  textWrap: 'pretty',
                }}
              >
                {finding.blocks}
              </span>
            ) : null}
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: 20,
              border: `1px solid ${T.rule}`,
              borderRadius: 12,
              background: T.surface,
            }}
          >
            <SectionHeading size={15}>How to fix it</SectionHeading>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))',
                gap: 12,
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.07em',
                    color: T.fail,
                  }}
                >
                  TODAY
                </span>
                <pre
                  style={{
                    margin: 0,
                    padding: 13,
                    border: `1px solid ${T.failEdge}`,
                    borderRadius: 9,
                    background: T.failWash,
                    fontFamily: FONT.mono,
                    fontSize: 12,
                    lineHeight: 1.65,
                    color: T.inkSoft,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {finding.bad}
                </pre>
              </span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.07em',
                    color: T.accent,
                  }}
                >
                  CHANGE IT TO
                </span>
                <pre
                  style={{
                    margin: 0,
                    padding: 13,
                    border: `1px solid ${T.accentEdge}`,
                    borderRadius: 9,
                    background: T.accentWashDeep,
                    fontFamily: FONT.mono,
                    fontSize: 12,
                    lineHeight: 1.65,
                    color: T.inkSoft,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {finding.good}
                </pre>
              </span>
            </div>
            <span
              style={{ fontSize: 12.5, color: T.inkMuted, lineHeight: 1.5, textWrap: 'pretty' }}
            >
              {finding.fileNote}
            </span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => actions.flash('Fix copied to the clipboard.')}
                className="ph-primary"
                style={{
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
                Copy the fix
              </button>
              <button
                type="button"
                onClick={() =>
                  actions.flash('Ticket opened on the ACME board and linked to this finding.')
                }
                className="ph-ghost"
                style={{
                  padding: '8px 15px',
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
                Send to Jira
              </button>
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: 20,
              border: `1px solid ${T.rule}`,
              borderRadius: 12,
              background: T.surface,
            }}
          >
            <SectionHeading size={15}>Where it appears</SectionHeading>
            {finding.where.map((spot) => (
              <button
                key={spot.path + spot.where}
                type="button"
                onClick={() =>
                  actions.flash('Opening this occurrence in the annotated ledger.')
                }
                aria-label={`View ${spot.path} (${spot.where}) in the ledger`}
                className="ph-card-hover"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  border: `1px solid ${T.ruleFaint}`,
                  borderRadius: 9,
                  background: T.surfaceSunk,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: FONT.sans,
                }}
              >
                <span style={{ fontFamily: FONT.mono, fontSize: 11.5, color: T.inkSoft }}>
                  {spot.path}
                </span>
                <span style={{ fontSize: 11.5, color: T.inkMuted }}>{spot.where}</span>
                <span
                  style={{
                    marginLeft: 'auto',
                    fontSize: 11.5,
                    fontWeight: 650,
                    color: T.accent,
                  }}
                >
                  View in ledger →
                </span>
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            position: 'sticky',
            top: 78,
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 11,
              padding: 16,
              border: `1px solid ${T.rule}`,
              borderRadius: 12,
              background: T.surface,
            }}
          >
            <button
              type="button"
              onClick={() => {
                actions.setFindingStatus(safeIndex, 'Retest due');
                actions.flash('Marked fixed. It stays open until the next run confirms it.');
              }}
              className="ph-primary"
              style={{
                padding: 11,
                border: 'none',
                borderRadius: 9,
                background: T.accent,
                color: '#fff',
                fontFamily: FONT.sans,
                fontSize: 13,
                fontWeight: 650,
                cursor: 'pointer',
              }}
            >
              Mark as fixed
            </button>
            <button
              type="button"
              onClick={() => actions.patch({ modal: 'dismiss' })}
              className="ph-ghost-danger"
              style={{
                padding: 11,
                border: `1px solid ${T.ruleStrong}`,
                borderRadius: 9,
                background: T.surface,
                color: T.inkSoft,
                fontFamily: FONT.sans,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Dismiss with a reason
            </button>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                paddingTop: 11,
                borderTop: `1px solid ${T.ruleFaint}`,
                fontSize: 12.5,
                color: T.inkMuted,
              }}
            >
              <Avatar initials={finding.assigneeInitials} />
              {finding.assignee}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: 16,
              border: `1px solid ${T.rule}`,
              borderRadius: 12,
              background: T.surface,
            }}
          >
            <SectionHeading size={13}>History</SectionHeading>
            {history.map((entry, i) => (
              <span key={i} style={{ display: 'flex', gap: 10 }}>
                <span
                  aria-hidden="true"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 2,
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: entry.dot,
                      marginTop: 5,
                    }}
                  />
                  <span style={{ flex: 1, width: 1, background: T.ruleFaint }} />
                </span>
                <span
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    paddingBottom: 12,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      lineHeight: 1.35,
                      textWrap: 'pretty',
                    }}
                  >
                    {entry.what}
                  </span>
                  <span style={{ fontSize: 11.5, color: T.inkMuted }}>{entry.when}</span>
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
