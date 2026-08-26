'use client';

import { useEffect, useId, useState } from 'react';
import { FONT, T } from '../../lib/tokens';

/**
 * The client's document inventory — the entity screen, not a scan screen.
 *
 * Every row is a `client_documents` record: found by a crawl, or handed over
 * by the operator, with the latest word on it (inspection, conversion)
 * attached. A scan MERGES into this inventory server-side
 * (`documents/discover`), so what an operator inspected last week is still
 * here today and a re-scan refreshes rather than resets.
 *
 * Actions are per-document and operator-chosen, not automatic — each is a
 * fetch plus external processes, and on a 200-document inventory the
 * operator should choose where to spend that:
 *
 * - PDF rows **inspect** (`POST …/documents`), persisting the reading.
 * - Word rows **convert** to tagged PDF (`POST …/documents/convert`),
 *   persisting the audit-trail record — hashes and the pipeline's account —
 *   while the file itself goes to the operator as a download.
 * - Uploads do the same for documents already in hand.
 *
 * Conversion needs LibreOffice, which only some hosts have, so the screen
 * asks the conversion route up front (`GET /api/documents/remediate` — the
 * function that would convert is the only surface whose answer is honest)
 * and offers only what this deployment can do; where it cannot, the absence
 * is stated in words rather than implied by a missing button.
 *
 * `summary.gaps` is rendered verbatim: each entry already names its WCAG
 * criterion, and the words were chosen server-side where the counting logic
 * lives. A screen that rephrased them would be a second copy free to drift.
 */

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

/** One inventory row, as the client-scoped GET returns it. */
type ClientDocument = {
  id: string;
  url: string;
  kind: 'pdf' | 'docx' | 'doc';
  source: 'crawl' | 'upload';
  foundOn?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  latestInspection?: { summary: Summary; inspectedAt: string };
  latestConversion?: { summary: Summary; convertedAt: string; outputSha256: string };
};

type ScanReport = {
  merge: { added: number; seenAgain: number };
  documentsOmitted: Partial<Record<'pdf' | 'docx' | 'doc', number>>;
  errors: number;
};

type InspectionState =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'done'; summary: Summary }
  | { state: 'failed'; message: string };

/**
 * One conversion: the remediated file (as an object URL the operator can
 * download) plus the pipeline's own account of what it produced.
 */
type ConversionState =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'done'; summary: Summary; href: string; filename: string }
  | { state: 'failed'; message: string };

/**
 * Whether this deployment can convert at all, asked of the conversion route
 * itself. Until the answer arrives, nothing conversion-shaped renders: a
 * button that appears and then vanishes is worse than one that arrives a
 * moment late.
 */
type ConverterState = { checked: boolean; available: boolean };

/** `agenda.docx` → `agenda-remediated.pdf`, purely for the download's name. */
function pdfNameFor(sourceName: string): string {
  // CDN-hosted documents routinely carry a query (`/blob.docx?ver=2`); the
  // download's name wants neither it nor a fragment.
  const base = sourceName.split(/[?#]/)[0].split('/').pop() ?? '';
  return `${(base.replace(/\.docx?$/i, '') || 'document')}-remediated.pdf`;
}

/**
 * The conversion response is the PDF itself, with the summary riding in a
 * header — one request, both halves. A refusal is JSON, same as everywhere.
 */
/** The inventory fetch, pure of component state so every caller shares it. */
async function fetchInventory(
  path: string,
): Promise<{ ok: true; documents: ClientDocument[] } | { ok: false; message: string }> {
  try {
    const response = await fetch(path);
    const payload = (await response.json().catch(() => null)) as {
      documents?: ClientDocument[];
      error?: string;
    } | null;

    if (!response.ok) {
      return {
        ok: false,
        message: `The document inventory did not load (${payload?.error ?? `http ${response.status}`}).`,
      };
    }
    return { ok: true, documents: payload?.documents ?? [] };
  } catch {
    return { ok: false, message: 'The document inventory did not load (could not reach the server).' };
  }
}

async function conversionOutcome(response: Response, filename: string): Promise<ConversionState> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; detail?: string }
      | null;
    return {
      state: 'failed',
      message: payload?.detail ?? payload?.error ?? `http ${response.status}`,
    };
  }

  let summary: Summary;
  try {
    summary = JSON.parse(response.headers.get('x-remediation-summary') ?? '') as Summary;
  } catch {
    return { state: 'failed', message: 'the response carried no summary' };
  }

  const href = URL.createObjectURL(await response.blob());
  return { state: 'done', summary, href, filename };
}

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
 * Where a document lives, as an operator should read it: the bare path when
 * it sits on the same host as the page that linked it, host and path when it
 * does not. Website-builder platforms host every document on their own CDN —
 * measured on a real municipal site — so a bare path would routinely hide
 * where the client's documents actually are.
 */
