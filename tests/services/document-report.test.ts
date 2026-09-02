import { describe, expect, it } from 'vitest';
import { buildDocumentReport } from '../../src/services/document-report';
import type { ClientDocumentRecord } from '../../src/domain/platform';
import type { RemediationSummary } from '../../src/domain/document-remediation';

/**
 * The report snapshot builder. Pure over inventory records, so every rule it
 * encodes — latest-reading-wins, unread-counts-but-says-nothing, no
 * `titleText` on a public page — is assertable without a store.
 */

function summary(overrides: Partial<RemediationSummary> = {}): RemediationSummary {
  return {
    title: 'already-titled',
    titleText: 'Objection of Jane Doe',
    sourceLanguage: 'en-US',
    tagged: false,
    pages: 4,
    headings: 0,
    tables: 0,
    lists: 0,
    figures: 3,
    gaps: ['1.1.1: 3 figures with no alt text'],
    ...overrides,
  };
}

function doc(overrides: Partial<ClientDocumentRecord> = {}): ClientDocumentRecord {
  return {
    id: 'doc-1',
    clientId: 'acme',
    url: 'https://town.example/minutes/agenda.pdf',
    kind: 'pdf',
    source: 'crawl',
    foundOn: 'https://town.example/meetings',
    firstSeenAt: '2026-08-26T09:00:00.000Z',
    lastSeenAt: '2026-08-26T09:00:00.000Z',
    ...overrides,
  };
}

const AT = '2026-08-26T12:00:00.000Z';

