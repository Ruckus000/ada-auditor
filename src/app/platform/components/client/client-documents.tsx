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
  needs?: Array<{ criterion: string; item: string }>;
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
  latestConversion?: {
    id: string;
    summary: Summary;
    convertedAt: string;
    outputSha256: string;
    /** Whether the delivered file itself is retrievable from the server. */
    stored: boolean;
  };
  /**
   * A Word document in the same inventory shares this PDF's stem — its
   * conversion, not this file's punch list, is the remediation.
   */
  sourceAvailable?: { id: string; kind: 'docx' | 'doc'; url: string };
  /** The server's diff of the latest two readings. Absent on a first reading. */
  regression?: {
    status: 'unchanged' | 'improved' | 'regressed' | 'mixed';
    newGaps: string[];
    resolvedGaps: string[];
    unchangedCount: number;
    baselineAt?: string;
  };
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

/**
 * Adding a pasted address: the server fetches it, the BYTES decide what it
 * is (a municipal download endpoint rarely carries an extension), and the
 * answer is either an inspected PDF or a cataloged Word document.
 */
type AddByUrlState =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'inspected'; summary: Summary }
  | { state: 'added-word' }
  | { state: 'failed'; message: string };

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
/** What the operator has narrowed the inventory to. Server-side filters —
 * a filter that only sifted the loaded page would hide exactly the rows past
 * the cap it exists to find. */
type InventoryFilters = {
  kind?: 'pdf' | 'docx' | 'doc';
  hasGaps?: true;
  unreviewed?: true;
};

function inventoryQuery(
  filters: InventoryFilters,
  before?: { lastSeenAt: string; id: string },
): string {
  const params = new URLSearchParams();
  if (filters.kind) params.set('kind', filters.kind);
  if (filters.hasGaps) params.set('hasGaps', 'true');
  if (filters.unreviewed) params.set('unreviewed', 'true');
  if (before) {
    params.set('beforeLastSeenAt', before.lastSeenAt);
    params.set('beforeId', before.id);
  }
  const qs = params.toString();
  return qs === '' ? '' : `?${qs}`;
}

/** The inventory fetch, pure of component state so every caller shares it. */
async function fetchInventory(
  path: string,
  query = '',
): Promise<
  | { ok: true; documents: ClientDocument[]; hasMore: boolean }
  | { ok: false; message: string }
