'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { DeliveryBundle } from '../../../../domain/document-delivery';
import { deliveryError, inDeliveryQueue, selectableForDelivery, type DeliveryRow, type DeliveryQueue } from '../../../../services/presentation/document-delivery';
import { inertWhen } from '../../lib/inert-button';
import { T } from '../../lib/tokens';
import { buttonStyle, disabledStyle, noteStyle, pathOf } from './document-shared';

type PublicBundle = Pick<DeliveryBundle, 'id' | 'preparedAt' | 'issuedAt' | 'revokedAt' | 'entries' | 'omissions' | 'bytes' | 'token'>;
type Overview = { rows: DeliveryRow[]; counts: { signedOff: number; delivered: number; excluded: number; eligible: number }; bundles: PublicBundle[] };
type Modal = { kind: 'signoff' | 'exclude'; row: DeliveryRow } | { kind: 'bundle'; bundle: PublicBundle };
/** A refused response in the panel's words; a body that is not JSON still has a status. */
async function refusalOf(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
  return deliveryError({ ...(payload ?? {}), status: response.status });
}
const QUEUES: Array<[DeliveryQueue, string]> = [['all', 'All documents'], ['work', 'Needs work'], ['signoff', 'Ready for sign-off'], ['delivery', 'Ready for delivery'], ['delivered', 'Delivered'], ['excluded', 'Excluded']];

