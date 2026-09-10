'use client';

import { useEffect, useId, useState } from 'react';
import type { DocumentState } from '../../../../services/document-state';
import { clientHref } from '../../lib/params';
import { FONT, T } from '../../lib/tokens';
import { DocumentIntake } from './document-intake';
import { DocumentInventory } from './document-inventory';
import { DocumentDeliveryPanel } from './document-delivery-panel';
import {
  ACCEPT_PDF,
  ACCEPT_WORD,
  buttonStyle,
  conversionOutcome,
  disabledStyle,
  inspectOutcome,
  isFetchable,
  noteStyle,
  pathOf,
  pdfNameFor,
  pickFile,
  uploadForConversion,
  uploadForInspection,
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
  const [deliveryRevision, setDeliveryRevision] = useState(0);
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
      setDeliveryRevision(current => current + 1);
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

  /**
   * A document nobody can fetch is handed over instead.
   *
   * An upload's `url` is the filename it arrived under, and the by-URL routes
   * refuse that before they fetch anything — so every action on an uploaded
   * row used to answer "reload the page and try again", which reproduced it.
   * Asked for before the row goes busy, so closing the dialog leaves the row
   * as it was. `null` means the person changed their mind; `undefined` means
   * this document has an address and none is needed.
   */
  async function fileFor(doc: Pick<ClientDocument, 'url' | 'kind'>): Promise<File | null | undefined> {
    if (isFetchable(doc.url)) return undefined;
    return pickFile(doc.kind === 'pdf' ? ACCEPT_PDF : ACCEPT_WORD);
  }

  /** Resolves to whether a batch should stop here — see `inspectOutcome`. */
  async function inspect(doc: ClientDocument): Promise<boolean> {
    const file = await fileFor(doc);
    if (file === null) return false;

    setOutcome(doc.url, { state: 'running' });
    if (file !== undefined) {
      setOutcome(doc.url, await uploadForInspection(documentsPath, file, doc.id));
      void loadInventory();
      return false;
    }

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

  async function convert(doc: Pick<ClientDocument, 'id' | 'url' | 'kind' | 'foundOn'>): Promise<void> {
    const file = await fileFor(doc);
    if (file === null) return;

    setOutcome(doc.url, { state: 'running' });
    if (file !== undefined) {
      setOutcome(doc.url, await uploadForConversion(documentsPath, file, doc.id));
      void loadInventory();
      return;
    }

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
    const unreviewed = (documents ?? []).filter((doc) => doc.kind === 'pdf' && doc.state === 'not-reviewed');
    // Uploads are left out rather than walked: a batch that stopped at every
    // one of them to open a file dialog would be worse than not offering it.
    // Said, not silently skipped — a count that does not match the button's
    // is the kind of small discrepancy nobody investigates.
    const pending = unreviewed.filter((doc) => isFetchable(doc.url));
    const handedOver = unreviewed.length - pending.length;
    setBatch({ done: 0, total: pending.length });
    setBatchNote(
      handedOver === 0
        ? null
        : `${handedOver} uploaded ${handedOver === 1 ? 'document is' : 'documents are'} not included: run ${handedOver === 1 ? 'it' : 'them'} from ${handedOver === 1 ? 'its' : 'their'} own row, which asks for the file.`,
    );
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

  // Counts what the button will actually walk. Uploads are inspected from
  // their own row, which asks for the file; including them here would put a
  // number on the button that the batch then does not reach.
  const unreviewedPdfs = (documents ?? []).filter(
    (doc) => doc.kind === 'pdf' && doc.state === 'not-reviewed' && isFetchable(doc.url),
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
            {/* The third clause named the state whose chip reads "Passed
                automated checks", and said it "conforms" — the claim
                `SCOPE_EXPLAINER` denies and the reason that chip was
                relabelled. One screen cannot both make and deny it. */}
            Every document on record for this client, with one state each: what a person still
            has to answer, what is waiting on the client, and what has passed the automated
            checks.
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

      <DocumentDeliveryPanel clientId={clientId} revision={deliveryRevision} />

      {inventoryError ? (
        <p role="alert" style={{ ...noteStyle, color: T.fail }}>
          {inventoryError}
        </p>
      ) : null}

      {converter.checked && !converter.available && documents?.some((doc) => doc.kind !== 'pdf') ? (
        <p style={noteStyle}>
          {/* Stated rather than implied by a missing button, and stated where
              the rows are: the absence is a capability fact about this host,
              not a defect in the row.

              It said "Inspection reads PDFs", which the probe above cannot
              answer: `available: true` needs LibreOffice AND a Java runtime,
              so `false` means one of the two is missing and this screen
              cannot tell which. Where the missing half is the Java runtime,
              that clause promised an inspection that refuses on the first
              click.

              And it named LibreOffice as the missing half — first as "this
              deployment does not have it", then as "cannot run it", which is
              the same attribution with a different verb. From a flag that
              measures the pair, that sends an operator whose LibreOffice is
              installed and whose stages are uncompiled to reinstall software
              they already have. Settings reports the two halves separately,
              so the pointer goes there rather than a guess made here. */}
          Word documents are recorded without a Convert button: this host cannot convert them right
          now. Conversion needs both LibreOffice and the PDF stages, and this screen cannot tell
          which is missing — Settings reports them separately.
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
