import { beforeEach, describe, expect, it } from 'vitest';
import type { PlatformStore, TriageEntry } from '../../src/domain/platform';

/**
 * The behaviour every `PlatformStore` owes its callers.
 *
 * Same reasoning as `run-store-contract.ts`: the in-memory double exists so
 * the fast suite needs no database, and a double that quietly disagrees with
 * the real store means every route test is green about behaviour production
 * does not have.
 *
 * ## Isolation
 *
 * Everything here is prefixed `pc-`, and the Postgres suite deletes exactly
 * those rows. The prefix is deliberately different from the run-store
 * contract's `contract-`: both suites run against one database and both delete
 * their namespace from `journeys`, so a shared prefix lets one suite remove
 * the other's fixtures mid-run. Note that `listClients()` and `listEvents()` take no
 * filter that can scope them, so their assertions use `toContain` and never
 * `toEqual`/`toHaveLength` — the Postgres store runs against a database that
 * already holds real rows, and "these are all the clients" is only true of an
 * empty table. That lesson is already paid for: the first real audit turned
 * the run-store contract red for reasons that had nothing to do with the store.
 */

export const CONTRACT_CLIENT = 'pc-client-a';

/**
 * The runs the report cases attach to.
 *
 * `reports.request_id` is a foreign key, so these rows have to exist before a
 * report can. The memory store has no way to enforce that, so it passed while
 * Postgres rejected every report insert — precisely the drift this shared
 * contract exists to surface. Each harness makes them exist its own way.
 */
export const CONTRACT_RUN_IDS = ['pc-run-a', 'pc-run-b'];

export type PlatformContractOptions = {
  /** Called before the report cases. A no-op where nothing enforces the FK. */
  seedRuns?: () => Promise<void>;
};

export function triageEntry(overrides: Partial<TriageEntry> = {}): TriageEntry {
  return {
    clientId: CONTRACT_CLIENT,
    findingKey: 'deterministic:color-contrast:https://a.example/x:#hero',
    source: 'deterministic',
    code: 'color-contrast',
    pageUrl: 'https://a.example/x',
    selector: '#hero',
    state: 'dismissed',
    note: 'Decorative element, accepted.',
    actor: 'Operator',
    ...overrides,
  };
}