function documentLabel(doc: ClientDocument): string {
  try {
    const url = new URL(doc.url);
    const sameHost =
      doc.foundOn === undefined || url.hostname === new URL(doc.foundOn).hostname;
    return sameHost ? `${url.pathname}${url.search}` : `${url.hostname}${url.pathname}${url.search}`;
  } catch {
    return doc.url;
  }
}

/**
 * What the row says about a document's lifecycle before any action this
 * session: kind, provenance, and the latest word on record. Dates as the
 * date half of the ISO stamp — stable across locales, so the server-rendered
 * and hydrated trees agree.
 */
function statusLine(doc: ClientDocument): string {
  const parts = [
    doc.kind === 'pdf' ? 'PDF' : 'Word',
    doc.source === 'upload' ? 'uploaded' : `found on ${pathOf(doc.foundOn ?? '')}`.trim(),
    `seen ${doc.lastSeenAt.slice(0, 10)}`,
  ];
  if (doc.latestInspection) {
    const gaps = doc.latestInspection.summary.gaps.length;
    parts.push(
      `inspected ${doc.latestInspection.inspectedAt.slice(0, 10)} — ${
        gaps === 0 ? 'no machine-detectable gaps' : `${gaps} gap${gaps === 1 ? '' : 's'}`
      }`,
    );
  }
  if (doc.latestConversion) {
    parts.push(`converted ${doc.latestConversion.convertedAt.slice(0, 10)}`);
  }
  return parts.join(' · ');
}

/**
 * One conversion result, shared by the rows and the Word upload — the same
 * single-rendering rule `SummaryView` follows, one level up. The summary
 * below it describes the **converted** file, so its remaining gaps are the
 * honest residue: conversion closes tagging and carries title and language
 * through, and what it cannot close stays red.
 */
function ConversionView({ conversion }: { conversion: ConversionState & { state: 'done' } }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <p style={{ ...noteStyle, color: T.ink }}>
        Converted to tagged PDF.
        {conversion.summary.title === 'transcribed'
          ? ' The title was transcribed from the document’s own first heading.'
          : ''}{' '}
        <a href={conversion.href} download={conversion.filename}>
          Download {conversion.filename}
        </a>
      </p>
      <SummaryView summary={conversion.summary} />
    </div>
  );
}

