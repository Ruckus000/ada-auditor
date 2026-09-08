'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { figureGroups } from '../../../domain/document-answers';
import { documentPreviewSchema, isDocumentWideAsk, type DocumentPreview } from '../../../domain/document-preview';
import { buttonStyle, noteStyle, type Summary } from './client/document-shared';
import { T } from '../lib/tokens';
import styles from './document-reader.module.css';

/** A preview complements the complete reading. A failed raster never takes
 * away the form, and no text/geometry is invented when the PDF is unplaced. */
export function DocumentReader({ summary, endpoint, file, expectedSha, children }: {
  summary: Summary; endpoint: string; file?: File | null; expectedSha?: string | null; children: ReactNode;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [loadedPreview, setPreview] = useState<{ value: DocumentPreview; key: string; file: File | null | undefined } | null>(null);
  const [error, setError] = useState<{ message: string; key: string } | null>(null);
  const [folded, setFolded] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const previewKey = `${endpoint}|${expectedSha ?? ''}|${page}|${retry}`;
  const previewFile = file ?? localFile;
  const preview = loadedPreview?.key === previewKey && loadedPreview.file === previewFile ? loadedPreview.value : null;
  const asks = summary.asks ?? [];
  const groups = figureGroups(asks.filter((ask) => ask.kind === 'figure'));
  const leadId = (askId: string) => groups.find((group) => group.some((ask) => ask.id === askId))?.[0]?.id ?? askId;
  const description = (askId: string) => summary.needs?.[asks.findIndex((ask) => ask.id === askId)]?.item ?? askId;

  useEffect(() => {
    const controller = new AbortController();
    const uploaded = file ?? localFile;
    const body = uploaded ? new FormData() : undefined;
    if (body && uploaded) body.set('file', uploaded);
    void fetch(`${endpoint}${endpoint.includes('?') ? '&' : '?'}page=${page}`, {
      method: body ? 'POST' : 'GET', body, signal: controller.signal, cache: 'no-store',
    }).then(async (response) => {
      if (!response.ok) {
        const refusal = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(refusal.error === 'preview_bytes_changed' || refusal.error === 'preview_reading_changed'
          ? 'The file or reading has changed. Inspect it again before placing these issues.'
          : refusal.error === 'preview_source_required'
            ? 'Choose the inspected PDF below to preview it. Its bytes must match the reading; nothing is stored.'
            : 'The page preview is unavailable. The complete reading and answers remain usable.');
      }
      const result = await response.json() as { sha256?: string };
      if (expectedSha && result.sha256 !== expectedSha) throw new Error('The preview does not match the inspected file. Inspect it again.');
      const parsed = documentPreviewSchema.parse(result);
      if (!controller.signal.aborted) setPreview({ value: parsed, key: previewKey, file: previewFile });
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError({ message: failure instanceof Error ? failure.message : 'Preview unavailable.', key: previewKey });
    });
    return () => controller.abort();
  }, [endpoint, file, localFile, expectedSha, page, retry, previewKey, previewFile]);

  function select(askId: string, focus: boolean) {
    selectedRef.current = askId; setSelected(askId); setFolded(false);
    const ask = asks.find((candidate) => candidate.id === askId);
    const targetPage = ask?.target && 'ordinal' in ask.target ? ask.target.page : null;
    if (targetPage) setPage(targetPage);
    if (focus) {
      const container = [...(panel.current?.querySelectorAll<HTMLElement>('[data-reader-ask]') ?? [])]
        .find((element) => element.dataset.readerAsk === leadId(askId));
      const control = container?.querySelector<HTMLElement>('textarea,select,input,button');
      (control ?? container)?.focus();
      container?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  const loading = preview === null && error?.key !== previewKey;
  const currentMarks = preview?.figures.flatMap((box) => {
    const ask = asks.find((candidate) => candidate.kind === 'figure' && candidate.target && 'ordinal' in candidate.target && candidate.target.ordinal === box.ordinal);
    return ask ? [{ ...box, ask }] : [];
  }) ?? [];
  const documentIssues = asks.filter(isDocumentWideAsk);
  const unplaced = asks.filter((ask) => (!isDocumentWideAsk(ask) && ask.kind !== 'figure') || ask.kind === 'figure' && (!(ask.target && 'ordinal' in ask.target && ask.target.page) || (preview && ask.target && 'ordinal' in ask.target && ask.target.page === page && !currentMarks.some((mark) => mark.ask.id === ask.id))));
  const issueButton = (askId: string) => <button key={askId} type="button" onClick={() => select(askId, true)} aria-pressed={selected === askId} style={{ ...buttonStyle, textAlign: 'left', background: selected === askId ? T.accentWash : T.surface }}>{asks.findIndex((ask) => ask.id === askId) + 1} · {description(askId)}</button>;

  return <div className={styles.reader}>
    <section className={styles.canvas} aria-label="Document page preview">
      <div className={styles.controls}>
        <button type="button" style={buttonStyle} disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous page</button>
        <span aria-live="polite">Page {page}{preview ? ` of ${preview.pages}` : ''}</span>
        <button type="button" style={buttonStyle} disabled={!preview || page >= preview.pages || loading} onClick={() => setPage(page + 1)}>Next page</button>
        <button type="button" style={buttonStyle} aria-expanded={!folded} aria-controls={`${id}-page`} onClick={() => setFolded(!folded)}>{folded ? 'Show page' : 'Fold page'}</button>
      </div>
      {documentIssues.length ? <><strong style={{ fontSize: 12 }}>Whole document</strong><div className={styles.strip}>{documentIssues.map((ask) => issueButton(ask.id))}</div></> : null}
      {unplaced.length ? <><strong style={{ fontSize: 12 }}>Unplaced — no reliable location</strong><div className={styles.strip}>{unplaced.map((ask) => issueButton(ask.id))}</div></> : null}
      {loading ? <p role="status" style={noteStyle}>Rendering page…</p> : null}
      {error?.key === previewKey ? <div role="alert"><p style={noteStyle}>{error.message}</p><button type="button" style={buttonStyle} onClick={() => setRetry(retry + 1)}>Retry preview</button>
        {!file ? <label style={{ display: 'block', marginTop: 8 }}>Choose the inspected PDF <input type="file" accept="application/pdf,.pdf" onChange={(event) => setLocalFile(event.target.files?.[0] ?? null)} /></label> : null}
      </div> : null}
      <div id={`${id}-page`} hidden={folded}>
        {preview ? <div className={styles.paper} style={{ maxWidth: preview.width }}>
          <Image unoptimized src={`data:image/png;base64,${preview.png}`} width={preview.width} height={preview.height} alt={`Document page ${page}. The complete textual issue list follows the preview.`} />
          {currentMarks.map((mark) => <button key={mark.ask.id} type="button" className={styles.mark} aria-label={`Issue ${asks.indexOf(mark.ask) + 1}: ${description(mark.ask.id)}`} aria-pressed={selected === mark.ask.id} onClick={() => select(mark.ask.id, true)} style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%`, width: `${mark.w * 100}%`, height: `${mark.h * 100}%` }}><span className={styles.number}>{asks.indexOf(mark.ask) + 1}</span></button>)}
        </div> : null}
      </div>
      <details><summary style={{ cursor: 'pointer', marginTop: 12 }}>All {asks.length} issues (text list)</summary><ol className={styles.issues}>{asks.map((ask) => <li key={ask.id}>{issueButton(ask.id)} <span style={noteStyle}>{ask.criterion}{ask.answerable === 'none' ? ' · no action required' : ''}</span></li>)}</ol></details>
    </section>
    <div ref={panel} className={styles.panel} onFocusCapture={(event) => {
      const askId = (event.target as HTMLElement).closest<HTMLElement>('[data-reader-ask]')?.dataset.readerAsk;
      if (askId && (!selectedRef.current || leadId(selectedRef.current) !== askId)) select(askId, false);
    }}>{children}</div>
  </div>;
}
