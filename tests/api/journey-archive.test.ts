import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Archiving a journey over HTTP.
 *
 * `archiveJourney` already exists on both platform stores, with its own
 * "archives rather than deletes" coverage in the shared contract suite. This
 * is the HTTP surface for it: the wizard's "start over with a different URL"
 * needs it, because PATCH deliberately refuses `targetUrl` changes.
 */

const { principalFromRequest } = vi.hoisted(() => ({ principalFromRequest: vi.fn() }));
vi.mock('../../src/app/api/_lib/principal', () => ({ principalFromRequest }));

const OPERATOR = {
  kind: 'operator' as const,
  id: 'op-1',
  name: 'Alex Reed',
  email: 'alex@example.com',
};

const { DELETE } = await import(
  '../../src/app/api/platform/clients/[clientId]/journeys/[journeyId]/route'
);
const { MemoryPlatformStore, setPlatformStore } = await import(
  '../../src/integrations/persistence'
);

let platform: InstanceType<typeof MemoryPlatformStore>;

function request(method: string): Request {
  return new Request('http://localhost/api/platform/clients/acme/journeys/acme-home', {
    method,
    headers: { 'content-type': 'application/json' },
  });
}

/** Same-origin plus a session: how the screens call it. */
function authed(method: string): Request {
  principalFromRequest.mockResolvedValue(OPERATOR);
  return new Request('http://localhost/api/platform/clients/acme/journeys/acme-home', {
    method,
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
      'sec-fetch-site': 'same-origin',
    },
  });
}

/**
 * A session cookie travels on cross-site posts too, so a principal alone
 * cannot be the gate — same reasoning as the create/schedule routes' own
 * cross-origin cases. Without the same-origin check, any page could archive
 * an operator's journeys just by getting them to load it.
 */
function crossSite(method: string): Request {
  principalFromRequest.mockResolvedValue(OPERATOR);
  return new Request('http://localhost/api/platform/clients/acme/journeys/acme-home', {
    method,
    headers: {
      'content-type': 'application/json',
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
    },
  });
}

function params(clientId: string, journeyId: string) {
  return { params: Promise.resolve({ clientId, journeyId }) };
}

function getPlatformStore() {
  return platform;
}

beforeEach(async () => {
  principalFromRequest.mockReset();
  principalFromRequest.mockResolvedValue(null);
  platform = new MemoryPlatformStore();
  setPlatformStore(platform);
  await platform.upsertClient({ id: 'acme', name: 'Acme' });
  await platform.upsertClient({ id: 'other-client', name: 'Other' });
  await platform.upsertJourney({
    id: 'acme-home',
    clientId: 'acme',
    name: 'Home',
    steps: [],
  });
});

describe('DELETE /api/platform/clients/[clientId]/journeys/[journeyId]', () => {
  it('refuses an unauthenticated request', async () => {
    const response = await DELETE(request('DELETE'), params('acme', 'acme-home'));
    expect(response.status).toBe(401);
  });

  it('refuses a cookie carried cross-origin', async () => {
    const response = await DELETE(crossSite('DELETE'), params('acme', 'acme-home'));

    expect(response.status).toBe(401);
    // The refusal has to have stopped the write, not just answered 401.
    expect((await getPlatformStore().getJourney('acme-home'))?.archivedAt).toBeUndefined();
  });

  it("refuses another client's journey", async () => {
    const response = await DELETE(authed('DELETE'), params('other-client', 'acme-home'));

    expect(response.status).toBe(404);
    // Same reason as above: naming the wrong client must not archive anyway.
    expect((await getPlatformStore().getJourney('acme-home'))?.archivedAt).toBeUndefined();
  });

  it('archives, records who did it, and the journey leaves the list', async () => {
    const response = await DELETE(authed('DELETE'), params('acme', 'acme-home'));
    expect(response.status).toBe(200);

    const journeys = await getPlatformStore().listJourneys('acme');
    expect(journeys.map((j) => j.id)).not.toContain('acme-home');

    const events = await getPlatformStore().listEvents({ clientId: 'acme' });
    expect(events.map((e) => e.action)).toContain('archived a journey');
  });

  it('answers 404 for a journey already archived', async () => {
    await getPlatformStore().archiveJourney('acme-home');

    const response = await DELETE(authed('DELETE'), params('acme', 'acme-home'));

    expect(response.status).toBe(404);
  });
});
