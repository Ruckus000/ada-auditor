import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ask } from '../../src/domain/document-answers';
import type { RemediationSummary } from '../../src/domain/document-remediation';

/**
 * The channel through which a punch item gets its answer.
 *
 * Every rule here is a trust-boundary rule: an answer is written into a
 * delivered file and rendered in the console, so what the route refuses is
 * as much the contract as what it saves — an ask the reading never raised, a
 * disposition the kind does not take, an empty description wearing a value's
 * clothes, a language nobody could resolve, and a reading that does not know
 * its own bytes.
 */

const principal = vi.hoisted(() => ({
  value: { kind: 'machine', name: 'CI' } as
    | { kind: 'machine'; name: string }
    | { kind: 'operator'; id: string; name: string; email: string }
    | null,
}));
vi.mock('../../src/app/api/_lib/authorize', () => ({
  authorizePrincipal: async () => principal.value,
}));

const { POST } = await import(
  '../../src/app/api/platform/clients/[clientId]/documents/[documentId]/answers/route'
);
const { MemoryPlatformStore, resetPlatformStore, setPlatformStore } = await import(
  '../../src/integrations/persistence'
);

const SHA = 'a'.repeat(64);
const DOC_URL = 'https://town.example/minutes/agenda.pdf';

const figureAsk: Ask = {
  id: 'figure:0', kind: 'figure', criterion: '1.1.1', answerable: 'operator',
  target: { ordinal: 0, type: 'Figure', page: 1, prior: 'absent' },
};
const languageAsk: Ask = { id: 'language', kind: 'language', criterion: '3.1.1', answerable: 'operator' };
const fontsAsk: Ask = { id: 'fonts:not-embedded', kind: 'fonts', criterion: 'PDF/UA 7.21.4', answerable: 'client' };
const identifierAsk: Ask = { id: 'identifier', kind: 'identifier', criterion: 'PDF/UA 5-1', answerable: 'none' };

function summary(asks: Ask[]): RemediationSummary {
  return {
    title: 'already-titled',
    sourceLanguage: null,
    tagged: true,
    pages: 1,
    headings: 0,
    tables: 0,
    lists: 0,
    figures: 1,
    gaps: ['1.1.1: 1 figure with no alt text'],
    needs: asks.map((ask) => ({ criterion: ask.criterion, item: `item for ${ask.id}` })),
    asks,
    conformance: { checker: 'verapdf-ua1', compliant: false, failingClauses: ['7.3-1'] },
  };
}

let platform: InstanceType<typeof MemoryPlatformStore>;
let documentId: string;

function params(clientId: string, docId = documentId) {
  return { params: Promise.resolve({ clientId, documentId: docId }) };
}

