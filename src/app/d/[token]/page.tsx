import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getPlatformStore } from '../../../integrations/persistence';
import { FONT, T } from '../../platform/lib/tokens';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {title: 'Document delivery', robots: {index: false, follow: false}, referrer: 'no-referrer'};

export default async function DeliveryPage({params}: {params: Promise<{token: string}>}) {
  const {token} = await params;
  const bundle = /^[a-f0-9]{64}$/.test(token) ? await getPlatformStore().getDeliveryByToken(token) : null;
  if (!bundle) notFound();
  return <main style={{maxWidth: 900, margin: '0 auto', padding: '40px clamp(16px,4vw,32px)', fontFamily: FONT.sans, color: T.ink}}>
    <header>
      <p style={{color: T.accent, fontSize: 12, fontWeight: 700}}>DOCUMENT DELIVERY</p>
      <h1 style={{fontSize: 30}}>{bundle.clientName}</h1>
      <p>Issued <time dateTime={bundle.issuedAt}>{bundle.issuedAt?.slice(0, 10)}</time> by {bundle.issuedBy}.</p>
      <p>{bundle.entries.length} verified {bundle.entries.length === 1 ? 'document' : 'documents'}, with conformance evidence and attributed work records.</p>
      <a href={`/d/${token}/download`} style={{display: 'inline-block', padding: '12px 18px', background: T.accent, color: '#fff', borderRadius: 8}}>Download delivery bundle</a>
      <p style={{fontSize: 12, color: T.inkMuted}}>ZIP · {Math.ceil(bundle.bytes / 1024)} KB · Files and evidence are pinned to this delivery.</p>
    </header>
    <section style={{marginTop: 28}} aria-labelledby="included-title">
      <h2 id="included-title">Included documents</h2>
      <ul style={{listStyle: 'none', padding: 0}}>{bundle.entries.map((entry, i) => <li key={entry.documentId} style={{padding: '16px 0', borderBottom: `1px solid ${T.rule}`, overflowWrap: 'anywhere'}}>
        <strong>Document {i + 1} · {entry.source}</strong>
        <p>Signed off by {entry.signedBy} on {entry.signedAt.slice(0, 10)}. PDF/UA-1 verification passed.</p>
        <details><summary>File identity</summary><p style={{fontFamily: FONT.mono, fontSize: 12}}>SHA-256: {entry.outputSha256}</p></details>
      </li>)}</ul>
    </section>
    <section style={{marginTop: 28}} aria-labelledby="omitted-title">
      <h2 id="omitted-title">What is excluded, and why</h2>
      {bundle.omissions.length === 0 ? <p>No documents were omitted from the inventory captured for this delivery.</p> : <ul>{bundle.omissions.map(entry => <li key={entry.documentId} style={{marginBottom: 12, overflowWrap: 'anywhere'}}><strong>{entry.source}</strong> — {entry.reason}</li>)}</ul>}
    </section>
    <footer style={{marginTop: 32, borderTop: `1px solid ${T.rule}`, paddingTop: 16, color: T.inkMuted, fontSize: 13}}>
      The bundle records the checks performed and their scope. It is not a legal certification or a claim that every accessibility barrier has been eliminated.
    </footer>
  </main>;
}
