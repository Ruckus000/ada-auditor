'use client';

import {
  AUDIENCES,
  findingDetail,
  findingsFor,
  reportSections,
  type ClientView,
} from '../lib/derive';
import { usePlatform } from '../lib/state';
import { FONT, T } from '../lib/tokens';
import { Eyebrow, Modal, ModalFooter, RadioCard, ReadOnlyField, SwitchRow } from './ui';

const DELIVERY: Array<[string, boolean, string, string]> = [
  ['dv1', true, 'Shareable client link', 'Read-only page, no account needed. Expires after 30 days.'],
  ['dv2', true, 'PDF for the record', 'Attached to this run so the wording can never drift.'],
  ['dv3', false, 'Let the client comment', 'Replies land in Activity against each finding.'],
];

const AUDIT_OPTIONS: Array<[string, boolean, string, string]> = [
  ['ao1', true, 'Test the server response as well as the page', 'Adds backend findings — language, status codes, untagged PDFs.'],
  ['ao2', true, 'Record the journeys I care about', 'Walk a task once and we re-test the whole chain every run.'],
  ['ao3', false, 'Add a test account for gated pages', 'Without one, signed-in pages are excluded rather than passed.'],
];

const DISMISS_REASONS: Array<[string, string, string]> = [
  ['notApplicable', 'Not applicable here', 'The rule does not apply to this element in this context.'],
  ['falsePositive', 'False positive', 'We checked manually and no barrier exists.'],
  ['elsewhere', 'Handled elsewhere', 'An equivalent route to the same task exists and passes.'],
  ['accepted', 'Accepted risk, signed off', 'The client has accepted it in writing. Names the approver.'],
  ['deferred', 'Deferred to a later release', 'Agreed fix date is recorded and the finding reopens then.'],
];

const INVITE_ROLES: Array<[string, string, string]> = [
  ['auditor', 'Auditor', 'Everything, including dismissal reasons. Can change a verdict.'],
  ['manager', 'Account manager', 'Scores, trends and issued reports. Cannot change a verdict.'],
  ['dev', 'Client · developer', 'Open findings, code and fixes for their own site only.'],
  ['legal', 'Client · legal', 'Verdict, criteria table and issued reports for their own site only.'],
];

const cancelButton = {
  padding: '10px 16px',
  border: `1px solid ${T.ruleStrong}`,
  borderRadius: 9,
  background: T.surface,
  color: T.inkSoft,
  fontFamily: FONT.sans,
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
};

const confirmButton = {
  flex: 1,
  padding: '10px 16px',
  border: 'none',
  borderRadius: 9,
  background: T.accent,
  color: '#fff',
  fontFamily: FONT.sans,
  fontSize: 12.5,
  fontWeight: 650,
  cursor: 'pointer',
};

export function GenerateReportModal({ client }: { client: ClientView }) {
  const { state, actions } = usePlatform();
  const close = () => actions.patch({ modal: null });
  const sections = reportSections(state.audience);

  return (
    <Modal
      screenLabel="Generate report modal"
      title={`Generate a report · ${client.name}`}
      subtitle={`Run #${client.run} · ${client.pages} pages · ${client.standard}`}
      onClose={close}
      width={620}
    >
      <span
        role="radiogroup"
        aria-label="Who is reading it"
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <Eyebrow>WHO IS READING IT</Eyebrow>
        {AUDIENCES.map(([key, label, note]) => (
          <RadioCard
            key={key}
            on={state.audience === key}
            label={label}
            note={note}
            onPick={() => actions.patch({ audience: key, dirty: true })}
          />
        ))}
      </span>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
          gap: 12,
        }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Eyebrow>BASED ON</Eyebrow>
          <ReadOnlyField label="" value={`Run #${client.run} — latest`} caret />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Eyebrow>STANDARD</Eyebrow>
          <ReadOnlyField label="" value={client.standard} caret />
        </span>
      </div>

      <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Eyebrow>WHAT GOES IN</Eyebrow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
          {sections.map((section) => (
            <span
              key={section.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                fontSize: 12,
                color: T.inkSoft,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 16,
                  height: 16,
                  borderRadius: 5,
                  background: section.boxBg,
                  border: `1px solid ${section.boxBorder}`,
                  color: '#fff',
                  fontSize: 9.5,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {section.tick}
              </span>
              <span style={{ lineHeight: 1.3 }}>{section.label}</span>
            </span>
          ))}
        </div>
      </span>

      <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Eyebrow>HOW IT IS DELIVERED</Eyebrow>
        {DELIVERY.map(([key, fallback, label, note]) => {
          const t = actions.toggle(key, fallback);
          return <SwitchRow key={key} on={t.on} label={label} note={note} onFlip={t.flip} />;
        })}
      </span>

      <span
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 9,
          padding: '11px 13px',
          borderRadius: 10,
          background: T.cautionWash,
          border: `1px solid ${T.cautionEdge}`,
          fontSize: 11.5,
          color: T.caution,
          lineHeight: 1.45,
          textWrap: 'pretty',
        }}
      >
        {client.genWarning}
      </span>

      <div
        style={{ display: 'flex', gap: 8, paddingTop: 14, borderTop: `1px solid ${T.ruleFaint}` }}
      >
        <button type="button" onClick={close} className="ph-ghost" style={cancelButton}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() =>
            actions.patch({
              modal: null,
              // Workspace reports: the client-scoped reports tab went with the
              // fixture client screens, and comes back real in slice 5.
              screen: 'reports',
              reportOpen: 0,
              dirty: true,
              draft: true,
            })
          }
          className="ph-primary"
          style={confirmButton}
        >
          Generate and open the draft
        </button>
      </div>
    </Modal>
  );
}

