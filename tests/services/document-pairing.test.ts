import { describe, expect, it } from 'vitest';
import { documentStem, pairDocuments } from '../../src/services/document-pairing';
import type { ClientDocumentRecord } from '../../src/domain/platform';

/**
 * The product answer to the PDF-repair STOP: a paired PDF's remediation is
 * "convert the source". Pairing is derived and conservative — the wrong
 * source offered confidently would be worse than none offered.
 */

const doc = (id: string, kind: string, url: string): ClientDocumentRecord => ({
  id, clientId: 'acme', url, kind: kind as ClientDocumentRecord['kind'], source: 'crawl',
  firstSeenAt: '2026-08-27T00:00:00.000Z', lastSeenAt: '2026-08-27T00:00:00.000Z',
});

describe('documentStem', () => {
  it('strips extension, query and case — the CDN appends cache keys', () => {
    expect(documentStem('https://cdn.example/d/Agenda%202026.pdf?ver=123')).toBe('agenda 2026');
    expect(documentStem('https://cdn.example/d/Agenda%202026.docx?ver=456')).toBe('agenda 2026');
  });

  it('answers null for a URL with no document extension', () => {
    expect(documentStem('https://town.example/document/12345')).toBeNull();
  });
});

describe('pairDocuments', () => {
  it('pairs a pdf with the word document sharing its stem', () => {
    const pairs = pairDocuments([
      doc('p1', 'pdf', 'https://cdn.example/d/Minutes-March.pdf?ver=1'),
      doc('w1', 'docx', 'https://cdn.example/d/Minutes-March.docx?ver=2'),
      doc('p2', 'pdf', 'https://cdn.example/d/Unrelated.pdf'),
    ]);
    expect(pairs.get('p1')).toMatchObject({ id: 'w1', kind: 'docx' });
    expect(pairs.has('p2')).toBe(false);
  });

  it('prefers docx over legacy doc for the same stem', () => {
    const pairs = pairDocuments([
      doc('p1', 'pdf', 'https://t.example/f/Agenda.pdf'),
      doc('w1', 'doc', 'https://t.example/f/Agenda.doc'),
      doc('w2', 'docx', 'https://t.example/f/Agenda.docx'),
    ]);
    expect(pairs.get('p1')?.id).toBe('w2');
  });

  it('refuses ambiguity — two same-kind candidates pair with nothing', () => {
    const pairs = pairDocuments([
      doc('p1', 'pdf', 'https://t.example/a/Agenda.pdf'),
      doc('w1', 'docx', 'https://t.example/a/Agenda.docx'),
      doc('w2', 'docx', 'https://t.example/b/Agenda.docx'),
    ]);
    expect(pairs.has('p1')).toBe(false);
  });
});
