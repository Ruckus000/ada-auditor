import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from '../../src/app/api/audit/runs/route';
import { MemoryRunStore, resetRunStore, setRunStore } from '../../src/integrations/persistence';
import { runRecord } from '../support/run-store-contract';

const TOKEN = 'test-token-16chars';

function listRequest(query = '', authorized = true): Request {
  return new Request(`http://localhost/api/audit/runs${query}`, {
    headers: authorized ? { Authorization: `Bearer ${TOKEN}` } : {},
  });
}

describe('GET /api/audit/runs', () => {
  const originalToken = process.env.AUDITOR_RUN_TOKEN;
  let store: MemoryRunStore;

  beforeEach(() => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;
    store = new MemoryRunStore();
    setRunStore(store);
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.AUDITOR_RUN_TOKEN;
    else process.env.AUDITOR_RUN_TOKEN = originalToken;
    resetRunStore();
  });

  it('rejects unauthorized requests', async () => {
    expect((await GET(listRequest('', false))).status).toBe(401);
  });

  it('returns run history newest first', async () => {
    await store.saveRun(runRecord({ requestId: 'a', createdAt: '2026-08-08T10:00:00.000Z' }));
    await store.saveRun(runRecord({ requestId: 'b', createdAt: '2026-08-08T11:00:00.000Z' }));

    const body = await (await GET(listRequest())).json();

    expect(body.count).toBe(2);
    expect(body.runs.map((run: { requestId: string }) => run.requestId)).toEqual(['b', 'a']);
  });

  it('filters by journey and environment', async () => {
    await store.saveRun(runRecord({ requestId: 'a' }));
    await store.saveRun(runRecord({ requestId: 'b', journeyId: 'other' }));

    const body = await (await GET(listRequest('?journeyId=other'))).json();

    expect(body.runs.map((run: { requestId: string }) => run.requestId)).toEqual(['b']);
  });

  it('returns an empty list rather than a 404 when there is no history', async () => {
    // "No runs yet" is a normal state for a new journey, not an error — a 404
    // would make every caller special-case it.
    const response = await GET(listRequest());

    expect(response.status).toBe(200);
    expect((await response.json()).runs).toEqual([]);
  });

  it.each(['?limit=0', '?limit=101', '?limit=abc', '?environment=nowhere'])(
    'rejects the invalid query %j rather than quietly answering something else',
    async (query) => {
      expect((await GET(listRequest(query))).status).toBe(400);
    },
  );
});
