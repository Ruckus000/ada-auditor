import { beforeEach, describe, expect, it } from 'vitest';
import { UNASSIGNED_CLIENT_ID } from '../../src/domain/platform';
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

export const CONTRACT_OPERATOR = 'pc-op-a';
export const CONTRACT_OPERATOR_EMAIL = 'pc-operator@example.com';

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

    it('does not list the placeholder that anchors unowned journeys', async () => {
      // `saveRun` files any journey it has never seen under this id so the
      // foreign key holds. It is not a client anybody added, and the portfolio
      // is supposed to start empty — it showed "Unassigned" on a fresh
      // deployment before this.
      const store = await makeStore();
      await store.upsertClient({ id: UNASSIGNED_CLIENT_ID, name: 'Unassigned' });

      expect((await store.listClients()).map((c) => c.id)).not.toContain(UNASSIGNED_CLIENT_ID);
    });

    it('still resolves the placeholder by id, because a foreign key points at it', async () => {
      // Hidden from the catalog, not from the product: `/clients/<id>` has to
      // keep working, and `saveRun` has to keep succeeding.
      const store = await makeStore();
      await store.upsertClient({ id: UNASSIGNED_CLIENT_ID, name: 'Unassigned' });

      expect(await store.getClient(UNASSIGNED_CLIENT_ID)).toMatchObject({
        id: UNASSIGNED_CLIENT_ID,
      });
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

    // The account behind the name, when there was one. Automation has none,
    // which is why the column is nullable and this is asserted both ways.
    it('records the operator account alongside the name, and copes without one', async () => {
      const store = await makeStore();
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'Contract Client' });
      await store.upsertOperator({
        id: CONTRACT_OPERATOR,
        email: 'pc-actor@example.com',
        name: 'Contract Actor',
        passwordHash: 'scrypt$16384$8$1$c2FsdA==$aGFzaA==',
      });

      await store.recordEvent({
        clientId: CONTRACT_CLIENT,
        actor: 'Contract Actor',
        actorOperatorId: CONTRACT_OPERATOR,
        action: 'signed in',
      });
      await store.recordEvent({
        clientId: CONTRACT_CLIENT,
        actor: 'Scheduler',
        action: 'started a scheduled run',
      });

      const events = await store.listEvents({ clientId: CONTRACT_CLIENT });
      const byOperator = events.find((event) => event.action === 'signed in');
      const byMachine = events.find((event) => event.action === 'started a scheduled run');

      expect(byOperator?.actorOperatorId).toBe(CONTRACT_OPERATOR);
      // Absent, not null: "no account" and "we did not record one" would be
      // the same value otherwise, and only one of those is a fact.
      expect(byMachine).not.toHaveProperty('actorOperatorId');
    });
  });

  describe('triage assignment', () => {
    // `assigned` has existed in the schema since Phase 2C with nothing able to
    // reach it, because one shared token meant there was nobody to assign to.
    it('round-trips an assignment to a real operator', async () => {
      const store = await makeStore();
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'Contract Client' });
      await store.upsertOperator({
        id: CONTRACT_OPERATOR,
        email: CONTRACT_OPERATOR_EMAIL,
        name: 'Contract Operator',
        passwordHash: 'scrypt$16384$8$1$c2FsdA==$aGFzaA==',
      });

      await store.setTriage(
        triageEntry({
          state: 'assigned',
          note: undefined,
          assignee: 'Contract Operator',
          assigneeOperatorId: CONTRACT_OPERATOR,
        }),
      );

      const [entry] = await store.listTriage(CONTRACT_CLIENT);
      expect(entry).toMatchObject({
        state: 'assigned',
        assignee: 'Contract Operator',
        assigneeOperatorId: CONTRACT_OPERATOR,
      });
    });

    // A dismissal has no assignee, and absent must stay absent — `undefined`
    // and "assigned to nobody" are different facts.
    it('leaves the assignee absent on a dismissal', async () => {
      const store = await makeStore();
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'Contract Client' });

      await store.setTriage(triageEntry());

      const [entry] = await store.listTriage(CONTRACT_CLIENT);
      expect(entry).not.toHaveProperty('assigneeOperatorId');
    });
  });

  describe('scheduling', () => {
    const thisHour = new Date().getUTCHours();

    async function scheduled(id: string, overrides: Record<string, unknown> = {}) {
      await store_.upsertJourney({
        id,
        clientId: CONTRACT_CLIENT,
        name: id,
        targetUrl: `https://${id}.test/`,
        schedule: 'daily',
        scheduleHour: thisHour,
        steps: [{ action: 'navigate', type: 'goto', path: '/' }],
        ...overrides,
      });
    }

    let store_: PlatformStore;

    beforeEach(async () => {
      store_ = await makeStore();
      await store_.upsertClient({ id: CONTRACT_CLIENT, name: 'Contract Client' });
    });

    it('claims a journey due this hour', async () => {
      await scheduled('pc-journey-due');

      const claimed = await store_.claimDueJourneys(10);

      expect(claimed.map((journey) => journey.id)).toContain('pc-journey-due');
    });

    /**
     * A claim is a promise to dispatch, and a dispatch can fail.
     *
     * `claimDueJourneys` stamps the journey inside the claiming statement,
     * before anything has been sent. Without a way to give the claim back, a
     * dispatch that failed was indistinguishable from one that succeeded: the
     * journey was marked done and waited for its next window having never run.
     * The scheduler's whole job is that a site gets re-audited, so a silently
     * dropped run is the failure that matters most here.
     */
    it('makes a released journey claimable again', async () => {
      await scheduled('pc-journey-released');

      await store_.claimDueJourneys(10);
      expect(
        (await store_.claimDueJourneys(10)).map((journey) => journey.id),
      ).not.toContain('pc-journey-released');

      await store_.releaseJourneyClaim('pc-journey-released');

      expect((await store_.claimDueJourneys(10)).map((journey) => journey.id)).toContain(
        'pc-journey-released',
      );
    });

    it('releases a journey that was never claimed without complaining', async () => {
      // The tick releases on any dispatch failure and cannot know whether the
      // claim landed. Throwing here would turn a failed run into a failed tick.
      await scheduled('pc-journey-unclaimed');

      await expect(store_.releaseJourneyClaim('pc-journey-unclaimed')).resolves.toBeUndefined();
      await expect(store_.releaseJourneyClaim('pc-journey-missing')).resolves.toBeUndefined();
    });

    /**
     * Claim and stamp are one operation, because the Neon HTTP driver has no
     * transactions: a select followed by an update would let two overlapping
     * ticks both start the same journey.
     */
    it('does not claim the same journey twice in a window', async () => {
      await scheduled('pc-journey-once');

      await store_.claimDueJourneys(10);
      const second = await store_.claimDueJourneys(10);

      expect(second.map((journey) => journey.id)).not.toContain('pc-journey-once');
    });

    /**
     * The sequential case above passes without any locking at all — by the time
     * the second call runs, the first has already stamped the row. This one is
     * the case that fails without `for update skip locked`: two ticks in flight
     * at once, both evaluating the subquery before either commits.
     *
     * Overlap is not hypothetical. The tick accepts a manual trigger with the
     * run token, so an operator proving a new schedule while the hour rolls
     * over is exactly this. A double claim means one journey audited twice and
     * a client billed for it.
     */
    it('does not hand the same journey to two concurrent claims', async () => {
      await scheduled('pc-journey-race');

      const [first, second] = await Promise.all([
        store_.claimDueJourneys(10),
        store_.claimDueJourneys(10),
      ]);

      const claims = [...first, ...second].filter((journey) => journey.id === 'pc-journey-race');
      expect(claims).toHaveLength(1);
    });

    it('leaves an unscheduled journey alone', async () => {
      await scheduled('pc-journey-off', { schedule: 'off' });

      const claimed = await store_.claimDueJourneys(10);

      expect(claimed.map((journey) => journey.id)).not.toContain('pc-journey-off');
    });

    it('leaves a journey scheduled for a different hour alone', async () => {
      await scheduled('pc-journey-later', { scheduleHour: (thisHour + 5) % 24 });

      const claimed = await store_.claimDueJourneys(10);

      expect(claimed.map((journey) => journey.id)).not.toContain('pc-journey-later');
    });

    // Scheduling a journey with no target would book a recurring failure.
    it('never claims a journey with no target URL', async () => {
      await scheduled('pc-journey-targetless', { targetUrl: undefined });

      const claimed = await store_.claimDueJourneys(10);

      expect(claimed.map((journey) => journey.id)).not.toContain('pc-journey-targetless');
    });

    /**
     * Falsy, not null.
     *
     * The two stores express the same rule in different languages, and this is
     * the value where they drifted: `journeyRunRefusal` refuses any falsy
     * `targetUrl`, while the SQL asked `target_url is not null`, which an
     * empty string satisfies. No writer can store one — both routes take
     * `z.url()` — so the disagreement was invisible, and stayed invisible
     * because this contract only ever seeded `undefined`.
     */
    it('never claims a journey whose target URL is empty', async () => {
      await scheduled('pc-journey-blank-target', { targetUrl: '' });

      const claimed = await store_.claimDueJourneys(10);

      expect(claimed.map((journey) => journey.id)).not.toContain('pc-journey-blank-target');
    });

    /**
     * The other half of the same rule, and the half that was missing.
     *
     * A journey with a target and no steps is refused by the run route, so
     * claiming it dispatches a certain failure: one wasted run-budget slot and
     * one "started a scheduled run" in the client's activity feed per tick,
     * for as long as the schedule stands. The filter has to be whatever the
     * run route refuses, not a subset of it.
     */
    it('never claims a journey with no steps', async () => {
      await scheduled('pc-journey-stepless', { steps: [] });

      const claimed = await store_.claimDueJourneys(10);

      expect(claimed.map((journey) => journey.id)).not.toContain('pc-journey-stepless');
    });

    /**
     * `steps` is `jsonb`, and this column predates any write-time validation,
     * so a row can hold something that is not an array at all. Postgres needs
     * the `jsonb_typeof` guard for this: `jsonb_array_length` raises on a
     * non-array, which would take down the whole tick rather than skip one
     * journey.
     */
    it('never claims a journey whose steps are not an array', async () => {
      await scheduled('pc-journey-badsteps', {
        steps: { banana: 1 } as unknown as unknown[],
      });

      const claimed = await store_.claimDueJourneys(10);

      expect(claimed.map((journey) => journey.id)).not.toContain('pc-journey-badsteps');
    });

    it('never claims an archived journey', async () => {
      await scheduled('pc-journey-archived');
      await store_.archiveJourney('pc-journey-archived');

      const claimed = await store_.claimDueJourneys(10);

      expect(claimed.map((journey) => journey.id)).not.toContain('pc-journey-archived');
    });

    // The Postgres store claims across the whole table, so this asserts the
    // cap holds rather than an exact set — same caveat as `listClients`.
    //
    // Not a formality: this is the case that caught `where id in (select …
    // limit n for update skip locked)` updating all three of these. The limit
    // is `CRON_MAX_STARTS_PER_TICK`, and each claimed journey becomes its own
    // invocation with its own browser. Only real Postgres can fail it — the
    // memory double slices the array and is right by construction.
    it('honours the limit', async () => {
      await scheduled('pc-journey-a');
      await scheduled('pc-journey-b');
      await scheduled('pc-journey-c');

      expect((await store_.claimDueJourneys(2)).length).toBeLessThanOrEqual(2);
    });
  });

  describe('operators', () => {
    const hash = 'scrypt$16384$8$1$c2FsdA==$aGFzaA==';

    async function seedOperator(store: PlatformStore, overrides: Partial<{ name: string }> = {}) {
      await store.upsertOperator({
        id: CONTRACT_OPERATOR,
        email: CONTRACT_OPERATOR_EMAIL,
        name: overrides.name ?? 'Contract Operator',
        passwordHash: hash,
      });
    }

    it('round-trips an operator', async () => {
      const store = await makeStore();
      await seedOperator(store);

      const found = await store.getOperator(CONTRACT_OPERATOR);
      expect(found?.email).toBe(CONTRACT_OPERATOR_EMAIL);
      expect(found?.name).toBe('Contract Operator');
      expect(found?.sessionEpoch).toBe(1);
      expect(found).not.toHaveProperty('disabledAt');
    });

    // The hash must not have a shape it can leak through. `listOperators`
    // feeds an API response, so this is asserted rather than assumed.
    it('never returns a password hash from the listing or the id lookup', async () => {
      const store = await makeStore();
      await seedOperator(store);

      expect(await store.getOperator(CONTRACT_OPERATOR)).not.toHaveProperty('passwordHash');
      const listed = (await store.listOperators()).find((o) => o.id === CONTRACT_OPERATOR);
      expect(listed).toBeDefined();
      expect(listed).not.toHaveProperty('passwordHash');
    });

    it('returns the hash only from the sign-in lookup', async () => {
      const store = await makeStore();
      await seedOperator(store);

      expect((await store.getOperatorByEmail(CONTRACT_OPERATOR_EMAIL))?.passwordHash).toBe(hash);
    });

    // An email address is not case-sensitive to the person who owns it, and a
    // sign-in form is where that gets tested in anger.
    it('looks an operator up by email regardless of case', async () => {
      const store = await makeStore();
      await seedOperator(store);

      expect(
        (await store.getOperatorByEmail(CONTRACT_OPERATOR_EMAIL.toUpperCase()))?.id,
      ).toBe(CONTRACT_OPERATOR);
    });

    it('reports an unknown operator as absent rather than throwing', async () => {
      const store = await makeStore();
      expect(await store.getOperator('pc-op-nobody')).toBeNull();
      expect(await store.getOperatorByEmail('pc-nobody@example.com')).toBeNull();
    });

    // Upsert is by email, not id: a disabled operator keeps their row, so an
    // insert keyed on id would fail for anyone ever disabled — making "re-hire"
    // a manual psql session.
    it('updates in place when the same email is added again', async () => {
      const store = await makeStore();
      await seedOperator(store);
      await store.upsertOperator({
        id: 'pc-op-a-different-id',
        email: CONTRACT_OPERATOR_EMAIL,
        name: 'Renamed Operator',
        passwordHash: hash,
      });

      const all = (await store.listOperators()).filter(
        (o) => o.email.toLowerCase() === CONTRACT_OPERATOR_EMAIL,
      );
      expect(all).toHaveLength(1);
      expect(all[0]!.id).toBe(CONTRACT_OPERATOR);
      expect(all[0]!.name).toBe('Renamed Operator');
    });

    // The unique index is on `lower(email)`, so a differently-cased re-add
    // must update rather than collide. This is the case where the two stores
    // most easily disagree: the double compares case-insensitively for free,
    // while Postgres only does if the conflict target names the index.
    it('updates in place when the same email is added in a different case', async () => {
      const store = await makeStore();
      await seedOperator(store);

      await store.upsertOperator({
        id: 'pc-op-a-shouted',
        email: CONTRACT_OPERATOR_EMAIL.toUpperCase(),
        name: 'Shouted Operator',
        passwordHash: hash,
      });

      const all = (await store.listOperators()).filter(
        (o) => o.email.toLowerCase() === CONTRACT_OPERATOR_EMAIL,
      );
      expect(all).toHaveLength(1);
      expect(all[0]!.id).toBe(CONTRACT_OPERATOR);
      expect(all[0]!.name).toBe('Shouted Operator');
    });

    it('bumps the session epoch', async () => {
      const store = await makeStore();
      await seedOperator(store);

      await store.bumpSessionEpoch(CONTRACT_OPERATOR);

      expect((await store.getOperator(CONTRACT_OPERATOR))?.sessionEpoch).toBe(2);
    });

    // Disabling has to end the sessions that already exist, or "disabled"
    // means "cannot sign in again" rather than "is out now".
    it('disabling stamps disabledAt and invalidates outstanding sessions', async () => {
      const store = await makeStore();
      await seedOperator(store);

      await store.setOperatorDisabled(CONTRACT_OPERATOR, true);

      const disabled = await store.getOperator(CONTRACT_OPERATOR);
      expect(disabled?.disabledAt).toBeDefined();
      expect(disabled?.sessionEpoch).toBe(2);
    });

    it('re-enabling clears disabledAt rather than blanking it', async () => {
      const store = await makeStore();
      await seedOperator(store);
      await store.setOperatorDisabled(CONTRACT_OPERATOR, true);

      await store.setOperatorDisabled(CONTRACT_OPERATOR, false);

      expect(await store.getOperator(CONTRACT_OPERATOR)).not.toHaveProperty('disabledAt');
    });
  });
}