/**
 * One inspection result, shared by every source of one — an action this
 * session, an upload — so a document cannot end up described differently
 * depending on how its summary arrived.
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
  const [scanReport, setScanReport] = useState<ScanReport | null>(null);
  const [documents, setDocuments] = useState<ClientDocument[] | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [inspections, setInspections] = useState<Record<string, InspectionState>>({});
  const [conversions, setConversions] = useState<Record<string, ConversionState>>({});
  const [uploadState, setUploadState] = useState<InspectionState>({ state: 'idle' });
  const [wordUploadState, setWordUploadState] = useState<ConversionState>({ state: 'idle' });
  const [converter, setConverter] = useState<ConverterState>({ checked: false, available: false });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const headingId = `${fieldPrefix}-heading`;
  const urlId = `${fieldPrefix}-url`;
  const uploadId = `${fieldPrefix}-upload`;
  const wordUploadId = `${fieldPrefix}-word-upload`;

  const documentsPath = `/api/platform/clients/${encodeURIComponent(clientId)}/documents`;

  function applyInventory(
    result: Awaited<ReturnType<typeof fetchInventory>>,
  ): void {
    if (result.ok) {
      setInventoryError(null);
      setDocuments(result.documents);
    } else {
      setInventoryError(result.message);
    }
  }

  async function loadInventory(): Promise<void> {
    applyInventory(await fetchInventory(documentsPath));
  }

  useEffect(() => {
    // The inventory is the screen: what was inspected or converted last week
    // is still here today.
    let cancelled = false;

    (async () => {
      const result = await fetchInventory(documentsPath);
      if (cancelled) return;
      if (result.ok) {
        setInventoryError(null);
        setDocuments(result.documents);
      } else {
        setInventoryError(result.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentsPath]);

  useEffect(() => {
    // Ask the conversion route itself whether this host can convert. Any
    // failure to answer reads as "cannot": a missing button on a capable host
    // is an inconvenience, a button on an incapable one is a promise the
    // deployment cannot keep.
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch('/api/documents/remediate');
        const payload = (await response.json().catch(() => null)) as
          | { available?: boolean }
          | null;
        if (!cancelled) {
          setConverter({ checked: true, available: response.ok && payload?.available === true });
        }
      } catch {
        if (!cancelled) setConverter({ checked: true, available: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function scan() {
    setScanning(true);
    setScanError(null);
    try {
      const response = await fetch(`${documentsPath}/discover`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetUrl: targetUrl.trim() }),
      });
      const payload = (await response.json().catch(() => null)) as {
        merge?: { added: number; seenAgain: number };
        documentsOmitted?: Partial<Record<'pdf' | 'docx' | 'doc', number>>;
        errors?: unknown[];
        error?: string;
      } | null;

      if (!response.ok) {
        setScanError(`The scan failed (${payload?.error ?? `http ${response.status}`}).`);
        return;
      }

      setScanReport({
        merge: payload?.merge ?? { added: 0, seenAgain: 0 },
        documentsOmitted: payload?.documentsOmitted ?? {},
        errors: payload?.errors?.length ?? 0,
      });
      // The server merged; the inventory is the truth to render.
      await loadInventory();
    } catch {
      setScanError('Could not reach the server.');
    } finally {
      setScanning(false);
    }
  }

  function setInspection(url: string, state: InspectionState) {
    setInspections((current) => ({ ...current, [url]: state }));
  }

  function setConversion(url: string, state: ConversionState) {
    setConversions((current) => {
      // A re-conversion replaces the object URL; revoke the old one rather
      // than letting blobs accumulate for the life of the tab.
      const previous = current[url];
      if (previous?.state === 'done') URL.revokeObjectURL(previous.href);
      return { ...current, [url]: state };
    });
  }

  async function inspect(doc: ClientDocument) {
    setInspection(doc.url, { state: 'running' });
    try {
      const response = await fetch(documentsPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: doc.url,
          ...(doc.foundOn === undefined ? {} : { foundOn: doc.foundOn }),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { inspection?: { summary: Summary }; error?: string; detail?: string }
        | null;

      if (!response.ok || !payload?.inspection) {
        setInspection(doc.url, {
          state: 'failed',
          message: payload?.detail ?? payload?.error ?? `http ${response.status}`,
        });
        return;
      }
      setInspection(doc.url, { state: 'done', summary: payload.inspection.summary });
      void loadInventory();
    } catch {
      setInspection(doc.url, { state: 'failed', message: 'could not reach the server' });
    }
  }

  async function convert(doc: ClientDocument) {
    setConversion(doc.url, { state: 'running' });
    try {
      const response = await fetch(`${documentsPath}/convert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: doc.url,
          ...(doc.foundOn === undefined ? {} : { foundOn: doc.foundOn }),
        }),
      });
      setConversion(doc.url, await conversionOutcome(response, pdfNameFor(pathOf(doc.url))));
      void loadInventory();
    } catch {
      setConversion(doc.url, { state: 'failed', message: 'could not reach the server' });
    }
  }

  async function inspectUpload(file: File) {
    setUploadState({ state: 'running' });
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch(documentsPath, { method: 'PUT', body: form });
      const payload = (await response.json().catch(() => null)) as
        | { inspection?: { summary: Summary }; error?: string; detail?: string }
        | null;

      if (!response.ok || !payload?.inspection) {
        setUploadState({
          state: 'failed',
          message: payload?.detail ?? payload?.error ?? `http ${response.status}`,
        });
        return;
      }
      setUploadState({ state: 'done', summary: payload.inspection.summary });
      void loadInventory();
    } catch {
      setUploadState({ state: 'failed', message: 'could not reach the server' });
    }
  }

  async function convertUpload(file: File) {
    setWordUploadState({ state: 'running' });
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch(`${documentsPath}/convert`, { method: 'PUT', body: form });
      setWordUploadState(await conversionOutcome(response, pdfNameFor(file.name)));
      void loadInventory();
    } catch {
      setWordUploadState({ state: 'failed', message: 'could not reach the server' });
    }
  }

  const omittedEntries = scanReport
    ? (
        [
          ['pdf', 'PDF'],
          ['docx', 'Word (.docx)'],
          ['doc', 'Word (.doc)'],
        ] as const
      ).filter(([kind]) => (scanReport.documentsOmitted[kind] ?? 0) > 0)
    : [];

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
        Every document on record for this client — PDF and Word, found by scans or handed over —
        with the latest inspection and conversion beside it. A scan merges into this inventory;
        it never resets it.
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

      {scanReport ? (
        <p style={noteStyle}>
          Scan finished: {scanReport.merge.added} new document
          {scanReport.merge.added === 1 ? '' : 's'}, {scanReport.merge.seenAgain} seen again
          {scanReport.errors > 0
            ? `, ${scanReport.errors} page${scanReport.errors === 1 ? '' : 's'} unreadable`
            : ''}
          .
          {omittedEntries.length > 0
            ? ` Beyond the per-kind cap: ${omittedEntries
                .map(
                  ([kind, label]) =>
                    `${scanReport.documentsOmitted[kind]} more ${label} link${
                      scanReport.documentsOmitted[kind] === 1 ? '' : 's'
                    }`,
                )
                .join(', ')} not listed.`
            : ''}
        </p>
      ) : null}

      {inventoryError ? (
        <p role="alert" style={{ ...noteStyle, color: T.fail }}>
          {inventoryError}
        </p>
      ) : null}

      {documents !== null ? (
        documents.length === 0 ? (
          <p style={noteStyle}>No documents on record yet — scan the site, or upload one.</p>
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
              const conversion = conversions[doc.url] ?? { state: 'idle' };
              const hasRecord =
                doc.latestInspection !== undefined || doc.latestConversion !== undefined;
              return (
                <li key={doc.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span
                    style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
                  >
                    <span style={{ fontFamily: FONT.mono, fontSize: 12, color: T.ink }}>
                      {documentLabel(doc)}
                    </span>
                    <span style={{ fontFamily: FONT.sans, fontSize: 11, color: T.inkMuted }}>
                      {statusLine(doc)}
                    </span>
                    {hasRecord ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpanded((current) => ({ ...current, [doc.id]: !current[doc.id] }))
                        }
                        style={buttonStyle}
                      >
                        {expanded[doc.id] ? 'Hide details' : 'Details'}
                      </button>
                    ) : null}
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
                    ) : converter.available ? (
                      <button
                        type="button"
                        onClick={() => convert(doc)}
                        disabled={conversion.state === 'running'}
                        style={{
                          ...buttonStyle,
                          marginLeft: 'auto',
                          ...disabledStyle(conversion.state === 'running'),
                        }}
                      >
                        {conversion.state === 'running' ? 'Converting…' : 'Convert to tagged PDF'}
                      </button>
                    ) : null}
                  </span>
                  {/* The stored record, rendered from the inventory itself —
                      no server call, and the same SummaryView every other
                      source renders through. */}
                  {expanded[doc.id] && doc.latestInspection ? (
                    <SummaryView summary={doc.latestInspection.summary} />
                  ) : null}
                  {expanded[doc.id] && doc.latestConversion ? (
                    <SummaryView summary={doc.latestConversion.summary} />
                  ) : null}
                  {inspection.state === 'done' ? <SummaryView summary={inspection.summary} /> : null}
                  {inspection.state === 'failed' ? (
                    <p role="alert" style={{ ...noteStyle, color: T.fail }}>
                      Inspection failed: {inspection.message}.
                    </p>
                  ) : null}
                  {conversion.state === 'done' ? <ConversionView conversion={conversion} /> : null}
                  {conversion.state === 'failed' ? (
                    <p role="alert" style={{ ...noteStyle, color: T.fail }}>
                      Conversion failed: {conversion.message}.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {converter.checked &&
      !converter.available &&
      documents?.some((doc) => doc.kind !== 'pdf') ? (
        <p style={noteStyle}>
          {/* Stated rather than implied by a missing button. The absence is a
              capability fact about this deployment, not a defect in the row. */}
          Word documents are recorded without a Convert button — conversion runs where LibreOffice
          is installed, and this deployment does not have it. Inspection reads PDFs.
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

      {converter.available ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label
            htmlFor={wordUploadId}
            style={{ fontFamily: FONT.sans, fontSize: 11, color: T.inkMuted }}
          >
            Or convert a Word document you already have
          </label>
          <input
            id={wordUploadId}
            type="file"
            accept=".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void convertUpload(file);
            }}
            style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.ink }}
          />
          {wordUploadState.state === 'running' ? <p style={noteStyle}>Converting…</p> : null}
          {wordUploadState.state === 'done' ? (
            <ConversionView conversion={wordUploadState} />
          ) : null}
          {wordUploadState.state === 'failed' ? (
            <p role="alert" style={{ ...noteStyle, color: T.fail }}>
              Conversion failed: {wordUploadState.message}.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
