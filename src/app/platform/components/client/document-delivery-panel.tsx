'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { DeliveryBundle } from '../../../../domain/document-delivery';
import { deliveryError, inDeliveryQueue, selectableForDelivery, type DeliveryRow, type DeliveryQueue } from '../../../../services/presentation/document-delivery';
import { T } from '../../lib/tokens';
import { buttonStyle, noteStyle, pathOf } from './document-shared';

type PublicBundle = Pick<DeliveryBundle, 'id' | 'preparedAt' | 'issuedAt' | 'revokedAt' | 'entries' | 'omissions' | 'bytes' | 'token'>;
type Overview = { rows: DeliveryRow[]; counts: { signedOff: number; delivered: number; excluded: number; eligible: number }; bundles: PublicBundle[] };
type Modal = { kind: 'signoff' | 'exclude'; row: DeliveryRow } | { kind: 'bundle'; bundle: PublicBundle };
const QUEUES: Array<[DeliveryQueue, string]> = [['all', 'All documents'], ['work', 'Needs work'], ['signoff', 'Ready for approval'], ['delivery', 'Ready to share'], ['delivered', 'Link created'], ['excluded', 'Excluded']];

export function DocumentDeliveryPanel({ clientId, revision }: { clientId: string; revision: number }) {
  const base = `/api/platform/clients/${encodeURIComponent(clientId)}`;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [queue, setQueue] = useState<DeliveryQueue>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<Modal | null>(null);
  const [answer, setAnswer] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  async function refresh() {
    try {
      const response = await fetch(`${base}/delivery`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) { setError(deliveryError(body.error ?? 'unknown', body.requestId)); return; }
      setOverview(body);
      setSelected(current => current.filter(id => body.rows.some((row: DeliveryRow) => row.documentId === id && selectableForDelivery(row))));
    } catch { setError(deliveryError('network')); }
  }
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${base}/delivery`, { cache: 'no-store' });
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) { setError(deliveryError(body.error ?? 'unknown', body.requestId)); return; }
        setOverview(body);
        setSelected(current => current.filter(id => body.rows.some((row: DeliveryRow) => row.documentId === id && selectableForDelivery(row))));
      } catch { if (!cancelled) setError(deliveryError('network')); }
    })();
    return () => { cancelled = true; };
  }, [base, revision]);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
  }, [modal]);

  function open(next: Modal) {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAnswer(''); setError(null); setModal(next);
  }
  function close() {
    dialog.current?.close(); setModal(null); returnFocus.current?.focus();
  }
  async function act(path: string, body: unknown, done?: (body: { bundle: PublicBundle }) => void) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) { setError(deliveryError(payload.error ?? 'unknown', payload.requestId)); return; }
      await refresh();
      if (done) done(payload); else close();
    } catch { setError(deliveryError('network')); }
    finally { setBusy(false); }
  }

  return <section aria-label="Document delivery" style={{ border: `1px solid ${T.rule}`, background: T.surface, borderRadius: 12, padding: 18, display: 'grid', gap: 14 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div><h3 style={{ margin: 0, fontSize: 18 }}>Delivery</h3><p style={noteStyle}>Files ready to share, with their checks and approvals recorded.</p></div>
      <button type="button" style={buttonStyle} disabled={busy || !selected.length} onClick={() => { returnFocus.current = document.activeElement as HTMLElement; void act('/delivery', { documentIds: selected }, body => { setAnswer(''); setModal({ kind: 'bundle', bundle: body.bundle }); }); }}>{busy ? 'Working…' : `Prepare bundle${selected.length ? ` (${selected.length})` : ''}`}</button>
    </div>
    {error && !modal ? <p role="alert" style={{ ...noteStyle, color: T.fail }}>{error} <button type="button" style={buttonStyle} onClick={() => { setError(null); void refresh(); }}>Refresh</button></p> : null}
    {overview ? <>
      <dl style={{ display: 'flex', gap: 26, flexWrap: 'wrap', margin: 0 }}>
        {([['Approved for sharing', overview.counts.signedOff], ['Links created', overview.counts.delivered], ['Excluded', overview.counts.excluded]] as const).map(([label, count]) => <div key={label}><dt style={noteStyle}>{label}</dt><dd style={{ margin: 0, fontSize: 26, fontWeight: 700 }}>{count}</dd></div>)}
      </dl>
      <label style={{ fontSize: 13 }}>Action queue{' '}<select value={queue} onChange={event => setQueue(event.target.value as DeliveryQueue)} style={{ ...buttonStyle, padding: 8 }}>{QUEUES.map(([value, label]) => <option key={value} value={value}>{label} ({overview.rows.filter(row => inDeliveryQueue(row, value)).length})</option>)}</select></label>
      <div style={{ maxHeight: 420, overflow: 'auto' }}>
        {overview.rows.filter(row => inDeliveryQueue(row, queue)).map(row => <div key={row.documentId} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '12px 0', borderTop: `1px solid ${T.ruleFaint}` }}>
          <input type="checkbox" aria-label={`Include ${pathOf(row.url)} in delivery`} disabled={!selectableForDelivery(row) || busy} checked={selected.includes(row.documentId)} onChange={event => setSelected(current => event.target.checked ? [...current, row.documentId] : current.filter(id => id !== row.documentId))} />
          <div style={{ flex: '1 1 220px', minWidth: 0 }}><a href={`/clients/${encodeURIComponent(clientId)}/documents/${encodeURIComponent(row.documentId)}`} style={{ color: T.ink, fontSize: 13, fontWeight: 650, overflowWrap: 'anywhere' }}>{pathOf(row.url)}</a><p style={noteStyle}>{row.excluded ? `Excluded: ${row.exclusionReason ?? 'Reason recorded'}` : row.reason ?? (row.delivered ? 'Sharing link created' : row.signedOff ? 'Approved for sharing' : 'Ready for approval')}</p></div>
          {!row.excluded && row.eligible && !row.signedOff ? <button style={buttonStyle} type="button" disabled={busy} onClick={() => open({ kind: 'signoff', row })}>Approve for sharing</button> : null}
          <button style={buttonStyle} type="button" disabled={busy} onClick={() => row.excluded ? void act(`/documents/${encodeURIComponent(row.documentId)}/exclusion`, { reverse: true }) : open({ kind: 'exclude', row })}>{row.excluded ? 'Include again' : 'Exclude from sharing'}</button>
        </div>)}
        {!overview.rows.some(row => inDeliveryQueue(row, queue)) ? <p style={noteStyle}>No documents in this queue.</p> : null}
      </div>
      {overview.bundles.length ? <details><summary style={{ cursor: 'pointer', fontWeight: 650, fontSize: 13 }}>Prepared file sets ({overview.bundles.length})</summary>{overview.bundles.map(bundle => <div key={bundle.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '12px 0' }}><span style={noteStyle}>{bundle.preparedAt.slice(0, 10)} · {bundle.entries.length} documents · {bundle.revokedAt ? 'Link turned off' : bundle.issuedAt ? 'Link active' : 'Ready to share'}</span><button type="button" style={buttonStyle} onClick={() => open({ kind: 'bundle', bundle })}>Review prepared files</button>{bundle.token && !bundle.revokedAt ? <a href={`/d/${encodeURIComponent(bundle.token)}`} style={{ color: T.accent, fontSize: 13 }}>Open delivery link</a> : null}</div>)}</details> : null}
    </> : <p role="status" style={noteStyle}>Loading delivery status…</p>}
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) close(); }} style={{ width: 'min(640px, calc(100vw - 40px))', maxHeight: '85vh', overflow: 'auto', border: `1px solid ${T.rule}`, borderRadius: 14, padding: 24, color: T.ink, background: T.surface }}>
      {modal ? <><h3 id={titleId} style={{ marginTop: 0 }}>{modal.kind === 'bundle' ? 'Review the delivery bundle' : modal.kind === 'signoff' ? 'Approve this file for sharing' : 'Exclude this document'}</h3>
        {modal.kind === 'bundle' ? <>
          <p style={noteStyle}>{modal.bundle.entries.length} documents · {(modal.bundle.bytes / 1024 / 1024).toFixed(1)} MiB. Includes check reports and the activity record.</p>
          <ul>{modal.bundle.entries.map(entry => <li key={entry.documentId} style={{ overflowWrap: 'anywhere', fontSize: 13 }}>{pathOf(entry.source)}</li>)}</ul>
          <h4>Omitted documents</h4>{modal.bundle.omissions.length ? <ul>{modal.bundle.omissions.map(item => <li key={item.documentId} style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{pathOf(item.source)} — {item.reason}</li>)}</ul> : <p style={noteStyle}>None.</p>}
          <a href={`${base}/delivery/${encodeURIComponent(modal.bundle.id)}`} style={{ color: T.accent }}>Download prepared ZIP</a>
          <p style={noteStyle}>Creating the link lets the client open these files. Preparing the files alone does not share them.</p>
        </> : <><p style={{ ...noteStyle, overflowWrap: 'anywhere' }}>{pathOf(modal.row.url)}</p><label style={{ display: 'grid', gap: 8, margin: '14px 0', fontSize: 13 }}>{modal.kind === 'exclude' ? 'Reason (required)' : 'Private operator note (optional)'}<textarea value={answer} onChange={event => setAnswer(event.target.value)} maxLength={2000} rows={4} style={{ padding: 10, font: 'inherit', border: `1px solid ${T.rule}`, borderRadius: 8 }} /></label>{modal.kind === 'signoff' ? <p style={noteStyle}>The server checks the output, source, verification, and outstanding answers before recording your approval for sharing.</p> : null}</>}
        {error ? <p role="alert" style={{ ...noteStyle, color: T.fail }}>{error}</p> : null}
        <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}><button type="button" style={buttonStyle} disabled={busy} onClick={close}>Close</button>
          {modal.kind === 'bundle' ? !modal.bundle.issuedAt ? <button type="button" style={buttonStyle} disabled={busy} onClick={() => void act(`/delivery/${encodeURIComponent(modal.bundle.id)}`, { action: 'issue' })}>Create delivery link</button> : !modal.bundle.revokedAt ? <button type="button" style={buttonStyle} disabled={busy} onClick={() => void act(`/delivery/${encodeURIComponent(modal.bundle.id)}`, { action: 'revoke' })}>Turn off link</button> : null : <button type="button" style={buttonStyle} disabled={busy || (modal.kind === 'exclude' && !answer.trim())} onClick={() => void act(`/documents/${encodeURIComponent(modal.row.documentId)}/${modal.kind === 'signoff' ? 'signoff' : 'exclusion'}`, modal.kind === 'signoff' ? { ...(answer.trim() ? { note: answer.trim() } : {}) } : { reason: answer.trim() })}>{busy ? 'Working…' : modal.kind === 'signoff' ? 'Approve for sharing' : 'Exclude document'}</button>}
        </div>
      </> : null}
    </dialog>
  </section>;
}