export function DocumentDeliveryPanel({ clientId, revision }: { clientId: string; revision: number }) {
  const base = `/api/platform/clients/${encodeURIComponent(clientId)}`;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [queue, setQueue] = useState<DeliveryQueue>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<Modal | null>(null);
  const [answer, setAnswer] = useState('');
  /** What the last action did, said in a live region: the dialog that showed it is gone. */
  const [notice, setNotice] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  /** Set by `close`, honoured once the panel has settled — see the effect below. */
  const restoreFocus = useRef(false);
  const titleId = useId();

  /** True when the rows on screen are the server's current ones. */
  async function refresh(): Promise<boolean> {
    try {
      const response = await fetch(`${base}/delivery`, { cache: 'no-store' });
      if (!response.ok) { setError(await refusalOf(response)); return false; }
      const body = await response.json();
      setOverview(body);
      setSelected(current => current.filter(id => body.rows.some((row: DeliveryRow) => row.documentId === id && selectableForDelivery(row))));
      return true;
    } catch { setError(deliveryError({})); return false; }
  }
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${base}/delivery`, { cache: 'no-store' });
        if (!response.ok) { const refusal = await refusalOf(response); if (!cancelled) setError(refusal); return; }
        const body = await response.json();
        if (cancelled) return;
        setOverview(body);
        setSelected(current => current.filter(id => body.rows.some((row: DeliveryRow) => row.documentId === id && selectableForDelivery(row))));
      } catch { if (!cancelled) setError(deliveryError({})); }
    })();
    return () => { cancelled = true; };
  }, [base, revision]);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
  }, [modal]);
  /**
   * Focus goes back once the dialog is closed AND the work is done, not at the
   * moment `close` runs. `act` closes while `busy` is still true and before the
   * refreshed rows have rendered, so the control that opened the dialog may be
   * about to disappear: signing a row removes its "Sign off" button. Restoring
   * then left focus on a node leaving the document, which drops to `<body>`.
   * Here the render has happened, so `isConnected` tells the truth, and a
   * control that is gone hands focus to the panel's heading instead.
   */
  useEffect(() => {
    if (modal || busy || !restoreFocus.current) return;
    restoreFocus.current = false;
    const target = returnFocus.current?.isConnected ? returnFocus.current : heading.current;
    target?.focus();
  }, [modal, busy, overview]);

  function open(next: Modal) {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAnswer(''); setError(null); setNotice(''); setModal(next);
  }
  function close() {
    // Only a dialog that was open has somewhere to send focus back to. Reopen
    // runs through `act` with no dialog; its own button keeps focus, being inert.
    if (dialog.current?.open) restoreFocus.current = true;
    dialog.current?.close(); setModal(null);
  }
  async function act(path: string, body: unknown, success: string, done?: (body: { bundle: PublicBundle }) => void) {
    if (busy) return;
    setBusy(true); setError(null); setNotice('');
    try {
      const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) { setError(await refusalOf(response)); return; }
      const payload = await response.json();
      setNotice(success);
      // The action is done whatever the reload says. Without this, a failed
      // reload left "Signed off." beside a sentence asking whether it took effect.
      if (!await refresh()) setError(`${success} The list did not reload, so what is shown may be out of date. Refresh to see the current state.`);
      if (done) done(payload); else close();
    } catch { setError(deliveryError({})); }
    finally { setBusy(false); }
  }

  return <section aria-label="Document delivery" style={{ border: `1px solid ${T.rule}`, background: T.surface, borderRadius: 12, padding: 18, display: 'grid', gap: 14 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div><h3 ref={heading} tabIndex={-1} style={{ margin: 0, fontSize: 18 }}>Delivery</h3><p style={noteStyle}>Verified outputs, attributed sign-off, and the evidence that travels with each file.</p></div>
      {/* `aria-label` holds the name still while the text reads "Working…": focus stays on an inert control, so renaming it would be announced (`discover-pages.tsx` records why). */}
      {/* eslint-disable-next-line react-hooks/refs -- see lib/inert-button */}
      <button type="button" style={{ ...buttonStyle, ...disabledStyle(busy || !selected.length) }} {...inertWhen(busy || !selected.length, () => { returnFocus.current = document.activeElement as HTMLElement; void act('/delivery', { documentIds: selected }, 'Bundle prepared. Review it before issuing a link.', body => { setAnswer(''); setModal({ kind: 'bundle', bundle: body.bundle }); }); })} aria-label={`Prepare bundle${selected.length ? ` (${selected.length})` : ''}`}>{busy ? 'Working…' : `Prepare bundle${selected.length ? ` (${selected.length})` : ''}`}</button>
    </div>
    {/* Always in the document, so a message placed in it is announced. */}
    <p role="status" style={noteStyle}>{notice}</p>
    {error && !modal ? <p role="alert" style={{ ...noteStyle, color: T.fail }}>{error} <button type="button" style={buttonStyle} onClick={() => { setError(null); void refresh(); }}>Refresh</button></p> : null}
    {overview ? <>
      <dl style={{ display: 'flex', gap: 26, flexWrap: 'wrap', margin: 0 }}>
        {([['Signed off', overview.counts.signedOff], ['Delivered', overview.counts.delivered], ['Excluded', overview.counts.excluded]] as const).map(([label, count]) => <div key={label}><dt style={noteStyle}>{label}</dt><dd style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>{count}</dd></div>)}
      </dl>
      <label style={{ fontSize: 13 }}>Action queue{' '}<select value={queue} onChange={event => setQueue(event.target.value as DeliveryQueue)} style={{ ...buttonStyle, padding: 8 }}>{QUEUES.map(([value, label]) => <option key={value} value={value}>{label} ({overview.rows.filter(row => inDeliveryQueue(row, value)).length})</option>)}</select></label>
      <div style={{ maxHeight: 420, overflow: 'auto' }}>
        {/* eslint-disable-next-line react-hooks/refs -- the handler runs on click, never in render; see lib/inert-button */}
        {overview.rows.filter(row => inDeliveryQueue(row, queue)).map(row => <div key={row.documentId} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '12px 0', borderTop: `1px solid ${T.ruleFaint}` }}>
          <input type="checkbox" aria-label={`Include ${pathOf(row.url)} in delivery`} disabled={!selectableForDelivery(row)} aria-disabled={busy || undefined} checked={selected.includes(row.documentId)} onChange={event => { if (busy) return; setSelected(current => event.target.checked ? [...current, row.documentId] : current.filter(id => id !== row.documentId)); }} />
          <div style={{ flex: '1 1 220px', minWidth: 0 }}><a href={`/clients/${encodeURIComponent(clientId)}/documents/${encodeURIComponent(row.documentId)}`} style={{ color: T.ink, fontSize: 13, fontWeight: 650, overflowWrap: 'anywhere' }}>{pathOf(row.url)}</a><p style={noteStyle}>{row.excluded ? `Excluded: ${row.exclusionReason ?? 'Reason recorded'}` : row.reason ?? (row.delivered ? 'Current output delivered' : row.signedOff ? 'Signed off — ready for delivery' : 'Ready for verified sign-off')}</p></div>
          {!row.excluded && row.eligible && !row.signedOff ? <button style={{ ...buttonStyle, ...disabledStyle(busy) }} type="button" {...inertWhen(busy, () => open({ kind: 'signoff', row }))}>Sign off</button> : null}
          <button style={{ ...buttonStyle, ...disabledStyle(busy) }} type="button" {...inertWhen(busy, () => row.excluded ? void act(`/documents/${encodeURIComponent(row.documentId)}/exclusion`, { reverse: true }, 'Document reopened.') : open({ kind: 'exclude', row }))}>{row.excluded ? 'Reopen' : 'Exclude'}</button>
        </div>)}
        {!overview.rows.some(row => inDeliveryQueue(row, queue)) ? <p style={noteStyle}>No documents in this queue.</p> : null}
      </div>
      {overview.bundles.length ? <details><summary style={{ cursor: 'pointer', fontWeight: 650, fontSize: 13 }}>Delivery bundles ({overview.bundles.length})</summary>{overview.bundles.map(bundle => <div key={bundle.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '12px 0' }}><span style={noteStyle}>{bundle.preparedAt.slice(0, 10)} · {bundle.entries.length} documents · {bundle.revokedAt ? 'Link revoked' : bundle.issuedAt ? 'Issued' : 'Prepared'}</span><button type="button" style={buttonStyle} onClick={() => open({ kind: 'bundle', bundle })}>Review bundle</button>{bundle.token && !bundle.revokedAt ? <a href={`/d/${encodeURIComponent(bundle.token)}`} style={{ color: T.accent, fontSize: 13 }}>Open delivery link</a> : null}</div>)}</details> : null}
    </> : <p role="status" style={noteStyle}>Loading delivery status…</p>}
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) close(); }} style={{ width: 'min(640px, calc(100vw - 40px))', maxHeight: '85vh', overflow: 'auto', border: `1px solid ${T.rule}`, borderRadius: 14, padding: 24, color: T.ink, background: T.surface }}>
      {modal ? <><h3 id={titleId} style={{ marginTop: 0 }}>{modal.kind === 'bundle' ? 'Review the delivery bundle' : modal.kind === 'signoff' ? 'Sign off this output' : 'Exclude this document'}</h3>
        {modal.kind === 'bundle' ? <>
          <p style={noteStyle}>{modal.bundle.entries.length} documents · {(modal.bundle.bytes / 1024 / 1024).toFixed(1)} MiB. Includes verification reports, hashes, attestations, and attributed activity.</p>
          <ul>{modal.bundle.entries.map(entry => <li key={entry.documentId} style={{ overflowWrap: 'anywhere', fontSize: 13 }}>{pathOf(entry.source)}</li>)}</ul>
          <h4>Omitted documents</h4>{modal.bundle.omissions.length ? <ul>{modal.bundle.omissions.map(item => <li key={item.documentId} style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{pathOf(item.source)} — {item.reason}</li>)}</ul> : <p style={noteStyle}>None.</p>}
          <a href={`${base}/delivery/${encodeURIComponent(modal.bundle.id)}`} style={{ color: T.accent }}>Download prepared ZIP</a>
          <p style={noteStyle}>Issuing creates a client-accessible link. A prepared bundle alone is not a delivery.</p>
        </> : <><p style={{ ...noteStyle, overflowWrap: 'anywhere' }}>{pathOf(modal.row.url)}</p><label style={{ display: 'grid', gap: 8, margin: '14px 0', fontSize: 13 }}>{modal.kind === 'exclude' ? 'Reason (required, shown to the client in the delivery)' : 'Private operator note (optional)'}<textarea value={answer} onChange={event => setAnswer(event.target.value)} maxLength={2000} rows={4} style={{ padding: 10, font: 'inherit', border: `1px solid ${T.rule}`, borderRadius: 8 }} /></label>{modal.kind === 'signoff' && modal.row.knownDifferences.length ? <>
            {/* Disclosed where the attestation is made. These travel with the file and appear on the client's delivery page, so the operator signs having read them. */}
            <h4 style={{ margin: '0 0 6px' }}>Known differences from the source document</h4>
            <ul style={{ margin: '0 0 12px', paddingLeft: 18 }}>{modal.row.knownDifferences.map((difference, index) => <li key={index} style={{ fontSize: 13 }}>{difference.detail} (WCAG {difference.criterion})</li>)}</ul>
          </> : null}{modal.kind === 'signoff' ? <p style={noteStyle}>The server rechecks the output, source identity, verification, and outstanding answers before recording your sign-off.</p> : null}</>}
        {error ? <p role="alert" style={{ ...noteStyle, color: T.fail }}>{error}</p> : null}
        {/* eslint-disable-next-line react-hooks/refs -- the handler runs on click, never in render; see lib/inert-button */}
        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}><button type="button" style={{ ...buttonStyle, ...disabledStyle(busy) }} {...inertWhen(busy, close)}>Close</button>
          {/* eslint-disable-next-line react-hooks/refs -- the handler runs on click, never in render; see lib/inert-button */}
          {modal.kind === 'bundle' ? !modal.bundle.issuedAt ? <button type="button" style={{ ...buttonStyle, ...disabledStyle(busy) }} {...inertWhen(busy, () => void act(`/delivery/${encodeURIComponent(modal.bundle.id)}`, { action: 'issue' }, 'Delivery link issued.'))}>Issue delivery link</button> : !modal.bundle.revokedAt ? <button type="button" style={{ ...buttonStyle, ...disabledStyle(busy) }} {...inertWhen(busy, () => void act(`/delivery/${encodeURIComponent(modal.bundle.id)}`, { action: 'revoke' }, 'Link revoked.'))}>Revoke link</button> : null : <button type="button" style={{ ...buttonStyle, ...disabledStyle(busy || (modal.kind === 'exclude' && !answer.trim())) }} {...inertWhen(busy || (modal.kind === 'exclude' && !answer.trim()), () => void act(`/documents/${encodeURIComponent(modal.row.documentId)}/${modal.kind === 'signoff' ? 'signoff' : 'exclusion'}`, modal.kind === 'signoff' ? { fingerprint: modal.row.fingerprint, ...(answer.trim() ? { note: answer.trim() } : {}) } : { reason: answer.trim() }, modal.kind === 'signoff' ? 'Signed off.' : 'Exclusion recorded.'))} aria-label={modal.kind === 'signoff' ? 'Verify and sign off' : 'Record exclusion'}>{busy ? 'Working…' : modal.kind === 'signoff' ? 'Verify and sign off' : 'Record exclusion'}</button>}
        </div>
      </> : null}
    </dialog>
  </section>;
}
