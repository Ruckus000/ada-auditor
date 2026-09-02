import { describe, expect, it } from 'vitest';

import type { Ask } from '../../src/domain/document-answers';
import type { RemediationSummary } from '../../src/domain/document-remediation';
import type { ClientDocumentRecord, StoredDocumentAnswer } from '../../src/domain/platform';
import {
  compareAsks,
  countByState,
  documentState,
  latestReading,
} from '../../src/services/document-state';

/**
 * One derived state per document, from what the store holds.
 *
 * The inventory sorts, filters and counts on this, so every rule is a row in a
 * decision table below — first match wins, in the order an operator would
 * want to act: their own work before work that is blocked on somebody else.
 */

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const T0 = '2026-08-26T09:00:00.000Z';
const T1 = '2026-08-26T10:00:00.000Z';

const figureAsk: Ask = {
  id: 'figure:0', kind: 'figure', criterion: '1.1.1', answerable: 'operator',
  target: { ordinal: 0, type: 'Figure', page: 1, prior: 'absent' },
};
const fontsAsk: Ask = { id: 'fonts:not-embedded', kind: 'fonts', criterion: 'PDF/UA 7.21.4', answerable: 'client' };
const identifierAsk: Ask = { id: 'identifier', kind: 'identifier', criterion: 'PDF/UA 5-1', answerable: 'none' };

function summary(over: Partial<RemediationSummary> = {}): RemediationSummary {
  return {
    title: 'already-titled',
    sourceLanguage: 'en',
    tagged: true,
    pages: 2,
    headings: 1,
    tables: 0,
    lists: 0,
    figures: 1,
    gaps: [],
    conformance: { checker: 'verapdf-ua1', compliant: false, failingClauses: ['7.3-1'] },
    ...over,
  };
}

function doc(over: Partial<ClientDocumentRecord> = {}): ClientDocumentRecord {
  return {
    id: 'doc-1',
    clientId: 'acme',
    url: 'https://town.example/agenda.pdf',
    kind: 'pdf',
    source: 'crawl',
    firstSeenAt: T0,
    lastSeenAt: T0,
    ...over,
  };
}

/** `inputSha256: null` is a legacy reading that does not know its bytes. */
function inspection(over: Partial<RemediationSummary> = {}, at = T0, inputSha256: string | null = SHA_A) {
  return {
    id: 'insp-1', clientId: 'acme', documentId: 'doc-1', url: 'https://town.example/agenda.pdf',
    source: 'crawl' as const, summary: summary(over), inspectedAt: at,
    ...(inputSha256 === null ? {} : { inputSha256 }),
  };
}

function answer(over: Partial<StoredDocumentAnswer> = {}): StoredDocumentAnswer {
  return {
    id: 'ans-1', clientId: 'acme', documentId: 'doc-1', inputSha256: SHA_A,
    askId: 'figure:0', kind: 'figure', disposition: 'declared', value: 'A map',
    actor: 'Sam', declaredAt: T1,
    ...over,
  };
}