function post(body: unknown, docId = documentId): Request {
  return new Request(`http://localhost/api/platform/clients/acme/documents/${docId}/answers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** `inputSha256: null` seeds a legacy reading that does not know its bytes. */
async function seed(asks: Ask[], inputSha256: string | null = SHA) {
  const doc = await platform.ensureClientDocument(
    'acme',
    { url: DOC_URL, kind: 'pdf', source: 'crawl', ...(inputSha256 === null ? {} : { contentSha256: inputSha256 }) },
    '2026-08-26T09:00:00.000Z',
  );
  await platform.saveDocumentInspection({
    id: 'insp-1',
    clientId: 'acme',
    documentId: doc.id,
    url: DOC_URL,
    source: 'crawl',
    summary: summary(asks),
    ...(inputSha256 === null ? {} : { inputSha256 }),
    inspectedAt: '2026-08-26T09:00:00.000Z',
  });
  documentId = doc.id;
}

describe('POST /api/platform/clients/[clientId]/documents/[documentId]/answers', () => {
  beforeEach(async () => {
    principal.value = { kind: 'machine', name: 'CI' };
    platform = new MemoryPlatformStore();
    setPlatformStore(platform);
    await platform.upsertClient({ id: 'acme', name: 'Acme' });
  });

  afterEach(() => {
    resetPlatformStore();
  });

  it('saves a page of answers, attributed, keyed to the reading\'s bytes, and says what state that leaves', async () => {
    await seed([figureAsk, languageAsk, fontsAsk]);

    const response = await POST(
      post({
        answers: [
          { askId: 'figure:0', disposition: 'declared', value: '  A map of the town centre  ' },
          { askId: 'language', disposition: 'declared', value: 'en' },
          { askId: 'fonts:not-embedded', disposition: 'requested', note: 'asked the clerk for the .docx' },
        ],
      }),
      params('acme'),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.saved).toBe(3);
    // Everything answered and two declarations waiting for a run.
    expect(body.state).toBe('ready');

    const rows = await platform.latestDocumentAnswers('acme', [documentId]);
    expect(rows).toHaveLength(3);
    const figure = rows.find((row) => row.askId === 'figure:0');
    expect(figure).toMatchObject({
      inputSha256: SHA,
      kind: 'figure',
      target: { ordinal: 0, type: 'Figure', page: 1, prior: 'absent' },
      disposition: 'declared',
      value: 'A map of the town centre',
      actor: 'CI',
    });
    expect(figure).not.toHaveProperty('operatorId');
    expect(rows.find((row) => row.askId === 'fonts:not-embedded')).toMatchObject({
      disposition: 'requested',
      note: 'asked the clerk for the .docx',
    });

    // The trail: counts and kinds, never the description.
    const [event] = await platform.listEvents({ clientId: 'acme' });
    expect(event).toMatchObject({ actor: 'CI', action: 'document_answered', subject: documentId });
    expect(JSON.stringify(event)).not.toContain('town centre');
  });

  it('records the operator who answered', async () => {
    principal.value = { kind: 'operator', id: 'op-1', name: 'Sam', email: 's@example.gov' };
    await seed([languageAsk]);

    await POST(post({ answers: [{ askId: 'language', disposition: 'declared', value: 'cy' }] }), params('acme'));

    const [row] = await platform.latestDocumentAnswers('acme', [documentId]);
    expect(row).toMatchObject({ actor: 'Sam', operatorId: 'op-1' });
  });

  it('refuses an ask the reading never raised', async () => {
    await seed([figureAsk]);

    const response = await POST(
      post({ answers: [{ askId: 'figure:7', disposition: 'declared', value: 'x' }] }),
      params('acme'),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe('unknown_ask');
    expect(await platform.latestDocumentAnswers('acme', [documentId])).toEqual([]);
  });

  it('refuses a disposition the kind does not take', async () => {
    await seed([languageAsk, identifierAsk]);

    // A language is declared, never decided; the identifier takes nothing.
    for (const answers of [
      [{ askId: 'language', disposition: 'decided', note: 'meh' }],
      [{ askId: 'identifier', disposition: 'decided', note: 'ok' }],
    ]) {
      const response = await POST(post({ answers }), params('acme'));
      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe('disposition_not_accepted');
    }
  });

  it('refuses an empty description and an oversize one — decorative is a decision, not a value', async () => {
    await seed([figureAsk]);

    for (const value of ['', '   ', 'x'.repeat(1001)]) {
      const response = await POST(
        post({ answers: [{ askId: 'figure:0', disposition: 'declared', value }] }),
        params('acme'),
      );
      expect(response.status, JSON.stringify(value.length)).toBe(400);
    }
  });

  it('refuses a language nobody could resolve', async () => {
    await seed([languageAsk]);

    const response = await POST(
      post({ answers: [{ askId: 'language', disposition: 'declared', value: 'english' }] }),
      params('acme'),
    );

    expect(response.status).toBe(400);
  });

  it('refuses a reading that does not know its bytes — inspect it again first', async () => {
    await seed([figureAsk], null);

    const response = await POST(
      post({ answers: [{ askId: 'figure:0', disposition: 'declared', value: 'A map' }] }),
      params('acme'),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('reading_has_no_bytes');
  });

  it('answers 404 for a document that is not this client\'s, 401 without a principal, 400 for a shapeless body', async () => {
    await seed([figureAsk]);

    expect((await POST(post({ answers: [] }, 'doc-nope'), params('acme', 'doc-nope'))).status).toBe(404);
    expect((await POST(post({ answers: [{ askId: 'figure:0', disposition: 'declared', value: 'x', extra: 1 }] }), params('acme'))).status).toBe(400);

    principal.value = null;
    expect((await POST(post({ answers: [] }), params('acme'))).status).toBe(401);
  });
});