export function platformStoreContract(
  makeStore: () => Promise<PlatformStore> | PlatformStore,
  options: PlatformContractOptions = {},
): void {
  describe('clients', () => {
    it('round-trips a client', async () => {
      const store = await makeStore();
      await store.upsertClient({
        id: CONTRACT_CLIENT,
        name: 'Contract Client',
        owner: 'Alex Reed',
      });

      expect(await store.getClient(CONTRACT_CLIENT)).toMatchObject({
        id: CONTRACT_CLIENT,
        name: 'Contract Client',
        owner: 'Alex Reed',
      });
    });

    it('omits an absent owner rather than storing undefined', async () => {
      const store = await makeStore();
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'No Owner' });

      expect(await store.getClient(CONTRACT_CLIENT)).not.toHaveProperty('owner');
    });

    it('updates rather than duplicating on a second upsert', async () => {
      const store = await makeStore();
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'First' });
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'Second' });

      const listed = (await store.listClients()).filter((c) => c.id === CONTRACT_CLIENT);
      expect(listed).toHaveLength(1);
      expect(listed[0].name).toBe('Second');
    });

    it('keeps an owner the caller did not mention', async () => {
      // `owner` is optional on the input, so a rename passes only id and name.
      // Writing it unconditionally set it to null and silently dropped the
      // value the portfolio column and its `?owner=` filter both read.
      const store = await makeStore();
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'First', owner: 'Alex Reed' });
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'Renamed' });

      expect(await store.getClient(CONTRACT_CLIENT)).toMatchObject({
        name: 'Renamed',
        owner: 'Alex Reed',
      });
    });

    it('returns null for a client that does not exist', async () => {
      const store = await makeStore();
      expect(await store.getClient('pc-missing')).toBeNull();
    });

    it('round-trips client config', async () => {
      const store = await makeStore();
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'Contract Client' });
      await store.setClientConfig(CONTRACT_CLIENT, { startUrl: 'https://a.example' });

      expect(await store.getClientConfig(CONTRACT_CLIENT)).toEqual({
        startUrl: 'https://a.example',
      });
    });

    it('distinguishes no config from empty config', async () => {
      const store = await makeStore();
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'Contract Client' });

      expect(await store.getClientConfig(CONTRACT_CLIENT)).toBeNull();

      await store.setClientConfig(CONTRACT_CLIENT, {});
      expect(await store.getClientConfig(CONTRACT_CLIENT)).toEqual({});
    });
  });

  describe('journeys', () => {
    async function seeded(): Promise<PlatformStore> {
      const store = await makeStore();
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'Contract Client' });
      return store;
    }

    it('round-trips a journey with its steps', async () => {
      const store = await seeded();
      await store.upsertJourney({
        id: 'pc-journey-a',
        clientId: CONTRACT_CLIENT,
        name: 'Checkout',
        targetUrl: 'https://a.example',
        steps: [{ action: 'navigate', type: 'goto', path: '/' }],
      });

      const journey = await store.getJourney('pc-journey-a');
      expect(journey).toMatchObject({ name: 'Checkout', clientId: CONTRACT_CLIENT });
      expect(journey?.steps).toEqual([{ action: 'navigate', type: 'goto', path: '/' }]);
    });

    it('archives rather than deletes', async () => {
      // `runs` cascades from `journeys`, so a delete would destroy audit
      // history. Archiving hides the journey from the catalog and keeps it.
      const store = await seeded();
      await store.upsertJourney({
        id: 'pc-journey-a',
        clientId: CONTRACT_CLIENT,
        name: 'Checkout',
        steps: [],
      });
      await store.archiveJourney('pc-journey-a');

      expect(await store.getJourney('pc-journey-a')).not.toBeNull();
      expect(
        (await store.listJourneys(CONTRACT_CLIENT)).map((j) => j.id),
      ).not.toContain('pc-journey-a');
    });

    it('filters a listing by client', async () => {
      const store = await seeded();
      await store.upsertClient({ id: 'pc-client-b', name: 'Other' });
      await store.upsertJourney({
        id: 'pc-journey-a',
        clientId: CONTRACT_CLIENT,
        name: 'A',
        steps: [],
      });
      await store.upsertJourney({
        id: 'pc-journey-b',
        clientId: 'pc-client-b',
        name: 'B',
        steps: [],
      });

      const ids = (await store.listJourneys(CONTRACT_CLIENT)).map((j) => j.id);
      expect(ids).toContain('pc-journey-a');
      expect(ids).not.toContain('pc-journey-b');
    });
  });

  describe('triage', () => {
    async function seeded(): Promise<PlatformStore> {
      const store = await makeStore();
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'Contract Client' });
      return store;
    }

    it('round-trips a dismissal with its note', async () => {
      const store = await seeded();
      await store.setTriage(triageEntry());

      const [entry] = await store.listTriage(CONTRACT_CLIENT);
      expect(entry).toMatchObject({
        state: 'dismissed',
        note: 'Decorative element, accepted.',
        actor: 'Operator',
        code: 'color-contrast',
      });
    });

    it('is keyed on the finding, so a second decision replaces the first', async () => {
      const store = await seeded();
      await store.setTriage(triageEntry({ state: 'dismissed', note: 'first' }));
      await store.setTriage(triageEntry({ state: 'assigned', note: undefined }));

      const entries = await store.listTriage(CONTRACT_CLIENT);
      expect(entries).toHaveLength(1);
      expect(entries[0].state).toBe('assigned');
    });

    it('keeps two different findings apart', async () => {
      const store = await seeded();
      await store.setTriage(triageEntry({ findingKey: 'deterministic:a::#one' }));
      await store.setTriage(triageEntry({ findingKey: 'deterministic:a::#two' }));

      expect(await store.listTriage(CONTRACT_CLIENT)).toHaveLength(2);
    });

    it('scopes triage to its client', async () => {
      const store = await seeded();
      await store.upsertClient({ id: 'pc-client-b', name: 'Other' });
      await store.setTriage(triageEntry());

      expect(await store.listTriage('pc-client-b')).toEqual([]);
    });

    it('clears a decision', async () => {
      const store = await seeded();
      const entry = triageEntry();
      await store.setTriage(entry);
      await store.clearTriage(CONTRACT_CLIENT, entry.findingKey);

      expect(await store.listTriage(CONTRACT_CLIENT)).toEqual([]);
    });
  });

  describe('reports', () => {
    beforeEach(async () => {
      await options.seedRuns?.();
    });

    it('finds a report by its share token', async () => {
      const store = await makeStore();
      await store.createReport({
        id: 'pc-report-a',
        requestId: 'pc-run-a',
        shareToken: 'pc-token-a',
        audience: 'legal',
        title: 'Contract report',
      });

      expect(await store.getReportByToken('pc-token-a')).toMatchObject({
        id: 'pc-report-a',
        requestId: 'pc-run-a',
        audience: 'legal',
      });
    });

    it('makes a revoked token unusable', async () => {
      // Revocation is the real control on a public link — the rate limiter is
      // a speed bump. A revoked token must stop resolving immediately.
      const store = await makeStore();
      await store.createReport({
        id: 'pc-report-a',
        requestId: 'pc-run-a',
        shareToken: 'pc-token-a',
      });
      await store.revokeShareToken('pc-report-a');

      expect(await store.getReportByToken('pc-token-a')).toBeNull();
      expect(await store.getReport('pc-report-a')).not.toBeNull();
    });

    it('returns null for an unknown token rather than throwing', async () => {
      const store = await makeStore();
      expect(await store.getReportByToken('pc-token-nope')).toBeNull();
    });

    it('lists reports for the runs asked for', async () => {
      const store = await makeStore();
      await store.createReport({ id: 'pc-report-a', requestId: 'pc-run-a' });
      await store.createReport({ id: 'pc-report-b', requestId: 'pc-run-b' });

      const ids = (await store.listReports(['pc-run-a'])).map((r) => r.id);
      expect(ids).toEqual(['pc-report-a']);
    });

    it('returns nothing for an empty request list without querying', async () => {
      const store = await makeStore();
      expect(await store.listReports([])).toEqual([]);
    });
  });

  describe('activity', () => {
    it('records and reads back an event', async () => {
      const store = await makeStore();
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'Contract Client' });
      await store.recordEvent({
        clientId: CONTRACT_CLIENT,
        actor: 'Operator',
        action: 'dismissed a finding',
        subject: 'color-contrast on /checkout',
        metadata: { findingKey: 'deterministic:color-contrast::#hero' },
      });

      const [event] = await store.listEvents({ clientId: CONTRACT_CLIENT });
      expect(event).toMatchObject({
        actor: 'Operator',
        action: 'dismissed a finding',
        subject: 'color-contrast on /checkout',
      });
      expect(event.metadata).toEqual({
        findingKey: 'deterministic:color-contrast::#hero',
      });
    });

    it('returns events newest first', async () => {
      const store = await makeStore();
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'Contract Client' });
      await store.recordEvent({ clientId: CONTRACT_CLIENT, actor: 'Operator', action: 'first' });
      await store.recordEvent({ clientId: CONTRACT_CLIENT, actor: 'Operator', action: 'second' });

      const actions = (await store.listEvents({ clientId: CONTRACT_CLIENT })).map(
        (e) => e.action,
      );
      expect(actions).toEqual(['second', 'first']);
    });

    it('clamps the limit so one call cannot pull the whole log', async () => {
      const store = await makeStore();
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'Contract Client' });
      await store.recordEvent({ clientId: CONTRACT_CLIENT, actor: 'Operator', action: 'a' });
      await store.recordEvent({ clientId: CONTRACT_CLIENT, actor: 'Operator', action: 'b' });

      expect(await store.listEvents({ clientId: CONTRACT_CLIENT, limit: 1 })).toHaveLength(1);
      expect(
        (await store.listEvents({ clientId: CONTRACT_CLIENT, limit: 100_000 })).length,
      ).toBeLessThanOrEqual(200);
    });
  });
}