describe('documentState', () => {
  it.each([
    ['no reading at all', doc(), [], 'not-reviewed'],
    [
      'the bytes at the address moved under the reading',
      doc({ contentSha256: SHA_B, latestInspection: inspection({ asks: [figureAsk], needs: [{ criterion: '1.1.1', item: 'x' }] }) }),
      [answer()],
      'stale',
    ],
    [
      'an operator ask has no answer',
      doc({ latestInspection: inspection({ asks: [figureAsk], needs: [{ criterion: '1.1.1', item: 'x' }] }) }),
      [],
      'needs-answers',
    ],
    [
      'a client ask has not been logged as requested yet — that is the operator\'s job',
      doc({ latestInspection: inspection({ asks: [fontsAsk], needs: [{ criterion: 'PDF/UA 7.21.4', item: 'x' }] }) }),
      [],
      'needs-answers',
    ],
    [
      'an answer exists only under other bytes',
      doc({ latestInspection: inspection({ asks: [figureAsk], needs: [{ criterion: '1.1.1', item: 'x' }] }) }),
      [answer({ inputSha256: SHA_B })],
      'needs-answers',
    ],
    [
      'the checker passed and nothing is open',
      doc({ latestInspection: inspection({ conformance: { checker: 'verapdf-ua1', compliant: true } }) }),
      [],
      'conformant',
    ],
    [
      'the only item is the one that is not work',
      doc({ latestInspection: inspection({ asks: [identifierAsk], needs: [{ criterion: 'PDF/UA 5-1', item: 'x' }], conformance: { checker: 'verapdf-ua1', compliant: true } }) }),
      [],
      'conformant',
    ],
    [
      'a declared answer is newer than the reading — a run would consume it',
      doc({ latestInspection: inspection({ asks: [figureAsk], needs: [{ criterion: '1.1.1', item: 'x' }] }) }),
      [answer()],
      'ready',
    ],
    [
      'a tagged PDF has only been inspected — a repair would advance it',
      doc({ latestInspection: inspection() }),
      [],
      'ready',
    ],
    [
      'the client has been asked and nothing else is open',
      doc({ latestInspection: inspection({ asks: [fontsAsk], needs: [{ criterion: 'PDF/UA 7.21.4', item: 'x' }] }, T0), latestConversion: undefined }),
      [answer({ askId: 'fonts:not-embedded', kind: 'fonts', disposition: 'requested', value: undefined, declaredAt: T1 })],
      'waiting-on-client',
    ],
    [
      'everything is decided, nothing applied, not conformant',
      doc({ latestConversion: {
        id: 'conv-1', clientId: 'acme', documentId: 'doc-1', inputSha256: SHA_A, outputSha256: 'c'.repeat(64),
        summary: summary({ asks: [figureAsk], needs: [{ criterion: '1.1.1', item: 'x' }] }), convertedAt: T0,
      } }),
      [answer({ disposition: 'decided', value: undefined, note: 'decorative' })],
      'closed',
    ],
    [
      'a declared answer on a document whose run is refused waits on the client',
      // An untagged PDF: the language is declared, but no run can consume it
      // until the client supplies a file that can be run. "Ready" would send
      // an operator to a button that answers with a refusal.
      doc({ latestInspection: inspection({
        tagged: false,
        asks: [
          { id: 'language', kind: 'language', criterion: '3.1.1', answerable: 'operator' },
          { id: 'repair:not-tagged', kind: 'repair', criterion: 'repair', answerable: 'client' },
        ],
        needs: [{ criterion: '3.1.1', item: 'x' }, { criterion: 'repair', item: 'y' }],
      }) }),
      [
        answer({ askId: 'language', kind: 'language', value: 'en' }),
        answer({ id: 'ans-2', askId: 'repair:not-tagged', kind: 'repair', disposition: 'requested', value: undefined }),
      ],
      'waiting-on-client',
    ],
    [
      'a legacy reading with no asks and no sha is never stale',
      doc({ contentSha256: SHA_B, latestInspection: inspection({}, T0, null) }),
      [answer()],
      'ready',
    ],
  ] as const)('%s → %s', (_name, record, answers, expected) => {
    const reading = latestReading(record);
    expect(documentState(record, reading, [...answers]).state).toBe(expected);
  });

  it('names the open asks and counts the answers that no longer apply', () => {
    const record = doc({
      latestInspection: inspection({
        asks: [figureAsk, fontsAsk, identifierAsk],
        needs: [
          { criterion: '1.1.1', item: 'x' },
          { criterion: 'PDF/UA 7.21.4', item: 'y' },
          { criterion: 'PDF/UA 5-1', item: 'z' },
        ],
      }),
    });
    const result = documentState(record, latestReading(record), [
      answer({ id: 'old', inputSha256: SHA_B }),
      answer({ id: 'req', askId: 'fonts:not-embedded', kind: 'fonts', disposition: 'requested', value: undefined }),
    ]);

    expect(result.state).toBe('needs-answers');
    expect(result.open.map((ask) => ask.id)).toEqual(['figure:0']);
    expect(result.waiting.map((ask) => ask.id)).toEqual(['fonts:not-embedded']);
    expect(result.expired).toBe(1);
  });

  it('a decided answer closes an operator ask without applying anything', () => {
    const record = doc({
      latestInspection: inspection({ asks: [figureAsk], needs: [{ criterion: '1.1.1', item: 'x' }] }),
    });
    const result = documentState(record, latestReading(record), [
      answer({ disposition: 'decided', value: undefined, note: 'decorative' }),
    ]);
    expect(result.open).toEqual([]);
    expect(result.state).toBe('ready');
  });
});

describe('latestReading', () => {
  it('prefers the newer of the inspection and the conversion', () => {
    const record = doc({
      latestInspection: inspection({}, T1),
      latestConversion: {
        id: 'conv-1', clientId: 'acme', documentId: 'doc-1', inputSha256: SHA_A, outputSha256: 'c'.repeat(64),
        summary: summary(), convertedAt: T0, artifactUrl: 'https://blob.example/x',
      },
    });
    expect(latestReading(record)?.by).toBe('inspection');
    expect(latestReading(doc({ latestConversion: record.latestConversion }))?.conversionId).toBe('conv-1');
  });

  it('reads a paired PDF through its source\'s conversion when that is newer', () => {
    // The Word source's conversion IS the PDF's remediation, and the
    // delivered file lands on the sibling row — the PDF row must see it.
    const pdf = doc({ latestInspection: inspection({}, T0) });
    const source = doc({
      id: 'doc-2', kind: 'docx', url: 'https://town.example/agenda.docx',
      latestConversion: {
        id: 'conv-src', clientId: 'acme', documentId: 'doc-2', inputSha256: SHA_B, outputSha256: 'c'.repeat(64),
        summary: summary({ conformance: { checker: 'verapdf-ua1', compliant: true } }), convertedAt: T1,
      },
    });
    const reading = latestReading(pdf, source);
    expect(reading?.by).toBe('conversion');
    expect(reading?.inputSha256).toBe(SHA_B);
    expect(documentState(pdf, reading, []).state).toBe('conformant');
  });
});

describe('countByState and compareAsks', () => {
  it('counts every state, zero included, so the header line never omits one', () => {
    const counts = countByState(['conformant', 'needs-answers', 'needs-answers']);
    expect(counts).toEqual({
      'not-reviewed': 0, stale: 0, 'needs-answers': 2, ready: 0,
      'waiting-on-client': 0, closed: 0, conformant: 1,
    });
  });

  it('diffs two readings by ask id', () => {
    const diff = compareAsks([figureAsk, fontsAsk], [fontsAsk, identifierAsk]);
    expect(diff.closed.map((a) => a.id)).toEqual(['figure:0']);
    expect(diff.remaining.map((a) => a.id)).toEqual(['fonts:not-embedded']);
    expect(diff.added.map((a) => a.id)).toEqual(['identifier']);
  });
});