export function UndoModal() {
  const { state, actions } = usePlatform();
  const close = () => actions.patch({ modal: null });
  const row = state.undoRow;

  return (
    <Modal
      screenLabel="Undo decision modal"
      title="Undo this decision?"
      onClose={close}
      width={480}
      hideClose
    >
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          padding: 13,
          border: `1px solid ${T.ruleFaint}`,
          borderRadius: 10,
          background: T.surfaceSunk,
        }}
      >
        <span style={{ fontSize: 12.5, lineHeight: 1.45 }}>
          <span style={{ fontWeight: 650 }}>{row?.who}</span> {row?.action}{' '}
          <span style={{ fontWeight: 600 }}>{row?.target}</span>
        </span>
        <span style={{ fontSize: 11.5, color: T.inkMuted }}>
          {row?.when} · {row?.client}
        </span>
      </span>
      <span
        style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.55, textWrap: 'pretty' }}
      >
        The finding returns to its previous state and reappears in the open list. Anyone with the
        client link will see it again within a minute.
      </span>
      <span
        style={{
          padding: '11px 13px',
          borderRadius: 10,
          background: T.paperDeep,
          fontSize: 11.5,
          color: T.inkMuted,
          lineHeight: 1.45,
          textWrap: 'pretty',
        }}
      >
        The original decision stays in the log. Undoing adds a second entry rather than erasing the
        first.
      </span>
      <ModalFooter>
        <button type="button" onClick={close} className="ph-ghost" style={cancelButton}>
          Keep it
        </button>
        <button
          type="button"
          onClick={() => {
            actions.patch({
              modal: null,
              undone: { ...state.undone, ...(row ? { [row.target]: true } : {}) },
            });
            actions.flash('Decision undone. Both entries stay in the log.');
          }}
          className="ph-primary"
          style={confirmButton}
        >
          Undo it
        </button>
      </ModalFooter>
    </Modal>
  );
}

export function InviteModal({ client }: { client: ClientView }) {
  const { state, actions } = usePlatform();
  const close = () => actions.patch({ modal: null });
  const scope =
    state.inviteRole === 'auditor' || state.inviteRole === 'manager'
      ? 'All 34 clients'
      : `${client.name} only`;

  return (
    <Modal screenLabel="Invite someone modal" title="Invite someone" onClose={close} width={540}>
      <ReadOnlyField label="Email address" value="name@company.com" placeholder accentBorder />
      <span
        role="radiogroup"
        aria-label="Role"
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <Eyebrow>ROLE</Eyebrow>
        {INVITE_ROLES.map(([key, label, note]) => (
          <RadioCard
            key={key}
            on={state.inviteRole === key}
            label={label}
            note={note}
            onPick={() => actions.patch({ inviteRole: key })}
          />
        ))}
      </span>
      <ReadOnlyField label="Which clients they can see" value={scope} caret />
      <ModalFooter>
        <button type="button" onClick={close} className="ph-ghost" style={cancelButton}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            actions.patch({ modal: null });
            actions.flash('Invite sent. They appear here as “pending” until they accept.');
          }}
          className="ph-primary"
          style={confirmButton}
        >
          Send the invite
        </button>
      </ModalFooter>
    </Modal>
  );
}
