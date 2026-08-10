import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredRunRecord } from '../../src/domain/persistence';

// The routes resolve a principal now rather than asking "is there a
// session?". Mocking that seam keeps these tests about the routes; the
// cookie/token machinery has its own suite in tests/api/principal.test.ts.
const { principalFromRequest } = vi.hoisted(() => ({ principalFromRequest: vi.fn() }));
vi.mock('../../src/app/api/_lib/principal', () => ({ principalFromRequest }));

const OPERATOR = { kind: 'operator' as const, id: 'op-1', name: 'Alex Reed', email: 'alex@example.com' };

const { DELETE, POST } = await import(
  '../../src/app/api/platform/clients/[clientId]/reports/route'
);
const {
  MemoryPlatformStore,
  MemoryRunStore,
  resetPlatformStore,
  resetRunStore,
  setPlatformStore,
  setRunStore,
} = await import('../../src/integrations/persistence');
const { buildSharedReport } = await import('../../src/services/report-view');

const TOKEN = 'test-token-16chars';

function params(clientId: string) {
  return { params: Promise.resolve({ clientId }) };
}

function request(body: unknown, method = 'POST', headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/platform/clients/acme/reports', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function fromBrowser(body: unknown, method = 'POST'): Request {
  principalFromRequest.mockResolvedValue(OPERATOR);
  return request(body, method, { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' });
}

function run(overrides: Partial<StoredRunRecord> & Pick<StoredRunRecord, 'requestId'>) {
  return {
    journeyId: 'acme-checkout',
    environment: 'staging' as const,
    platform: 'generic',
    evidenceStatus: 'complete',
    ciStatus: 'fail',
    findings: [
      {
        code: 'image-alt',
        severity: 'critical',
        source: 'deterministic',
        pageUrl: 'https://acme.test/one',
        selector: 'img',
      },
    ],
    durationMs: 10,
    createdAt: '2026-08-10T10:00:00.000Z',
    status: 'complete' as const,
    pages: [
      { url: 'https://acme.test/one', route: '/one', title: 'One', evidenceStatus: 'complete' },
    ],
    ...overrides,
  };
}

let platform: InstanceType<typeof MemoryPlatformStore>;
let runs: InstanceType<typeof MemoryRunStore>;

describe('/api/platform/clients/[clientId]/reports', () => {
  const originalToken = process.env.AUDITOR_RUN_TOKEN;

  beforeEach(async () => {
    process.env.AUDITOR_RUN_TOKEN = TOKEN;
    principalFromRequest.mockReset();
    principalFromRequest.mockResolvedValue(null);
    platform = new MemoryPlatformStore();
    runs = new MemoryRunStore();
    setPlatformStore(platform);
    setRunStore(runs);

    await platform.upsertClient({ id: 'acme', name: 'Acme' });
    await platform.upsertJourney({
      id: 'acme-checkout',
      clientId: 'acme',
      name: 'Checkout',
      steps: [],
    });
    await runs.saveRun(run({ requestId: 'r1' }));
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.AUDITOR_RUN_TOKEN;
    else process.env.AUDITOR_RUN_TOKEN = originalToken;
    resetPlatformStore();
    resetRunStore();
  });

  function deps() {
    return { clients: platform, journeys: platform, reports: platform, runs };
  }

  it('refuses an unauthenticated request', async () => {
    expect((await POST(request({ requestId: 'r1' }), params('acme'))).status).toBe(401);
  });

  it('refuses a cookie carried cross-origin', async () => {
    // Issuing a report mints a URL that reads a client's audit without any
    // authentication at all. It is the last thing that should be reachable by
    // a cross-site form post.
    principalFromRequest.mockResolvedValue(OPERATOR);
    const response = await POST(
      request({ requestId: 'r1' }, 'POST', {
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      }),
      params('acme'),
    );

    expect(response.status).toBe(401);
  });

  it('issues a report pinned to the run', async () => {
    const response = await POST(fromBrowser({ requestId: 'r1', audience: 'legal' }), params('acme'));

    expect(response.status).toBe(201);
    const { report } = await response.json();
    expect(report.shareUrl).toBe(`/r/${report.shareToken}`);

    const shared = await buildSharedReport(report.shareToken, deps());
    expect(shared).toMatchObject({ clientName: 'Acme', audience: 'legal' });
    expect(shared?.run.requestId).toBe('r1');
  });

  it('gives every report an unguessable token', async () => {
    // The token is the entire access-control story for the shared page.
    const first = await (await POST(fromBrowser({ requestId: 'r1' }), params('acme'))).json();
    const second = await (await POST(fromBrowser({ requestId: 'r1' }), params('acme'))).json();

    expect(first.report.shareToken).not.toBe(second.report.shareToken);
    expect(first.report.shareToken.length).toBeGreaterThanOrEqual(40);
  });

  it("will not pin another client's run", async () => {
    // Otherwise any operator could mint a public link to any run by naming its
    // id — and the shared page carries a client's name on it.
    await platform.upsertClient({ id: 'other', name: 'Other' });

    const response = await POST(fromBrowser({ requestId: 'r1' }), params('other'));

    expect(response.status).toBe(404);
  });

  it('refuses a run that does not exist', async () => {
    expect((await POST(fromBrowser({ requestId: 'nope' }), params('acme'))).status).toBe(404);
  });

  it('stops answering once the link is revoked', async () => {
    const { report } = await (
      await POST(fromBrowser({ requestId: 'r1' }), params('acme'))
    ).json();

    expect(await buildSharedReport(report.shareToken, deps())).not.toBeNull();

    const revoked = await DELETE(fromBrowser({ id: report.id }, 'DELETE'), params('acme'));
    expect(revoked.status).toBe(200);

    expect(await buildSharedReport(report.shareToken, deps())).toBeNull();
  });

  it("will not revoke another client's report", async () => {
    await platform.upsertClient({ id: 'other', name: 'Other' });
    const { report } = await (
      await POST(fromBrowser({ requestId: 'r1' }), params('acme'))
    ).json();

    expect((await DELETE(fromBrowser({ id: report.id }, 'DELETE'), params('other'))).status).toBe(
      404,
    );
    expect(await buildSharedReport(report.shareToken, deps())).not.toBeNull();
  });

  it('records issuing and revoking', async () => {
    const { report } = await (
      await POST(fromBrowser({ requestId: 'r1' }), params('acme'))
    ).json();
    await DELETE(fromBrowser({ id: report.id }, 'DELETE'), params('acme'));

    const actions = (await platform.listEvents({ clientId: 'acme' })).map((e) => e.action);
    expect(actions).toContain('issued a report');
    expect(actions).toContain('revoked a report link');
  });

  it('does not publish a dismissal or its note', async () => {
    // A dismissal is an internal decision with an internal justification.
    // Publishing it to whoever holds the link would leak the note; hiding the
    // finding because of it would make the shared document disagree with the
    // audit it claims to report.
    await platform.setTriage({
      clientId: 'acme',
      findingKey: 'deterministic:image-alt:https://acme.test/one:img',
      source: 'deterministic',
      code: 'image-alt',
      state: 'dismissed',
      note: 'Internal reasoning nobody outside should read.',
      actor: 'Alex Reed',
    });

    const { report } = await (
      await POST(fromBrowser({ requestId: 'r1' }), params('acme'))
    ).json();
    const shared = await buildSharedReport(report.shareToken, deps());

    expect(JSON.stringify(shared)).not.toContain('Internal reasoning');
    expect(shared?.pages[0].findings.map((f) => f.code)).toEqual(['image-alt']);
  });

  it('answers null for a token that never existed', async () => {
    expect(await buildSharedReport('not-a-token', deps())).toBeNull();
  });
});
