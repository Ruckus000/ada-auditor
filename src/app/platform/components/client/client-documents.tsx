'use client';

import { useEffect, useId, useState } from 'react';
import type { DocumentState } from '../../../../services/document-state';
import { clientHref } from '../../lib/params';
import { FONT, T } from '../../lib/tokens';
import { DocumentIntake } from './document-intake';
import { DocumentInventory } from './document-inventory';
import {
  buttonStyle,
  conversionOutcome,
  disabledStyle,
  inspectOutcome,
  noteStyle,
  pathOf,
  pdfNameFor,
  type ActionOutcome,
  type ClientDocument,
  type StateCounts,
} from './document-shared';

/**
 * The client's document inventory — the work screen.
 *
 * Every row is a `client_documents` record with one derived STATE, and the
 * screen is organised around what an operator does next: the counts by state
 * lead, the table sorts the operator's own work above work blocked on the
 * client, and the doors documents come in through sit in one disclosure
 * beside the heading. What was inspected or converted last week is still
 * here today; a scan merges and never resets.
 *
 * Actions are per-document and operator-chosen — each is a fetch plus
 * external processes — except "Inspect all", which walks the not-reviewed
 * PDFs one at a time and says where it is.
 *
 * Conversion needs LibreOffice, which only some hosts have, so the screen
 * asks the conversion route up front (`GET /api/documents/remediate`) and
 * offers only what this deployment can do; where it cannot, the absence is
 * stated in words rather than implied by a missing button.
 */

type ConverterState = { checked: boolean; available: boolean };