> {
  try {
    const response = await fetch(`${path}${query}`);
    const payload = (await response.json().catch(() => null)) as {
      documents?: ClientDocument[];
      hasMore?: boolean;
      error?: string;
    } | null;

    if (!response.ok) {
      return {
        ok: false,
        message: `The document inventory did not load (${payload?.error ?? `http ${response.status}`}).`,
      };
    }
    return { ok: true, documents: payload?.documents ?? [], hasMore: payload?.hasMore === true };
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
      {summary.needs && summary.needs.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* The punch list: each line is one thing a person still has to do.
              Rendered apart from the gaps because a gap states a failure and
              a need states the work. */}
          {summary.needs.map((need) => (
            <li key={need.item} style={noteStyle}>
              {need.criterion}: {need.item}
            </li>
          ))}
        </ul>
      ) : null}
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
  const [addUrl, setAddUrl] = useState('');
  const [addState, setAddState] = useState<AddByUrlState>({ state: 'idle' });
  const [filters, setFilters] = useState<InventoryFilters>({});
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const headingId = `${fieldPrefix}-heading`;
  const urlId = `${fieldPrefix}-url`;
  const addUrlId = `${fieldPrefix}-add-url`;
  const uploadId = `${fieldPrefix}-upload`;
  const wordUploadId = `${fieldPrefix}-word-upload`;

  const documentsPath = `/api/platform/clients/${encodeURIComponent(clientId)}/documents`;

  function applyInventory(
    result: Awaited<ReturnType<typeof fetchInventory>>,
  ): void {
    if (result.ok) {
      setInventoryError(null);
      setDocuments(result.documents);
      setHasMore(result.hasMore);
    } else {
      setInventoryError(result.message);
    }
  }

  /** Reload under the current filters, back to page one — the refresh every
   * mutating action calls. Paging state resets deliberately: a stale cursor
   * after a merge would page past rows the merge just refreshed upward. */
  async function loadInventory(): Promise<void> {
    applyInventory(await fetchInventory(documentsPath, inventoryQuery(filters)));
  }

  async function loadMore(): Promise<void> {
    const last = documents?.[documents.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const result = await fetchInventory(
        documentsPath,
        inventoryQuery(filters, { lastSeenAt: last.lastSeenAt, id: last.id }),
      );
      if (result.ok) {
        setInventoryError(null);
        setDocuments((current) => [...(current ?? []), ...result.documents]);
        setHasMore(result.hasMore);
      } else {
        setInventoryError(result.message);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    // The inventory is the screen: what was inspected or converted last week
    // is still here today. Re-runs when the filters change — the narrowing is
    // server-side, so a change is a new first page, not a sift of this one.
    let cancelled = false;

    (async () => {
      const result = await fetchInventory(documentsPath, inventoryQuery(filters));
      if (cancelled) return;
      if (result.ok) {
        setInventoryError(null);
        setDocuments(result.documents);
        setHasMore(result.hasMore);
      } else {
        setInventoryError(result.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentsPath, filters]);

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

  async function convert(doc: Pick<ClientDocument, 'url' | 'foundOn'>) {
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

  async function addByUrl() {
    setAddState({ state: 'running' });
    try {
      const response = await fetch(documentsPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: addUrl.trim() }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            inspection?: { summary: Summary };
            document?: { id: string };
            error?: string;
            detail?: string;
          }
        | null;

      if (!response.ok || (!payload?.inspection && !payload?.document)) {
        setAddState({
          state: 'failed',
          message: payload?.detail ?? payload?.error ?? `http ${response.status}`,
        });
        return;
      }
      setAddState(
        payload.inspection
          ? { state: 'inspected', summary: payload.inspection.summary }
          : { state: 'added-word' },
      );
      setAddUrl('');
      void loadInventory();
    } catch {
      setAddState({ state: 'failed', message: 'could not reach the server' });
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

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <label
            htmlFor={`${fieldPrefix}-kind`}
            style={{ fontFamily: FONT.sans, fontSize: 11, color: T.inkMuted }}
          >
            Kind
          </label>
          <select
            id={`${fieldPrefix}-kind`}
            value={filters.kind ?? ''}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                ...(event.target.value === ''
                  ? { kind: undefined }
                  : { kind: event.target.value as 'pdf' | 'docx' | 'doc' }),
              }))
            }
            style={{ ...inputStyle, fontFamily: FONT.sans }}
          >
            <option value="">All kinds</option>
            <option value="pdf">PDF</option>
            <option value="docx">Word (.docx)</option>
            <option value="doc">Word (.doc)</option>
          </select>
        </span>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: FONT.sans,
            fontSize: 12,
            color: T.ink,
          }}
        >
          <input
            type="checkbox"
            checked={filters.hasGaps === true}
            onChange={(event) =>
              // Mutually exclusive with never-reviewed: a document with gaps
              // has, by definition, been reviewed.
              setFilters((current) => ({
                ...current,
                hasGaps: event.target.checked ? true : undefined,
                ...(event.target.checked ? { unreviewed: undefined } : {}),
              }))
            }
          />
          With open gaps
        </label>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: FONT.sans,
            fontSize: 12,
            color: T.ink,
          }}
        >
          <input
            type="checkbox"
            checked={filters.unreviewed === true}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                unreviewed: event.target.checked ? true : undefined,
                ...(event.target.checked ? { hasGaps: undefined } : {}),
              }))
            }
          />
          Never reviewed
        </label>
      </div>

      {documents !== null ? (
        documents.length === 0 ? (
          <p style={noteStyle}>
            {filters.kind || filters.hasGaps || filters.unreviewed
              ? 'Nothing on record matches these filters.'
              : 'No documents on record yet — scan the site, or upload one.'}
          </p>
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
              // Conversion progress keys on the URL actually converted, so a
              // paired PDF reads the state of its Word source.
              const sourceConversion =
                doc.sourceAvailable === undefined
                  ? ({ state: 'idle' } as const)
                  : (conversions[doc.sourceAvailable.url] ?? { state: 'idle' });
              // A repair transcribes what the structure tree already says, so
              // an untagged PDF has nothing to repair FROM. Offered only once
              // a reading proves there is a tree — before that the honest
              // answer is "inspect it and find out", which is the button
              // already there.
              const latestReading = doc.latestConversion?.summary ?? doc.latestInspection?.summary;
              const repairable =
                doc.kind === 'pdf' && latestReading !== undefined && latestReading.tagged;
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
                    {doc.regression ? (
                      <span
                        style={{
                          fontFamily: FONT.sans,
                          fontSize: 11,
                          // Regressions demand attention; everything else is calm.
                          color:
                            doc.regression.status === 'regressed' ||
                            doc.regression.status === 'mixed'
                              ? T.fail
                              : T.inkMuted,
                        }}
                      >
                        since last inspection: {doc.regression.newGaps.length} new,{' '}
                        {doc.regression.resolvedGaps.length} resolved
                      </span>
                    ) : null}
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
                      <>
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
                        {doc.sourceAvailable && converter.available ? (
                          <button
                            type="button"
                            onClick={() => convert(doc.sourceAvailable!)}
                            disabled={sourceConversion.state === 'running'}
                            style={{ ...buttonStyle, ...disabledStyle(sourceConversion.state === 'running') }}
                          >
                            {sourceConversion.state === 'running'
                              ? 'Converting source…'
                              : 'Convert the Word source'}
                          </button>
                        ) : null}
                        {/* Repair writes back what the PDF already states.
                            Offered second where a Word source exists, because
                            converting the source is the better answer: it
                            reaches structure a repair never can. */}
                        {repairable ? (
                          <button
                            type="button"
                            onClick={() => convert(doc)}
                            disabled={conversion.state === 'running'}
                            style={{
                              ...buttonStyle,
                              ...disabledStyle(conversion.state === 'running'),
                            }}
                          >
                            {conversion.state === 'running' ? 'Repairing…' : 'Repair this PDF'}
                          </button>
                        ) : null}
                      </>
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
                  {doc.sourceAvailable ? (
                    <p style={noteStyle}>
                      Word source on record — converting the source is this PDF&apos;s
                      remediation, not repairing the PDF itself.
                    </p>
                  ) : null}
                  {doc.kind === 'pdf' &&
                  latestReading !== undefined &&
                  !latestReading.tagged &&
                  doc.sourceAvailable === undefined ? (
                    <p style={noteStyle}>
                      No structure tree, so there is nothing to transcribe — this one needs the
                      Word source it came from, or a person to tag it. Repairing it here would
                      mean inventing its headings and reading order.
                    </p>
                  ) : null}
                  {/* The stored record, rendered from the inventory itself —
                      no server call, and the same SummaryView every other
                      source renders through. */}
                  {expanded[doc.id] && doc.regression && doc.regression.newGaps.length > 0 ? (
                    <p style={{ ...noteStyle, color: T.fail }}>
                      New since last inspection: {doc.regression.newGaps.join(' · ')}
                    </p>
                  ) : null}
                  {expanded[doc.id] &&
                  doc.regression &&
                  doc.regression.resolvedGaps.length > 0 ? (
                    <p style={noteStyle}>
                      Resolved since last inspection: {doc.regression.resolvedGaps.join(' · ')}
                    </p>
                  ) : null}
                  {expanded[doc.id] && doc.latestInspection ? (
                    <SummaryView summary={doc.latestInspection.summary} />
                  ) : null}
                  {expanded[doc.id] && doc.latestConversion ? (
                    <>
                      {doc.latestConversion.stored ? (
                        <p style={noteStyle}>
                          <a
                            href={`${documentsPath}/conversions/${doc.latestConversion.id}`}
                          >
                            Download the delivered file
                          </a>{' '}
                          — exactly the bytes the stored hash names.
                        </p>
                      ) : null}
                      <SummaryView summary={doc.latestConversion.summary} />
                    </>
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

      {hasMore ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          style={{ ...buttonStyle, alignSelf: 'flex-start', ...disabledStyle(loadingMore) }}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
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
        <label
          htmlFor={addUrlId}
          style={{ fontFamily: FONT.sans, fontSize: 11, color: T.inkMuted }}
        >
          Add a document by URL
        </label>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <input
            id={addUrlId}
            type="url"
            value={addUrl}
            onChange={(event) => setAddUrl(event.target.value)}
            placeholder="https://client.example.gov/download?id=123"
            style={{ ...inputStyle, flex: '1 1 260px' }}
          />
          <button
            type="button"
            onClick={addByUrl}
            disabled={addState.state === 'running' || addUrl.trim() === ''}
            style={{
              ...buttonStyle,
              ...disabledStyle(addState.state === 'running' || addUrl.trim() === ''),
            }}
          >
            {addState.state === 'running' ? 'Fetching…' : 'Add'}
          </button>
        </span>
        <p style={noteStyle}>
          The server fetches it and the bytes decide what it is — a download link with no file
          extension works fine.
        </p>
        {addState.state === 'inspected' ? <SummaryView summary={addState.summary} /> : null}
        {addState.state === 'added-word' ? (
          <p style={noteStyle}>
            Added to the inventory as a Word document — convert it from its row above.
          </p>
        ) : null}
        {addState.state === 'failed' ? (
          <p role="alert" style={{ ...noteStyle, color: T.fail }}>
            Could not add it: {addState.message}.
          </p>
        ) : null}
      </div>

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
