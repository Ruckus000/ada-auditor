'use client';

import { useEffect, useId, useState } from 'react';
import { FONT, T } from '../../lib/tokens';

/**
 * The client's documents: found by a crawl, or handed over by the operator.
 *
 * Municipal sites are document-heavy, and until this screen existed the
 * auditor walked straight past every PDF — the crawl now records them
 * (`DiscoveryResult.documents`) instead of navigating Chromium into them, and
 * this is where those records become something an operator can act on.
 *
 * Two ways in, one rendering out:
 *
 * - **Scan** runs the same crawl as the setup screen and lists the documents
 *   it saw. Inspection is per-document and operator-chosen, not automatic —
 *   each inspection is a server-side fetch plus a JVM run, and on a 50-document
 *   site the operator should choose where to spend that.
 * - **Upload** posts a file the operator already has to the same instrument.
 *
 * Both flows go through the client-scoped routes
 * (`/api/platform/clients/<id>/documents`), which persist what the instrument
 * said — so an inspection outlives the tab, and the screen loads the stored
 * records back on mount. The client-unscoped tools
 * (`/api/documents/inspect*`) still exist for work outside a client.
 *
 * `summary.gaps` is rendered verbatim: each entry already names its WCAG
 * criterion, and the words were chosen server-side where the counting logic
 * lives. A screen that rephrased them would be a second copy free to drift.
 */

type DiscoveredDocument = { url: string; foundOn: string; kind: 'pdf' | 'docx' | 'doc' };

type DiscoveryResponse = {
  documents?: DiscoveredDocument[];
  documentsOmitted?: number;
  errors?: Array<{ url: string; message: string }>;
  error?: string;
};

type Summary = {
  title: string;
  titleText?: string;
  sourceLanguage: string | null;
  tagged: boolean;
  pages: number;
  headings: number;
  tables: number;
  lists: number;
  figures: number;
  gaps: string[];
};

/** One stored inspection, as the client-scoped routes return it. */
type InspectionRecord = {
  id: string;
  url: string;
  foundOn?: string;
  source: 'crawl' | 'upload';
  summary: Summary;
  inspectedAt: string;
};

type InspectionState =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'done'; summary: Summary }
  | { state: 'failed'; message: string };

const inputStyle = {
  fontFamily: FONT.mono,
  fontSize: 12,
  padding: '6px 9px',
  borderRadius: 7,
  border: `1px solid ${T.rule}`,
  background: T.surface,
  color: T.ink,
  minWidth: 0,
} as const;

const buttonStyle = {
  fontFamily: FONT.sans,
  fontSize: 12.5,
  fontWeight: 600,
  padding: '6px 12px',
  borderRadius: 8,
  border: `1px solid ${T.rule}`,
  background: T.surface,
  color: T.ink,
  cursor: 'pointer',
} as const;

const noteStyle = {
  margin: 0,
  fontFamily: FONT.sans,
  fontSize: 12.5,
  color: T.inkMuted,
} as const;

function disabledStyle(disabled: boolean) {
  return disabled
    ? { background: T.surfaceSunk, color: T.inkMuted, cursor: 'default' as const }
    : {};
}

/** The path half of a URL — what an operator recognises their document by. */
function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    // An upload's `url` is a filename, not a URL, and reads fine as itself.
    return url;
  }
}

/**
 * One inspection result, shared by the scan rows, the upload, and the stored
 * records.
 *
 * One component rather than three renderings, so a document found by crawl, a
 * document handed over by upload and a record loaded back from the store
 * cannot end up described differently.
 */
