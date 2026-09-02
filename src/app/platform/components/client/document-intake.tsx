'use client';

import { useId, useState } from 'react';
import { FONT, T } from '../../lib/tokens';
import { DocumentRunResult } from './document-run-result';
import {
  buttonStyle,
  conversionOutcome,
  disabledStyle,
  inputStyle,
  noteStyle,
  pdfNameFor,
  refusalMessage,
  type ActionOutcome,
  type Summary,
} from './document-shared';

/**
 * How documents get INTO the inventory: a site scan, a pasted address, or a
 * file in hand. One disclosure beside the heading rather than three forms
 * stacked under an unbounded list — the doors sit beside the room, and an
 * operator who is here to answer punch items never has to scroll past them.
 *
 * Open by default only while the inventory is empty, when the doors are the
 * whole screen.
 */

type ScanReport = {
  merge: { added: number; seenAgain: number };
  documentsOmitted: Partial<Record<'pdf' | 'docx' | 'doc', number>>;
  errors: number;
};

type AddByUrlState =
  | { state: 'idle' }
  | { state: 'running' }
  | { state: 'inspected'; summary: Summary }
  | { state: 'added-word' }
  | { state: 'failed'; message: string };

const labelStyle = { fontFamily: FONT.sans, fontSize: 11, color: T.inkMuted } as const;

export function DocumentIntake({
  documentsPath,
  initialTargetUrl,
  converterAvailable,
  openByDefault,
  onChanged,
}: {
  documentsPath: string;
  initialTargetUrl: string;
  converterAvailable: boolean;
  openByDefault: boolean;
  onChanged: () => void;
}) {
  const fieldPrefix = useId();
  const urlId = `${fieldPrefix}-url`;
  const addUrlId = `${fieldPrefix}-add-url`;
  const uploadId = `${fieldPrefix}-upload`;
  const wordUploadId = `${fieldPrefix}-word-upload`;

  const [targetUrl, setTargetUrl] = useState(initialTargetUrl);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanReport, setScanReport] = useState<ScanReport | null>(null);
  const [addUrl, setAddUrl] = useState('');
  const [addState, setAddState] = useState<AddByUrlState>({ state: 'idle' });
  const [uploadState, setUploadState] = useState<ActionOutcome>({ state: 'idle' });
  const [wordUploadState, setWordUploadState] = useState<ActionOutcome>({ state: 'idle' });

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
      onChanged();
    } catch {
      setScanError('Could not reach the server.');
    } finally {
      setScanning(false);
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
      if (!response.ok) {
        setAddState({ state: 'failed', message: await refusalMessage(response) });
        return;
      }
      const payload = (await response.json().catch(() => null)) as
        | { inspection?: { summary: Summary }; document?: { id: string } }
        | null;
      setAddState(
        payload?.inspection
          ? { state: 'inspected', summary: payload.inspection.summary }
          : { state: 'added-word' },
      );
      setAddUrl('');
      onChanged();
    } catch {
      setAddState({ state: 'failed', message: 'Could not reach the server.' });
    }
  }

  async function inspectUpload(file: File) {
    setUploadState({ state: 'running' });
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch(documentsPath, { method: 'PUT', body: form });
      if (!response.ok) {
        setUploadState({ state: 'failed', message: await refusalMessage(response) });
        return;
      }
      const payload = (await response.json().catch(() => null)) as
        | { inspection?: { summary: Summary } }
        | null;
      if (!payload?.inspection) {
        setUploadState({ state: 'failed', message: 'The server answered without a reading.' });
        return;
      }
      setUploadState({ state: 'done', summary: payload.inspection.summary, converted: false });
      onChanged();
    } catch {
      setUploadState({ state: 'failed', message: 'Could not reach the server.' });
    }
  }

  async function convertUpload(file: File) {
    setWordUploadState({ state: 'running' });
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch(`${documentsPath}/convert`, { method: 'PUT', body: form });
      setWordUploadState(await conversionOutcome(response, pdfNameFor(file.name)));
      onChanged();
    } catch {
      setWordUploadState({ state: 'failed', message: 'Could not reach the server.' });
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
    <details
      open={openByDefault}
      style={{
        border: `1px solid ${T.rule}`,
        borderRadius: 10,
        background: T.surface,
        padding: '8px 12px',
      }}
    >
      <summary style={{ cursor: 'pointer', fontFamily: FONT.sans, fontSize: 12.5, fontWeight: 600, color: T.ink }}>
        Add documents
      </summary>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8 }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: '1 1 260px' }}>
            <label htmlFor={urlId} style={labelStyle}>
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
        <p style={noteStyle}>A scan merges into the inventory; it never resets it.</p>
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor={addUrlId} style={labelStyle}>
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
          {addState.state === 'inspected' ? (
            <DocumentRunResult
              outcome={{ state: 'done', summary: addState.summary, converted: false }}
              previous={undefined}
            />
          ) : null}
          {addState.state === 'added-word' ? (
            <p style={noteStyle}>Added to the inventory as a Word document — convert it from its row.</p>
          ) : null}
          {addState.state === 'failed' ? (
            <p role="alert" style={{ ...noteStyle, color: T.fail }}>
              {addState.message}
            </p>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor={uploadId} style={labelStyle}>
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
          {uploadState.state === 'done' ? (
            <DocumentRunResult outcome={uploadState} previous={undefined} />
          ) : null}
          {uploadState.state === 'failed' ? (
            <p role="alert" style={{ ...noteStyle, color: T.fail }}>
              {uploadState.message}
            </p>
          ) : null}
        </div>

        {converterAvailable ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor={wordUploadId} style={labelStyle}>
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
            {wordUploadState.state === 'running' ? (
              <p style={noteStyle}>Converting… (up to 5 minutes)</p>
            ) : null}
            {wordUploadState.state === 'done' ? (
              <DocumentRunResult outcome={wordUploadState} previous={undefined} />
            ) : null}
            {wordUploadState.state === 'failed' ? (
              <p role="alert" style={{ ...noteStyle, color: T.fail }}>
                {wordUploadState.message}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}