describe('buildDocumentReport', () => {
  it('totals the inventory and lists only what was read', async () => {
    const section = buildDocumentReport(
      [
        doc({
          id: 'doc-read',
          latestInspection: { ...inspection('2026-08-26T09:00:00.000Z') },
        }),
        doc({ id: 'doc-unread', url: 'https://town.example/permit.docx', kind: 'docx' }),
      ],
      AT,
    );

    expect(section.capturedAt).toBe(AT);
    expect(section.totals).toEqual({
      documents: 2,
      byKind: { pdf: 1, docx: 1 },
      read: 1,
      withGaps: 1,
      unread: 1,
    });
    // Unread documents are counted but contribute no gap lines — a gap list
    // comes from an instrument reading, not from absence.
    expect(section.entries).toHaveLength(1);
    expect(section.entries[0].url).toBe('https://town.example/minutes/agenda.pdf');
    expect(section.entries[0].gaps).toEqual(['1.1.1: 3 figures with no alt text']);
  });

  it('the latest reading wins: a newer conversion speaks for the document', () => {
    const section = buildDocumentReport(
      [
        doc({
          latestInspection: inspection('2026-08-26T09:00:00.000Z'),
          latestConversion: {
            id: 'conv-1',
            clientId: 'acme',
            documentId: 'doc-1',
            summary: summary({ tagged: true, gaps: [] }),
            inputSha256: 'a'.repeat(64),
            outputSha256: 'b'.repeat(64),
            convertedAt: '2026-08-26T10:00:00.000Z',
          },
        }),
      ],
      AT,
    );

    // The conversion's gaps are the honest residue of the file delivered.
    expect(section.entries[0]).toMatchObject({ readBy: 'conversion', tagged: true, gaps: [] });
    expect(section.totals.withGaps).toBe(0);
  });

  it('an older conversion does not outrank a newer inspection', () => {
    const section = buildDocumentReport(
      [
        doc({
          latestInspection: inspection('2026-08-26T11:00:00.000Z'),
          latestConversion: {
            id: 'conv-1',
            clientId: 'acme',
            documentId: 'doc-1',
            summary: summary({ tagged: true, gaps: [] }),
            inputSha256: 'a'.repeat(64),
            outputSha256: 'b'.repeat(64),
            convertedAt: '2026-08-26T10:00:00.000Z',
          },
        }),
      ],
      AT,
    );

    expect(section.entries[0].readBy).toBe('inspection');
  });

  it('hands out a conversion download handle only when the file is actually stored', () => {
    const conversion = (over: object) => ({
      id: 'conv-1',
      clientId: 'acme',
      documentId: 'doc-1',
      summary: summary({ tagged: true, gaps: [] }),
      inputSha256: 'a'.repeat(64),
      outputSha256: 'b'.repeat(64),
      convertedAt: '2026-08-26T10:00:00.000Z',
      ...over,
    });

    const stored = buildDocumentReport(
      [doc({ latestConversion: conversion({ artifactUrl: 'https://blob.example/x.pdf' }) })],
      AT,
    );
    expect(stored.entries[0].conversionId).toBe('conv-1');
    // The handle is an id; the blob URL never enters the snapshot.
    expect(JSON.stringify(stored)).not.toContain('blob.example');

    // No artifact stored → no handle: a download link on the public page must
    // never point at nothing.
    const bare = buildDocumentReport([doc({ latestConversion: conversion({}) })], AT);
    expect(bare.entries[0]).not.toHaveProperty('conversionId');
  });

  it('marks a read PDF whose Word source is in the same inventory', () => {
    const section = buildDocumentReport(
      [
        doc({
          id: 'doc-pdf',
          url: 'https://town.example/files/permit.pdf',
          latestInspection: { ...inspection('2026-08-26T09:00:00.000Z') },
        }),
        doc({ id: 'doc-word', url: 'https://town.example/files/permit.docx', kind: 'docx' }),
        doc({
          id: 'doc-alone',
          url: 'https://town.example/files/loner.pdf',
          latestInspection: { ...inspection('2026-08-26T09:00:00.000Z') },
        }),
      ],
      AT,
    );

    const byUrl = new Map(section.entries.map((entry) => [entry.url, entry]));
    expect(byUrl.get('https://town.example/files/permit.pdf')?.sourceAvailable).toBe(true);
    // Absent, not false: an entry without a source says nothing about one.
    expect(byUrl.get('https://town.example/files/loner.pdf')).not.toHaveProperty(
      'sourceAvailable',
    );
  });

  it('never carries titleText — the shared page is public-by-token', () => {
    const section = buildDocumentReport(
      [doc({ latestInspection: inspection('2026-08-26T09:00:00.000Z') })],
      AT,
    );

    expect(JSON.stringify(section)).not.toContain('Jane Doe');
  });

  it('says what a person supplied, as counts, and what was asked of the client — never the words', () => {
    // The public page may say that descriptions were written and that the
    // client has been asked for a source; it may not carry the description a
    // person typed (content about the client's document) nor an operator's
    // note. Requests are the punch items' own sentences, which already
    // render there.
    const section = buildDocumentReport(
      [doc({
        latestInspection: {
          ...inspection('2026-08-26T09:00:00.000Z'),
          inputSha256: 'a'.repeat(64),
          summary: summary({
            declared: { language: true, figures: 2 },
            needs: [
              { criterion: 'PDF/UA 7.21.4', item: 'the fonts were never embedded — supply the Word source' },
              { criterion: '1.1.1', item: 'Figure 1 (p1): no alt text — write a description' },
            ],
            asks: [
              { id: 'fonts:not-embedded', kind: 'fonts', criterion: 'PDF/UA 7.21.4', answerable: 'client' },
              { id: 'figure:0', kind: 'figure', criterion: '1.1.1', answerable: 'operator', target: { ordinal: 0, type: 'Figure', page: 1, prior: 'absent' } },
            ],
          }),
        },
      })],
      AT,
      [
        {
          id: 'ans-1', clientId: 'acme', documentId: 'doc-1', inputSha256: 'a'.repeat(64),
          askId: 'fonts:not-embedded', kind: 'fonts', disposition: 'requested',
          note: 'Asked Jane Doe at the clerk’s office', actor: 'Sam', declaredAt: '2026-08-26T10:00:00.000Z',
        },
        {
          id: 'ans-2', clientId: 'acme', documentId: 'doc-1', inputSha256: 'a'.repeat(64),
          askId: 'figure:0', kind: 'figure', disposition: 'declared',
          value: 'A photograph of Jane Doe receiving the award', actor: 'Sam', declaredAt: '2026-08-26T10:00:00.000Z',
        },
      ],
    );

    const [entry] = section.entries;
    expect(entry.declared).toEqual({ language: true, figures: 2 });
    expect(entry.requested).toEqual(['the fonts were never embedded — supply the Word source']);
    expect(JSON.stringify(section)).not.toContain('Jane Doe');
  });

  it('never carries asks or the excerpt — identities and context are for the operator', () => {
    // The excerpt quotes the document around each figure so a person can
    // describe it; that is content, and the public page is public-by-token.
    // Asks are ids, but a pinned snapshot that carries them would invite a
    // surface to render answer state that the snapshot cannot keep current.
    const section = buildDocumentReport(
      [doc({
        latestInspection: {
          ...inspection('2026-08-26T09:00:00.000Z'),
          summary: summary({
            needs: [{ criterion: '1.1.1', item: 'Figure 1 (p1): no alt text, no caption to transcribe — write a description' }],
            asks: [{ id: 'figure:0', kind: 'figure', criterion: '1.1.1', answerable: 'operator', target: { ordinal: 0, type: 'Figure', page: 1, prior: 'absent' } }],
            excerpt: { figures: [{ ordinal: 0, context: { heading: 'Objection of Jane Doe' } }] },
          }),
        },
      })],
      AT,
    );

    expect(JSON.stringify(section)).not.toContain('Jane Doe');
    expect(section.entries[0]).not.toHaveProperty('asks');
    expect(section.entries[0]).not.toHaveProperty('excerpt');
  });
});

function inspection(inspectedAt: string) {
  return {
    id: `insp-${inspectedAt}`,
    clientId: 'acme',
    documentId: 'doc-1',
    url: 'https://town.example/minutes/agenda.pdf',
    source: 'crawl' as const,
    summary: summary(),
    inspectedAt,
  };
}