function SummaryView({ summary }: { summary: Summary }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 10px',
        borderRadius: 8,
        border: `1px solid ${T.rule}`,
        background: T.surfaceSunk,
      }}
    >
      <p style={{ ...noteStyle, color: T.ink }}>
        {summary.tagged ? 'Tagged' : 'Not tagged'} · {summary.pages}{' '}
        {summary.pages === 1 ? 'page' : 'pages'} · {summary.headings} headings ·{' '}
        {summary.tables} tables · {summary.figures} figures
        {summary.titleText ? ` · “${summary.titleText}”` : ' · no title'}
      </p>
      {summary.gaps.length === 0 ? (
        <p style={noteStyle}>No machine-detectable gaps.</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {summary.gaps.map((gap) => (
            <li key={gap} style={{ ...noteStyle, color: T.fail }}>
              {gap}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ClientDocuments({
  clientId,
  initialTargetUrl,
}: {
  clientId: string;
  initialTargetUrl: string;
}) {
  const fieldPrefix = useId();
  const [targetUrl, setTargetUrl] = useState(initialTargetUrl);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DiscoveredDocument[] | null>(null);
  const [documentsOmitted, setDocumentsOmitted] = useState(0);
  const [inspections, setInspections] = useState<Record<string, InspectionState>>({});
  const [uploadState, setUploadState] = useState<InspectionState>({ state: 'idle' });
  const [stored, setStored] = useState<InspectionRecord[] | null>(null);
  const [storedError, setStoredError] = useState<string | null>(null);

  const headingId = `${fieldPrefix}-heading`;
  const urlId = `${fieldPrefix}-url`;
  const uploadId = `${fieldPrefix}-upload`;
  const storedHeadingId = `${fieldPrefix}-stored`;

  const documentsPath = `/api/platform/clients/${encodeURIComponent(clientId)}/documents`;

  useEffect(() => {
    // The reason this screen exists in its persisted form: what was inspected
    // yesterday is still here today.
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(documentsPath);
        const payload = (await response.json().catch(() => null)) as {
          inspections?: InspectionRecord[];
          error?: string;
        } | null;
        if (cancelled) return;

        if (!response.ok) {
          setStoredError(`Stored inspections did not load (${payload?.error ?? `http ${response.status}`}).`);
          return;
        }
        setStored(payload?.inspections ?? []);
      } catch {
        if (!cancelled) setStoredError('Stored inspections did not load (could not reach the server).');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentsPath]);

  /** Newest first, replacing any earlier record of the same inspection. */
  function remember(record: InspectionRecord) {
    setStored((current) => [record, ...(current ?? []).filter((r) => r.id !== record.id)]);
  }

  async function scan() {
    setScanning(true);
    setScanError(null);
    try {
      const response = await fetch('/api/platform/discover', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetUrl: targetUrl.trim() }),
      });
      const payload = (await response.json().catch(() => null)) as DiscoveryResponse | null;

      if (!response.ok) {
        setScanError(`The scan failed (${payload?.error ?? `http ${response.status}`}).`);
        return;
      }

      setDocuments(payload?.documents ?? []);
      setDocumentsOmitted(payload?.documentsOmitted ?? 0);
      setInspections({});
    } catch {
      setScanError('Could not reach the server.');
    } finally {
      setScanning(false);
    }
  }

  function setInspection(url: string, state: InspectionState) {
    setInspections((current) => ({ ...current, [url]: state }));
  }

  async function inspect(doc: DiscoveredDocument) {
    setInspection(doc.url, { state: 'running' });
    try {
      const response = await fetch(documentsPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: doc.url, foundOn: doc.foundOn }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { inspection?: InspectionRecord; error?: string; detail?: string }
        | null;

      if (!response.ok || !payload?.inspection) {
        setInspection(doc.url, {
          state: 'failed',
          message: payload?.detail ?? payload?.error ?? `http ${response.status}`,
        });
        return;
      }
      setInspection(doc.url, { state: 'done', summary: payload.inspection.summary });
      remember(payload.inspection);
    } catch {
      setInspection(doc.url, { state: 'failed', message: 'could not reach the server' });
    }
  }

  async function inspectUpload(file: File) {
    setUploadState({ state: 'running' });
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch(documentsPath, { method: 'PUT', body: form });
      const payload = (await response.json().catch(() => null)) as
        | { inspection?: InspectionRecord; error?: string; detail?: string }
        | null;

      if (!response.ok || !payload?.inspection) {
        setUploadState({
          state: 'failed',
          message: payload?.detail ?? payload?.error ?? `http ${response.status}`,
        });
        return;
      }
      setUploadState({ state: 'done', summary: payload.inspection.summary });
      remember(payload.inspection);
    } catch {
      setUploadState({ state: 'failed', message: 'could not reach the server' });
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: 'clamp(14px,1.8vw,28px)',
        fontFamily: FONT.sans,
      }}
    >
      <h2 id={headingId} style={{ margin: 0, fontSize: 15, fontWeight: 700, color: T.ink }}>
        Documents
      </h2>
      <p style={noteStyle}>
        Documents linked from the client’s site — PDF and Word — found by the same crawl the setup
        screen runs. The crawl records them without opening them; inspection is per-document
        because each one costs a fetch and a JVM run. Every inspection is kept against this
        client.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8 }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 260px' }}>
          <label htmlFor={urlId} style={{ fontFamily: FONT.sans, fontSize: 11, color: T.inkMuted }}>
            Site to scan
          </label>
          <input
            id={urlId}
            type="url"
            value={targetUrl}
            onChange={(event) => setTargetUrl(event.target.value)}
            placeholder="https://client.example.gov"
            style={{ ...inputStyle, width: '100%' }}
          />
        </span>
        <button
          type="button"
          onClick={scan}
          disabled={scanning || targetUrl.trim() === ''}
          style={{ ...buttonStyle, ...disabledStyle(scanning || targetUrl.trim() === '') }}
        >
          {scanning ? 'Scanning…' : 'Scan the site'}
        </button>
      </div>

      {scanError ? (
        <p role="alert" style={{ ...noteStyle, color: T.fail }}>
          {scanError}
        </p>
      ) : null}

      {documents !== null ? (
        documents.length === 0 ? (
          <p style={noteStyle}>The crawl saw no document links.</p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {documents.map((doc) => {
              const inspection = inspections[doc.url] ?? { state: 'idle' };
              return (
                <li
                  key={doc.url}
                  style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                >
                  <span
                    style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
                  >
                    <span style={{ fontFamily: FONT.mono, fontSize: 12, color: T.ink }}>
                      {pathOf(doc.url)}
                    </span>
                    <span style={{ fontFamily: FONT.sans, fontSize: 11, color: T.inkMuted }}>
                      {doc.kind === 'pdf' ? 'PDF' : 'Word'} · found on {pathOf(doc.foundOn)}
                    </span>
                    {doc.kind === 'pdf' ? (
                      <button
                        type="button"
                        onClick={() => inspect(doc)}
                        disabled={inspection.state === 'running'}
                        style={{
                          ...buttonStyle,
                          marginLeft: 'auto',
                          ...disabledStyle(inspection.state === 'running'),
                        }}
                      >
                        {inspection.state === 'running' ? 'Inspecting…' : 'Inspect'}
                      </button>
                    ) : null}
                  </span>
                  {inspection.state === 'done' ? <SummaryView summary={inspection.summary} /> : null}
                  {inspection.state === 'failed' ? (
                    <p role="alert" style={{ ...noteStyle, color: T.fail }}>
                      Inspection failed: {inspection.message}.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {documents?.some((doc) => doc.kind !== 'pdf') ? (
        <p style={noteStyle}>
          {/* Stated rather than implied by a missing button. The absence is a
              capability fact, not a defect in the row. */}
          Word documents are recorded without an Inspect button — the inspection instrument reads
          PDFs. Word’s path is conversion to tagged PDF, which this screen does not run yet.
        </p>
      ) : null}

      {documentsOmitted > 0 ? (
        <p style={noteStyle}>
          {documentsOmitted} more document link{documentsOmitted === 1 ? '' : 's'} beyond the cap
          were not listed.
        </p>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor={uploadId} style={{ fontFamily: FONT.sans, fontSize: 11, color: T.inkMuted }}>
          Or inspect a PDF you already have
        </label>
        <input
          id={uploadId}
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void inspectUpload(file);
          }}
          style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.ink }}
        />
        {uploadState.state === 'running' ? <p style={noteStyle}>Inspecting…</p> : null}
        {uploadState.state === 'done' ? <SummaryView summary={uploadState.summary} /> : null}
        {uploadState.state === 'failed' ? (
          <p role="alert" style={{ ...noteStyle, color: T.fail }}>
            Inspection failed: {uploadState.message}.
          </p>
        ) : null}
      </div>

      {storedError ? (
        <p role="alert" style={{ ...noteStyle, color: T.fail }}>
          {storedError}
        </p>
      ) : null}

      {stored !== null && stored.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h3
            id={storedHeadingId}
            style={{ margin: 0, fontSize: 13, fontWeight: 700, color: T.ink }}
          >
            Previously inspected
          </h3>
          <ul
            aria-labelledby={storedHeadingId}
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {stored.map((record) => (
              <li key={record.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: FONT.mono, fontSize: 12, color: T.ink }}>
                    {pathOf(record.url)}
                  </span>
                  <span style={{ fontFamily: FONT.sans, fontSize: 11, color: T.inkMuted }}>
                    {record.source === 'upload'
                      ? 'uploaded'
                      : record.foundOn
                        ? `found on ${pathOf(record.foundOn)}`
                        : 'found by crawl'}
                  </span>
                  <span style={{ fontFamily: FONT.sans, fontSize: 11, color: T.inkMuted }}>
                    {/* The date half of the ISO stamp: stable across locales,
                        so the server-rendered and hydrated trees agree. */}
                    {record.inspectedAt.slice(0, 10)}
                  </span>
                </span>
                <SummaryView summary={record.summary} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