function inventoryQuery(state: DocumentState | undefined, before?: { lastSeenAt: string; id: string }): string {
  const params = new URLSearchParams();
  if (state) params.set('state', state);
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
  | { ok: true; documents: ClientDocument[]; hasMore: boolean; counts: StateCounts | null }
  | { ok: false; message: string }
> {
  try {
    const response = await fetch(`${path}${query}`);
    const payload = (await response.json().catch(() => null)) as {
      documents?: ClientDocument[];
      hasMore?: boolean;
      counts?: StateCounts;
      error?: string;
    } | null;

    if (!response.ok) {
      return {
        ok: false,
        message: `The document inventory did not load (${payload?.error ?? `http ${response.status}`}).`,
      };
    }
    return {
      ok: true,
      documents: payload?.documents ?? [],
      hasMore: payload?.hasMore === true,
      counts: payload?.counts ?? null,
    };
  } catch {
    return { ok: false, message: 'The document inventory did not load (could not reach the server).' };
  }
}

export function ClientDocuments({
  clientId,
  initialTargetUrl,
}: {
  clientId: string;
  initialTargetUrl: string;
}) {
  const headingId = `${useId()}-heading`;
  const [documents, setDocuments] = useState<ClientDocument[] | null>(null);
  const [counts, setCounts] = useState<StateCounts | null>(null);
  const [inventoryError, setInventoryError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, ActionOutcome>>({});
  const [converter, setConverter] = useState<ConverterState>({ checked: false, available: false });
  const [stateFilter, setStateFilter] = useState<DocumentState | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [batchNote, setBatchNote] = useState<string | null>(null);

  const documentsPath = `/api/platform/clients/${encodeURIComponent(clientId)}/documents`;

  function applyInventory(result: Awaited<ReturnType<typeof fetchInventory>>): void {
    if (result.ok) {
      setInventoryError(null);
      setDocuments(result.documents);
      setHasMore(result.hasMore);
      setCounts(result.counts);
    } else {
      setInventoryError(result.message);
    }
  }

  /** Reload under the current filter, back to page one — the refresh every
   * mutating action calls. */
  async function loadInventory(): Promise<void> {
    applyInventory(await fetchInventory(documentsPath, inventoryQuery(stateFilter)));
  }

  async function loadMore(): Promise<void> {
    const last = documents?.[documents.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const result = await fetchInventory(
        documentsPath,
        inventoryQuery(stateFilter, { lastSeenAt: last.lastSeenAt, id: last.id }),
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
    // The inventory is the screen. Re-runs when the filter changes — the
    // narrowing is server-side, so a change is a new first page.
    let cancelled = false;
    (async () => {
      const result = await fetchInventory(documentsPath, inventoryQuery(stateFilter));
      if (!cancelled) applyInventory(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [documentsPath, stateFilter]);

  useEffect(() => {
    // Ask the conversion route itself whether this host can convert. Any
    // failure to answer reads as "cannot": a missing button on a capable host
    // is an inconvenience, a button on an incapable one is a promise the
    // deployment cannot keep.
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/documents/remediate');
        const payload = (await response.json().catch(() => null)) as { available?: boolean } | null;
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

  function setOutcome(url: string, outcome: ActionOutcome) {
    setOutcomes((current) => {
      // A re-conversion replaces the object URL; revoke the old one rather
      // than letting blobs accumulate for the life of the tab.
      const previous = current[url];
      if (previous?.state === 'done' && previous.href) URL.revokeObjectURL(previous.href);
      return { ...current, [url]: outcome };
    });
  }

  /** Resolves to whether a batch should stop here — see `inspectOutcome`. */
  async function inspect(doc: ClientDocument): Promise<boolean> {
    setOutcome(doc.url, { state: 'running' });
    try {
      const response = await fetch(documentsPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: doc.url,
          ...(doc.foundOn === undefined ? {} : { foundOn: doc.foundOn }),
        }),
      });
      const { outcome, halts } = await inspectOutcome(response);
      setOutcome(doc.url, outcome);
      if (outcome.state === 'done') void loadInventory();
      return halts;
    } catch {
      setOutcome(doc.url, { state: 'failed', message: 'Could not reach the server.' });
      return false;
    }
  }

  async function convert(doc: Pick<ClientDocument, 'url' | 'foundOn'>): Promise<void> {
    setOutcome(doc.url, { state: 'running' });
    try {
      const response = await fetch(`${documentsPath}/convert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: doc.url,
          ...(doc.foundOn === undefined ? {} : { foundOn: doc.foundOn }),
        }),
      });
      setOutcome(doc.url, await conversionOutcome(response, pdfNameFor(pathOf(doc.url))));
      void loadInventory();
    } catch {
      setOutcome(doc.url, { state: 'failed', message: 'Could not reach the server.' });
    }
  }

  /** The not-reviewed PDFs, one at a time, with progress in words. Sequential
   * on purpose: each is a fetch plus a JVM, and two at once on a shared host
   * is how a run gets a timeout nobody can explain. */
  async function inspectAllUnreviewed(): Promise<void> {
    const pending = (documents ?? []).filter((doc) => doc.kind === 'pdf' && doc.state === 'not-reviewed');
    setBatch({ done: 0, total: pending.length });
    setBatchNote(null);
    for (const [index, doc] of pending.entries()) {
      if (await inspect(doc)) {
        // The document ceiling is spent; every row after this one would say
        // the same thing. The refused row's own message says when it resets.
        setBatchNote(
          `Stopped after ${index} of ${pending.length}: document work is capped for now. The last row says when it resets.`,
        );
        break;
      }
      setBatch({ done: index + 1, total: pending.length });
    }
    setBatch(null);
  }

  const unreviewedPdfs = (documents ?? []).filter(
    (doc) => doc.kind === 'pdf' && doc.state === 'not-reviewed',
  ).length;

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
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 id={headingId} style={{ margin: 0, fontSize: 15, fontWeight: 700, color: T.ink }}>
            Documents
          </h2>
          <p style={noteStyle}>
            Every document on record for this client, with one state each: what a person still
            has to answer, what is waiting on the client, and what conforms.
          </p>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          {converter.checked ? (
            <DocumentIntake
              documentsPath={documentsPath}
              initialTargetUrl={initialTargetUrl}
              converterAvailable={converter.available}
              openByDefault={documents !== null && documents.length === 0}
              onChanged={() => void loadInventory()}
            />
          ) : null}
          {unreviewedPdfs > 0 ? (
            <button
              type="button"
              onClick={() => void inspectAllUnreviewed()}
              disabled={batch !== null}
              style={{ ...buttonStyle, ...disabledStyle(batch !== null) }}
            >
              {batch === null
                ? `Inspect all unreviewed PDFs (${unreviewedPdfs})`
                : `Inspecting ${batch.done} of ${batch.total} — keep this tab open`}
            </button>
          ) : null}
          {batchNote !== null ? (
            <p role="status" style={{ ...noteStyle, maxWidth: 360, textAlign: 'right' }}>
              {batchNote}
            </p>
          ) : null}
        </span>
      </div>

      {inventoryError ? (
        <p role="alert" style={{ ...noteStyle, color: T.fail }}>
          {inventoryError}
        </p>
      ) : null}

      {converter.checked && !converter.available && documents?.some((doc) => doc.kind !== 'pdf') ? (
        <p style={noteStyle}>
          {/* Stated rather than implied by a missing button, and stated where
              the rows are: the absence is a capability fact about this
              deployment, not a defect in the row. */}
          Word documents are recorded without a Convert button — conversion runs where LibreOffice
          is installed, and this deployment does not have it. Inspection reads PDFs.
        </p>
      ) : null}

      {documents !== null && converter.checked ? (
        <DocumentInventory
          documents={documents}
          counts={counts}
          stateFilter={stateFilter}
          onStateFilter={setStateFilter}
          converterAvailable={converter.available}
          outcomes={outcomes}
          onInspect={(doc) => void inspect(doc)}
          onConvert={(doc) => void convert(doc)}
          documentsPath={documentsPath}
          inventoryHref={clientHref(clientId, 'documents')}
        />
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
    </section>
  );
}
