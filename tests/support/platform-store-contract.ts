import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CLIENT_DOCUMENT_LIST_MAX,
  DOCUMENT_INSPECTION_LIST_MAX,
  UNASSIGNED_CLIENT_ID,
} from '../../src/domain/platform';
import type {
  PlatformStore,
  StoredDocumentConversion,
  StoredDocumentInspection,
  TriageEntry,
} from '../../src/domain/platform';
import type { RemediationSummary } from '../../src/domain/document-remediation';

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

/**
 * This process's own corner of the database. See `CONTRACT_PREFIX` in
 * `run-store-contract.ts` for why it exists; this is the catalog half.
 *
 * It covers the emails as well as the ids, and that is not tidiness:
 * `operators.email` is `not null unique` with a second unique index on
 * `lower(email)`, so two runs inserting one literal address collide outright
 * rather than merely reading each other's rows.
 */
export const PLATFORM_PREFIX = `pc-${randomUUID().slice(0, 8)}`;

export const CONTRACT_CLIENT = `${PLATFORM_PREFIX}-client-a`;

/**
 * The runs the report cases attach to.
 *
 * `reports.request_id` is a foreign key, so these rows have to exist before a
 * report can. The memory store has no way to enforce that, so it passed while
 * Postgres rejected every report insert — precisely the drift this shared
 * contract exists to surface. Each harness makes them exist its own way.
 */
export const CONTRACT_RUN_IDS = [`${PLATFORM_PREFIX}-run-a`, `${PLATFORM_PREFIX}-run-b`];

export const CONTRACT_OPERATOR = `${PLATFORM_PREFIX}-op-a`;
export const CONTRACT_OPERATOR_EMAIL = `${PLATFORM_PREFIX}-operator@example.com`;

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

export function inspectionSummary(
  overrides: Partial<RemediationSummary> = {},
): RemediationSummary {
  return {
    title: 'already-titled',
    // Deliberately present: the store must round-trip the title verbatim. The
    // rule that strips it (`logSafe`) is about log lines, never storage.
    titleText: 'Meeting agenda, March',
    sourceLanguage: 'en-US',
    tagged: false,
    pages: 4,
    headings: 0,
    tables: 2,
    lists: 0,
    figures: 3,
    gaps: [
      '1.1.1: 3 figures with no alt text',
      '1.3.1: the output carries no structure tree',
    ],
    ...overrides,
  };
}

export function inspectionRecord(
  overrides: Partial<StoredDocumentInspection> = {},
): StoredDocumentInspection {
  return {
    id: `${PLATFORM_PREFIX}-doc-a`,
    clientId: CONTRACT_CLIENT,
    // A stored string, not an FK — `document_inspections.document_id` is
    // deliberately unconstrained so the backfill migration stays one
    // idempotent statement. The linked cases below use real document rows.
    documentId: `${PLATFORM_PREFIX}-document-a`,
    url: 'https://town.example/minutes/agenda.pdf',
    foundOn: 'https://town.example/meetings',
    source: 'crawl',
    summary: inspectionSummary(),
    inspectedAt: '2026-08-26T12:00:00.000Z',
    ...overrides,
  };
}

export function conversionRecord(
  overrides: Partial<StoredDocumentConversion> = {},
): StoredDocumentConversion {
  return {
    id: `${PLATFORM_PREFIX}-conv-a`,
    clientId: CONTRACT_CLIENT,
    documentId: `${PLATFORM_PREFIX}-document-a`,
    summary: inspectionSummary({ tagged: true, gaps: [] }),
    inputSha256: 'a'.repeat(64),
    outputSha256: 'b'.repeat(64),
    convertedAt: '2026-08-26T12:00:00.000Z',
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
      expect(await store.getClient(`${PLATFORM_PREFIX}-missing`)).toBeNull();
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
        id: `${PLATFORM_PREFIX}-journey-a`,
        clientId: CONTRACT_CLIENT,
        name: 'Checkout',
        targetUrl: 'https://a.example',
        steps: [{ action: 'navigate', type: 'goto', path: '/' }],
      });

      const journey = await store.getJourney(`${PLATFORM_PREFIX}-journey-a`);
      expect(journey).toMatchObject({ name: 'Checkout', clientId: CONTRACT_CLIENT });
      expect(journey?.steps).toEqual([{ action: 'navigate', type: 'goto', path: '/' }]);
    });

    it('round-trips the hosts a journey may pass through, and leaves them absent when unset', async () => {
      // The list decides where a browser is allowed to go, so a store that
      // dropped it would not fail loudly — it would quietly narrow the
      // allowlist back to the target and break every SSO journey with a
      // refusal naming a host the operator did write down.
      const store = await seeded();
      await store.upsertJourney({
        id: `${PLATFORM_PREFIX}-journey-sso`,
        clientId: CONTRACT_CLIENT,
        name: 'SSO',
        targetUrl: 'https://a.example',
        allowedHosts: ['acme.okta.com', 'login.okta.com'],
        steps: [{ action: 'navigate', type: 'goto', path: '/' }],
      });
      await store.upsertJourney({
        id: `${PLATFORM_PREFIX}-journey-plain`,
        clientId: CONTRACT_CLIENT,
        name: 'Plain',
        steps: [],
      });

      expect((await store.getJourney(`${PLATFORM_PREFIX}-journey-sso`))?.allowedHosts).toEqual([
        'acme.okta.com',
        'login.okta.com',
      ]);
      // Absent, not `[]`. Every other nullable column here reads "not
      // recorded" that way, and an empty array would make a row written before
      // the column look like one an operator deliberately cleared.
      expect((await store.getJourney(`${PLATFORM_PREFIX}-journey-plain`))?.allowedHosts).toBeUndefined();
    });

    it('archives rather than deletes', async () => {
      // `runs` cascades from `journeys`, so a delete would destroy audit
      // history. Archiving hides the journey from the catalog and keeps it.
      const store = await seeded();
      await store.upsertJourney({
        id: `${PLATFORM_PREFIX}-journey-a`,
        clientId: CONTRACT_CLIENT,
        name: 'Checkout',
        steps: [],
      });
      await store.archiveJourney(`${PLATFORM_PREFIX}-journey-a`);

      expect(await store.getJourney(`${PLATFORM_PREFIX}-journey-a`)).not.toBeNull();
      expect(
        (await store.listJourneys(CONTRACT_CLIENT)).map((j) => j.id),
      ).not.toContain(`${PLATFORM_PREFIX}-journey-a`);
    });

    it('hides an archived journey by default and surfaces it on request', async () => {
      // The create route mints ids against every id that exists, archived or
      // not: an archived journey's id is retired, not vacant, because
      // `upsertJourney`'s on-conflict update preserves `archived_at` — reusing
      // the id would resurrect the old row born archived. This is the read
      // path that check leans on, scoped and unscoped both.
      const store = await seeded();
      await store.upsertJourney({
        id: `${PLATFORM_PREFIX}-journey-retired`,
        clientId: CONTRACT_CLIENT,
        name: 'Retired',
        steps: [],
      });
      await store.archiveJourney(`${PLATFORM_PREFIX}-journey-retired`);

      expect(
        (await store.listJourneys(CONTRACT_CLIENT)).map((j) => j.id),
      ).not.toContain(`${PLATFORM_PREFIX}-journey-retired`);
      expect((await store.listJourneys()).map((j) => j.id)).not.toContain(`${PLATFORM_PREFIX}-journey-retired`);

      const withArchived = await store.listJourneys(CONTRACT_CLIENT, { includeArchived: true });
      const retired = withArchived.find((j) => j.id === `${PLATFORM_PREFIX}-journey-retired`);
      expect(retired).toBeDefined();
      expect(retired?.archivedAt).toBeDefined();
    });

    it('filters a listing by client', async () => {
      const store = await seeded();
      await store.upsertClient({ id: `${PLATFORM_PREFIX}-client-b`, name: 'Other' });
      await store.upsertJourney({
        id: `${PLATFORM_PREFIX}-journey-a`,
        clientId: CONTRACT_CLIENT,
        name: 'A',
        steps: [],
      });
      await store.upsertJourney({
        id: `${PLATFORM_PREFIX}-journey-b`,
        clientId: `${PLATFORM_PREFIX}-client-b`,
        name: 'B',
        steps: [],
      });

      const ids = (await store.listJourneys(CONTRACT_CLIENT)).map((j) => j.id);
      expect(ids).toContain(`${PLATFORM_PREFIX}-journey-a`);
      expect(ids).not.toContain(`${PLATFORM_PREFIX}-journey-b`);
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
      await store.upsertClient({ id: `${PLATFORM_PREFIX}-client-b`, name: 'Other' });
      await store.setTriage(triageEntry());

      expect(await store.listTriage(`${PLATFORM_PREFIX}-client-b`)).toEqual([]);
    });

    it('round-trips an accepted risk as its own state', async () => {
      // Not a dismissal. The CHECK has allowed `accepted-risk` since Phase 2C
      // and nothing could write one, so this is the first time either store
      // has been asked to carry it back out again.
      const store = await seeded();
      await store.setTriage(
        triageEntry({ state: 'accepted-risk', note: 'Client accepts, signed off.' }),
      );

      const [entry] = await store.listTriage(CONTRACT_CLIENT);
      expect(entry).toMatchObject({
        state: 'accepted-risk',
        note: 'Client accepts, signed off.',
      });
    });

    it('replaces a dismissal with an accepted risk on the same finding', async () => {
      // The `on conflict do update` path across two states. An operator who
      // decides they were wrong about a barrier gets one row that says so, not
      // two rows that disagree.
      const store = await seeded();
      await store.setTriage(triageEntry({ state: 'dismissed', note: 'not a barrier' }));
      await store.setTriage(
        triageEntry({ state: 'accepted-risk', note: 'it is, and they accept it' }),
      );

      const entries = await store.listTriage(CONTRACT_CLIENT);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        state: 'accepted-risk',
        note: 'it is, and they accept it',
      });
    });

    it('returns triage newest decision first', async () => {
      // The screens read the most recent decision first, and the Postgres
      // index is built for that order. A double that returned insertion order
      // would make the fast suite green about an order production does not
      // have.
      const store = await seeded();
      await store.setTriage(triageEntry({ findingKey: 'deterministic:a::#first' }));
      await store.setTriage(triageEntry({ findingKey: 'deterministic:a::#second' }));
      await store.setTriage(triageEntry({ findingKey: 'deterministic:a::#third' }));

      expect((await store.listTriage(CONTRACT_CLIENT)).map((entry) => entry.findingKey)).toEqual([
        'deterministic:a::#third',
        'deterministic:a::#second',
        'deterministic:a::#first',
      ]);
    });

    it('clears a decision', async () => {
      const store = await seeded();
      const entry = triageEntry();
      await store.setTriage(entry);
      await store.clearTriage(CONTRACT_CLIENT, entry.findingKey);

      expect(await store.listTriage(CONTRACT_CLIENT)).toEqual([]);
    });
  });

  describe('client credentials', () => {
    /**
     * Plaintext in, plaintext out — for BOTH stores.
     *
     * Encryption is the Postgres store's private business (see the comment on
     * its credential section), so the contract sees the same shape either way
     * and the memory double never needs `AUDITOR_CREDENTIAL_KEY`. That is not
     * a weakening: the Postgres harness sets a fixed test key, and asserts
     * separately that what actually lands in the column is ciphertext.
     *
     * The value is an obvious sentinel because the presence cases grep
     * serialised output for it, and a plausible string would make that grep
     * prove nothing.
     */
    const VALUES = {
      user: 'contract-user-sentinel@example.com',
      pass: 'contract-pass-sentinel-hunter2',
    };

    async function seeded(): Promise<PlatformStore> {
      const store = await makeStore();
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'Contract Client' });
      return store;
    }

    it('round-trips a credential for the run path', async () => {
      const store = await seeded();
      await store.setClientCredential(CONTRACT_CLIENT, 'portal', VALUES);

      expect(await store.getClientCredentialValues(CONTRACT_CLIENT, 'portal')).toEqual(VALUES);
    });

    it('lists presence and never a value', async () => {
      const store = await seeded();
      await store.setClientCredential(CONTRACT_CLIENT, 'portal', VALUES);

      const listed = await store.listClientCredentialRefs(CONTRACT_CLIENT);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ ref: 'portal', user: true, pass: true });
      expect(typeof listed[0]!.updatedAt).toBe('string');
      // The whole serialised listing, not chosen fields: a value smuggled out
      // under any key is the leak, and this is the shape screens receive.
      const serialised = JSON.stringify(listed);
      expect(serialised).not.toContain(VALUES.user);
      expect(serialised).not.toContain(VALUES.pass);
    });

    it('overwrites in place rather than stacking a second row', async () => {
      const store = await seeded();
      await store.setClientCredential(CONTRACT_CLIENT, 'portal', VALUES);
      await store.setClientCredential(CONTRACT_CLIENT, 'portal', {
        user: 'contract-user-two@example.com',
        pass: 'contract-pass-two',
      });

      expect(
        (await store.listClientCredentialRefs(CONTRACT_CLIENT)).filter(
          (entry) => entry.ref === 'portal',
        ),
      ).toHaveLength(1);
      expect(await store.getClientCredentialValues(CONTRACT_CLIENT, 'portal')).toEqual({
        user: 'contract-user-two@example.com',
        pass: 'contract-pass-two',
      });
    });

    it("scopes a credential to its client", async () => {
      // Two clients naming one ref is the normal case — every client's login
      // journey plausibly calls its credential `login` — so a read scoped
      // wrong types one client's password into another client's site.
      const store = await seeded();
      await store.upsertClient({ id: `${PLATFORM_PREFIX}-client-b`, name: 'Other' });
      await store.setClientCredential(CONTRACT_CLIENT, 'login', VALUES);

      expect(await store.getClientCredentialValues(`${PLATFORM_PREFIX}-client-b`, 'login')).toBeNull();
      expect(await store.listClientCredentialRefs(`${PLATFORM_PREFIX}-client-b`)).toEqual([]);
    });

    it('deletes a credential', async () => {
      const store = await seeded();
      await store.setClientCredential(CONTRACT_CLIENT, 'portal', VALUES);
      await store.deleteClientCredential(CONTRACT_CLIENT, 'portal');

      expect(await store.getClientCredentialValues(CONTRACT_CLIENT, 'portal')).toBeNull();
      expect(await store.listClientCredentialRefs(CONTRACT_CLIENT)).toEqual([]);
      // Idempotent, like `clearTriage`: the second delete has nothing to do
      // and must not turn that into an error.
      await expect(store.deleteClientCredential(CONTRACT_CLIENT, 'portal')).resolves.toBeUndefined();
    });

    it('reports an absent credential as absent rather than throwing', async () => {
      const store = await seeded();

      expect(await store.getClientCredentialValues(CONTRACT_CLIENT, 'never-stored')).toBeNull();
      expect(await store.listClientCredentialRefs(CONTRACT_CLIENT)).toEqual([]);
    });
  });

  describe('reports', () => {
    beforeEach(async () => {
      await options.seedRuns?.();
    });

    it('finds a report by its share token', async () => {
      const store = await makeStore();
      await store.createReport({
        id: `${PLATFORM_PREFIX}-report-a`,
        requestId: `${PLATFORM_PREFIX}-run-a`,
        shareToken: `${PLATFORM_PREFIX}-token-a`,
        audience: 'legal',
        title: 'Contract report',
      });

      expect(await store.getReportByToken(`${PLATFORM_PREFIX}-token-a`)).toMatchObject({
        id: `${PLATFORM_PREFIX}-report-a`,
        requestId: `${PLATFORM_PREFIX}-run-a`,
        audience: 'legal',
      });
    });

    it('round-trips a documents snapshot whole, and absence stays absent', async () => {
      const store = await makeStore();
      const section = {
        capturedAt: '2026-08-26T12:00:00.000Z',
        totals: {
          documents: 2,
          byKind: { pdf: 1, docx: 1 },
          read: 1,
          withGaps: 1,
          unread: 1,
        },
        entries: [
          {
            url: 'https://town.example/minutes/agenda.pdf',
            kind: 'pdf' as const,
            source: 'crawl' as const,
            foundOn: 'https://town.example/meetings',
            readAt: '2026-08-26T09:00:00.000Z',
            readBy: 'inspection' as const,
            tagged: false,
            pages: 4,
            gaps: ['1.1.1: 3 figures with no alt text'],
          },
        ],
      };

      await store.createReport({
        id: `${PLATFORM_PREFIX}-report-docs`,
        requestId: `${PLATFORM_PREFIX}-run-a`,
        shareToken: `${PLATFORM_PREFIX}-token-docs`,
        documents: section,
      });
      // The snapshot verbatim: a store that reworded or trimmed it would make
      // the shared page disagree with what was issued.
      expect((await store.getReport(`${PLATFORM_PREFIX}-report-docs`))?.documents).toEqual(
        section,
      );

      await store.createReport({
        id: `${PLATFORM_PREFIX}-report-plain`,
        requestId: `${PLATFORM_PREFIX}-run-b`,
        shareToken: `${PLATFORM_PREFIX}-token-plain`,
      });
      expect(await store.getReport(`${PLATFORM_PREFIX}-report-plain`)).not.toHaveProperty(
        'documents',
      );
    });

    it('makes a revoked token unusable', async () => {
      // Revocation is the real control on a public link — the rate limiter is
      // a speed bump. A revoked token must stop resolving immediately.
      const store = await makeStore();
      await store.createReport({
        id: `${PLATFORM_PREFIX}-report-a`,
        requestId: `${PLATFORM_PREFIX}-run-a`,
        shareToken: `${PLATFORM_PREFIX}-token-a`,
      });
      await store.revokeShareToken(`${PLATFORM_PREFIX}-report-a`);

      expect(await store.getReportByToken(`${PLATFORM_PREFIX}-token-a`)).toBeNull();
      expect(await store.getReport(`${PLATFORM_PREFIX}-report-a`)).not.toBeNull();
    });

    it('returns null for an unknown token rather than throwing', async () => {
      const store = await makeStore();
      expect(await store.getReportByToken(`${PLATFORM_PREFIX}-token-nope`)).toBeNull();
    });

    it('lists reports for the runs asked for', async () => {
      const store = await makeStore();
      await store.createReport({ id: `${PLATFORM_PREFIX}-report-a`, requestId: `${PLATFORM_PREFIX}-run-a` });
      await store.createReport({ id: `${PLATFORM_PREFIX}-report-b`, requestId: `${PLATFORM_PREFIX}-run-b` });

      const ids = (await store.listReports([`${PLATFORM_PREFIX}-run-a`])).map((r) => r.id);
      expect(ids).toEqual([`${PLATFORM_PREFIX}-report-a`]);
    });

    it('returns nothing for an empty request list without querying', async () => {
      const store = await makeStore();
      expect(await store.listReports([])).toEqual([]);
    });
  });

  describe('document inspections', () => {
    async function seeded(): Promise<PlatformStore> {
      const store = await makeStore();
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'Contract Client' });
      return store;
    }

    it('round-trips a crawl inspection, summary verbatim', async () => {
      const store = await seeded();
      await store.saveDocumentInspection(inspectionRecord());

      const [record] = await store.listDocumentInspections(CONTRACT_CLIENT);
      expect(record).toEqual(inspectionRecord());
      // The load-bearing halves, named: the title survives storage (only logs
      // strip it), and the gaps come back word for word — a store that
      // rephrased the instrument would drift from what the operator saw.
      expect(record.summary.titleText).toBe('Meeting agenda, March');
      expect(record.summary.gaps).toEqual([
        '1.1.1: 3 figures with no alt text',
        '1.3.1: the output carries no structure tree',
      ]);
    });

    it('omits foundOn on an upload rather than storing null', async () => {
      // An upload was found nowhere. Passed explicitly as undefined, which is
      // exactly the shape a route's optional spread produces — the record must
      // come back with the key absent, matching what a null column reads as.
      const store = await seeded();
      await store.saveDocumentInspection(
        inspectionRecord({
          id: `${PLATFORM_PREFIX}-doc-upload`,
          url: 'agenda.pdf',
          foundOn: undefined,
          source: 'upload',
        }),
      );

      const [record] = await store.listDocumentInspections(CONTRACT_CLIENT);
      expect(record).not.toHaveProperty('foundOn');
      expect(record.source).toBe('upload');
      expect(record.url).toBe('agenda.pdf');
    });

    it('returns inspections newest first', async () => {
      // The caller stamps `inspectedAt`, so the order is asserted against
      // stamps this test chose rather than against write timing.
      const store = await seeded();
      await store.saveDocumentInspection(
        inspectionRecord({
          id: `${PLATFORM_PREFIX}-doc-old`,
          inspectedAt: '2026-08-26T09:00:00.000Z',
        }),
      );
      await store.saveDocumentInspection(
        inspectionRecord({
          id: `${PLATFORM_PREFIX}-doc-new`,
          inspectedAt: '2026-08-26T10:00:00.000Z',
        }),
      );

      const ids = (await store.listDocumentInspections(CONTRACT_CLIENT)).map((r) => r.id);
      expect(ids).toEqual([`${PLATFORM_PREFIX}-doc-new`, `${PLATFORM_PREFIX}-doc-old`]);
    });

    it('keeps the first record when the same id is saved again', async () => {
      // A record is immutable evidence: a second save under one id is a
      // retry, and a retry must not rewrite what the instrument said.
      const store = await seeded();
      await store.saveDocumentInspection(inspectionRecord());
      await store.saveDocumentInspection(
        inspectionRecord({
          summary: inspectionSummary({ pages: 99 }),
          inspectedAt: '2026-08-26T13:00:00.000Z',
        }),
      );

      const records = await store.listDocumentInspections(CONTRACT_CLIENT);
      expect(records).toHaveLength(1);
      expect(records[0].summary.pages).toBe(4);
      expect(records[0].inspectedAt).toBe('2026-08-26T12:00:00.000Z');
    });

    it('scopes the listing to its client', async () => {
      const store = await seeded();
      const otherClient = `${PLATFORM_PREFIX}-client-b`;
      await store.upsertClient({ id: otherClient, name: 'Other Client' });

      await store.saveDocumentInspection(inspectionRecord());
      await store.saveDocumentInspection(
        inspectionRecord({ id: `${PLATFORM_PREFIX}-doc-b`, clientId: otherClient }),
      );

      const ids = (await store.listDocumentInspections(otherClient)).map((r) => r.id);
      expect(ids).toEqual([`${PLATFORM_PREFIX}-doc-b`]);
    });

    it(
      'caps the listing, and what falls off the end is the oldest',
      async () => {
        const store = await seeded();
        const base = Date.parse('2026-08-26T00:00:00.000Z');

        // One more than the cap, stamps strictly increasing. Written in
        // parallel: against real Postgres this is a hundred round trips, and
        // serially it is the difference between a test and a timeout.
        await Promise.all(
          Array.from({ length: DOCUMENT_INSPECTION_LIST_MAX + 1 }, (_, i) =>
            store.saveDocumentInspection(
              inspectionRecord({
                id: `${PLATFORM_PREFIX}-doc-cap-${i}`,
                inspectedAt: new Date(base + i * 1000).toISOString(),
              }),
            ),
          ),
        );

        const listed = await store.listDocumentInspections(CONTRACT_CLIENT);
        expect(listed).toHaveLength(DOCUMENT_INSPECTION_LIST_MAX);
        expect(listed[0].id).toBe(
          `${PLATFORM_PREFIX}-doc-cap-${DOCUMENT_INSPECTION_LIST_MAX}`,
        );
        // The one that fell off is the oldest, because the cap keeps the
        // newest — a cap that trimmed the other end would silently hide the
        // inspection the operator just made.
        expect(listed.map((r) => r.id)).not.toContain(`${PLATFORM_PREFIX}-doc-cap-0`);
      },
      60_000,
    );
  });

  describe('client documents', () => {
    const T0 = '2026-08-26T09:00:00.000Z';
    const T1 = '2026-08-26T10:00:00.000Z';
    const DOC_URL = 'https://town.example/minutes/agenda.pdf';

    async function seeded(): Promise<PlatformStore> {
      const store = await makeStore();
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'Contract Client' });
      return store;
    }

    it('a merge adds what is new and refreshes what is known', async () => {
      const store = await seeded();

      const first = await store.recordDocumentSightings(
        CONTRACT_CLIENT,
        [
          { url: DOC_URL, kind: 'pdf', source: 'crawl', foundOn: 'https://town.example/meetings' },
          { url: 'https://town.example/forms/permit.docx', kind: 'docx', source: 'crawl' },
        ],
        T0,
      );
      expect(first).toEqual({ added: 2, seenAgain: 0 });

      const second = await store.recordDocumentSightings(
        CONTRACT_CLIENT,
        [{ url: DOC_URL, kind: 'pdf', source: 'crawl', foundOn: 'https://town.example/other' }],
        T1,
      );
      expect(second).toEqual({ added: 0, seenAgain: 1 });

      const docs = await store.listClientDocuments(CONTRACT_CLIENT);
      const pdf = docs.find((doc) => doc.url === DOC_URL);
      // Refreshed, not duplicated — and the first sighting keeps `foundOn`,
      // the same rule discovery itself applies.
      expect(docs.filter((doc) => doc.url === DOC_URL)).toHaveLength(1);
      expect(pdf?.firstSeenAt).toBe(T0);
      expect(pdf?.lastSeenAt).toBe(T1);
      expect(pdf?.foundOn).toBe('https://town.example/meetings');
      expect(pdf?.kind).toBe('pdf');
    });

    it('ensureClientDocument returns the same row for a known url', async () => {
      const store = await seeded();

      const created = await store.ensureClientDocument(
        CONTRACT_CLIENT,
        { url: DOC_URL, kind: 'pdf', source: 'crawl' },
        T0,
      );
      const found = await store.ensureClientDocument(
        CONTRACT_CLIENT,
        { url: DOC_URL, kind: 'pdf', source: 'crawl' },
        T1,
      );

      expect(found.id).toBe(created.id);
      expect(found.firstSeenAt).toBe(T0);
      expect(found.lastSeenAt).toBe(T1);
    });

    it('omits foundOn on an upload rather than storing null', async () => {
      const store = await seeded();
      await store.ensureClientDocument(
        CONTRACT_CLIENT,
        { url: 'agenda.docx', kind: 'docx', source: 'upload', foundOn: undefined },
        T0,
      );

      const [doc] = await store.listClientDocuments(CONTRACT_CLIENT);
      expect(doc).not.toHaveProperty('foundOn');
      expect(doc.source).toBe('upload');
    });

    it('the inventory carries the latest word: newest inspection and conversion', async () => {
      const store = await seeded();
      const doc = await store.ensureClientDocument(
        CONTRACT_CLIENT,
        { url: DOC_URL, kind: 'pdf', source: 'crawl' },
        T0,
      );

      await store.saveDocumentInspection(
        inspectionRecord({
          id: `${PLATFORM_PREFIX}-insp-old`,
          documentId: doc.id,
          inspectedAt: T0,
        }),
      );
      await store.saveDocumentInspection(
        inspectionRecord({
          id: `${PLATFORM_PREFIX}-insp-new`,
          documentId: doc.id,
          summary: inspectionSummary({ pages: 9 }),
          inspectedAt: T1,
        }),
      );
      await store.saveDocumentConversion(
        conversionRecord({ id: `${PLATFORM_PREFIX}-conv-old`, documentId: doc.id, convertedAt: T0 }),
      );
      await store.saveDocumentConversion(
        conversionRecord({
          id: `${PLATFORM_PREFIX}-conv-new`,
          documentId: doc.id,
          outputSha256: 'c'.repeat(64),
          convertedAt: T1,
        }),
      );

      const [record] = await store.listClientDocuments(CONTRACT_CLIENT);
      expect(record.latestInspection?.id).toBe(`${PLATFORM_PREFIX}-insp-new`);
      expect(record.latestInspection?.summary.pages).toBe(9);
      expect(record.latestConversion?.id).toBe(`${PLATFORM_PREFIX}-conv-new`);
      // The hashes round-trip verbatim — they are the record's teeth.
      expect(record.latestConversion?.inputSha256).toBe('a'.repeat(64));
      expect(record.latestConversion?.outputSha256).toBe('c'.repeat(64));
    });

    it('round-trips the conversion stamp and artifact pointer, absence staying absent', async () => {
      const store = await seeded();
      const doc = await store.ensureClientDocument(
        CONTRACT_CLIENT,
        { url: DOC_URL, kind: 'pdf', source: 'crawl' },
        T0,
      );

      await store.saveDocumentConversion(
        conversionRecord({
          id: `${PLATFORM_PREFIX}-conv-stored`,
          documentId: doc.id,
          instrumentVersion: 1,
          artifactUrl: `https://blob.example/documents/${PLATFORM_PREFIX}/a-random-suffix.pdf`,
        }),
      );
      await store.saveDocumentConversion(
        conversionRecord({
          id: `${PLATFORM_PREFIX}-conv-bare`,
          documentId: doc.id,
          convertedAt: T1,
        }),
      );

      const stored = await store.getDocumentConversion(`${PLATFORM_PREFIX}-conv-stored`);
      expect(stored).toMatchObject({
        instrumentVersion: 1,
        artifactUrl: `https://blob.example/documents/${PLATFORM_PREFIX}/a-random-suffix.pdf`,
      });

      // A conversion made with no blob store reads back with the fields
      // ABSENT — the shape a route's `stored` flag and the download route's
      // refusal both key on.
      const bare = await store.getDocumentConversion(`${PLATFORM_PREFIX}-conv-bare`);
      expect(bare).not.toHaveProperty('artifactUrl');
      expect(bare).not.toHaveProperty('instrumentVersion');

      expect(await store.getDocumentConversion(`${PLATFORM_PREFIX}-conv-nope`)).toBeNull();
    });

    it('keeps the first conversion when the same id is saved again', async () => {
      const store = await seeded();
      const doc = await store.ensureClientDocument(
        CONTRACT_CLIENT,
        { url: DOC_URL, kind: 'pdf', source: 'crawl' },
        T0,
      );

      await store.saveDocumentConversion(conversionRecord({ documentId: doc.id }));
      await store.saveDocumentConversion(
        conversionRecord({ documentId: doc.id, outputSha256: 'f'.repeat(64), convertedAt: T1 }),
      );

      const [record] = await store.listClientDocuments(CONTRACT_CLIENT);
      expect(record.latestConversion?.outputSha256).toBe('b'.repeat(64));
      expect(record.latestConversion?.convertedAt).toBe('2026-08-26T12:00:00.000Z');
    });

    it('scopes the inventory to its client', async () => {
      const store = await seeded();
      const otherClient = `${PLATFORM_PREFIX}-client-b`;
      await store.upsertClient({ id: otherClient, name: 'Other Client' });

      await store.ensureClientDocument(
        CONTRACT_CLIENT,
        { url: DOC_URL, kind: 'pdf', source: 'crawl' },
        T0,
      );
      await store.ensureClientDocument(
        otherClient,
        { url: 'https://elsewhere.example/budget.pdf', kind: 'pdf', source: 'crawl' },
        T0,
      );

      const urls = (await store.listClientDocuments(otherClient)).map((doc) => doc.url);
      expect(urls).toEqual(['https://elsewhere.example/budget.pdf']);
    });

    it('lists most recently seen first', async () => {
      // Distinct stamps this test chose — same-instant tie order is
      // deliberately NOT part of the contract, because the two stores
      // generate ids differently and any tie-break on them would diverge.
      const store = await seeded();
      await store.ensureClientDocument(
        CONTRACT_CLIENT,
        { url: 'https://town.example/old.pdf', kind: 'pdf', source: 'crawl' },
        T0,
      );
      await store.ensureClientDocument(
        CONTRACT_CLIENT,
        { url: 'https://town.example/new.pdf', kind: 'pdf', source: 'crawl' },
        T1,
      );

      const urls = (await store.listClientDocuments(CONTRACT_CLIENT)).map((doc) => doc.url);
      expect(urls).toEqual(['https://town.example/new.pdf', 'https://town.example/old.pdf']);
    });

    it(
      'caps the inventory, and what survives includes the most recently seen',
      async () => {
        const store = await seeded();

        await store.recordDocumentSightings(
          CONTRACT_CLIENT,
          Array.from({ length: CLIENT_DOCUMENT_LIST_MAX + 1 }, (_, i) => ({
            url: `https://town.example/archive/doc-${i}.pdf`,
            kind: 'pdf' as const,
            source: 'crawl' as const,
          })),
          T0,
        );
        await store.recordDocumentSightings(
          CONTRACT_CLIENT,
          [{ url: 'https://town.example/latest.pdf', kind: 'pdf', source: 'crawl' }],
          T1,
        );

        const listed = await store.listClientDocuments(CONTRACT_CLIENT);
        expect(listed).toHaveLength(CLIENT_DOCUMENT_LIST_MAX);
        expect(listed[0].url).toBe('https://town.example/latest.pdf');
      },
      120_000,
    );
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

      // The bottom of the clamp, which is the half that reaches the database
      // as SQL: `limit 0` returns nothing and `limit -1` is a syntax error, so
      // both have to become 1 before they get there. A fraction is floored for
      // the same reason.
      expect(await store.listEvents({ clientId: CONTRACT_CLIENT, limit: 0 })).toHaveLength(1);
      expect(await store.listEvents({ clientId: CONTRACT_CLIENT, limit: -5 })).toHaveLength(1);
      expect(await store.listEvents({ clientId: CONTRACT_CLIENT, limit: 1.9 })).toHaveLength(1);
    });

    /**
     * The filters `/api/platform/activity` and `failed-runs.yml` need.
     *
     * The workflow asks one question — how many events carry this exact action
     * inside this window — and it must be answered server-side. Counting what
     * comes back only works if what comes back is already narrowed; filtering
     * in `jq` over a page of free text would make the alert depend on how
     * busy the log is.
     *
     * The actions carry `PLATFORM_PREFIX`, so an exact-match filter isolates
     * these rows from whatever else the database holds.
     */
    describe('filters', () => {
      const WANTED = `${PLATFORM_PREFIX}-could-not-start`;
      const OTHER = `${PLATFORM_PREFIX}-something-else`;

      /**
       * A window that plainly contains everything this test wrote, and one
       * that plainly contains nothing.
       *
       * Coarse on purpose. Two consecutive writes can land in the same
       * millisecond in the memory double, so a boundary drawn between them
       * would be a coin toss rather than an assertion — and the fact under
       * test is that `since` bounds the window at its start at all.
       */
      const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const anHourAhead = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

      async function seedEvents(store: PlatformStore): Promise<void> {
        await store.upsertClient({ id: CONTRACT_CLIENT, name: 'Contract Client' });
        // Every row carries the client id even where the query below omits it,
        // so `contract-cleanup.ts` — which deletes activity by `client_id` —
        // can reach all of them.
        await store.recordEvent({ clientId: CONTRACT_CLIENT, actor: 'Scheduler', action: WANTED });
        await store.recordEvent({ clientId: CONTRACT_CLIENT, actor: 'Scheduler', action: OTHER });
      }

      it('matches an action exactly', async () => {
        const store = await makeStore();
        await seedEvents(store);

        const events = await store.listEvents({ action: WANTED });

        expect(events.map((event) => event.action)).toEqual([WANTED]);
      });

      it('bounds the window at its start', async () => {
        const store = await makeStore();
        await seedEvents(store);

        const inside = await store.listEvents({ clientId: CONTRACT_CLIENT, since: anHourAgo() });
        expect(inside.map((event) => event.action)).toContain(WANTED);

        const after = await store.listEvents({ clientId: CONTRACT_CLIENT, since: anHourAhead() });
        expect(after).toEqual([]);
      });

      it('applies the action and the window together', async () => {
        const store = await makeStore();
        await seedEvents(store);

        expect(
          (await store.listEvents({ action: WANTED, since: anHourAgo() })).map((e) => e.action),
        ).toEqual([WANTED]);
        expect(await store.listEvents({ action: WANTED, since: anHourAhead() })).toEqual([]);
      });
    });

    // The account behind the name, when there was one. Automation has none,
    // which is why the column is nullable and this is asserted both ways.
    it('records the operator account alongside the name, and copes without one', async () => {
      const store = await makeStore();
      await store.upsertClient({ id: CONTRACT_CLIENT, name: 'Contract Client' });
      await store.upsertOperator({
        id: CONTRACT_OPERATOR,
        email: `${PLATFORM_PREFIX}-actor@example.com`,
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
      await scheduled(`${PLATFORM_PREFIX}-journey-due`);

      const claimed = await store_.claimDueJourneys(10);

      expect(claimed.map((journey) => journey.id)).toContain(`${PLATFORM_PREFIX}-journey-due`);
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
      await scheduled(`${PLATFORM_PREFIX}-journey-released`);

      await store_.claimDueJourneys(10);
      expect(
        (await store_.claimDueJourneys(10)).map((journey) => journey.id),
      ).not.toContain(`${PLATFORM_PREFIX}-journey-released`);

      await store_.releaseJourneyClaim(`${PLATFORM_PREFIX}-journey-released`);

      expect((await store_.claimDueJourneys(10)).map((journey) => journey.id)).toContain(
        `${PLATFORM_PREFIX}-journey-released`,
      );
    });

    it('releases a journey that was never claimed without complaining', async () => {
      // The tick releases on any dispatch failure and cannot know whether the
      // claim landed. Throwing here would turn a failed run into a failed tick.
      await scheduled(`${PLATFORM_PREFIX}-journey-unclaimed`);

      await expect(store_.releaseJourneyClaim(`${PLATFORM_PREFIX}-journey-unclaimed`)).resolves.toBeUndefined();
      await expect(store_.releaseJourneyClaim(`${PLATFORM_PREFIX}-journey-missing`)).resolves.toBeUndefined();
    });

    /**
     * Claim and stamp are one operation, because the Neon HTTP driver has no
     * transactions: a select followed by an update would let two overlapping
     * ticks both start the same journey.
     */
    it('does not claim the same journey twice in a window', async () => {
      await scheduled(`${PLATFORM_PREFIX}-journey-once`);

      await store_.claimDueJourneys(10);
      const second = await store_.claimDueJourneys(10);

      expect(second.map((journey) => journey.id)).not.toContain(`${PLATFORM_PREFIX}-journey-once`);
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
      await scheduled(`${PLATFORM_PREFIX}-journey-race`);

      const [first, second] = await Promise.all([
        store_.claimDueJourneys(10),
        store_.claimDueJourneys(10),
      ]);

      const claims = [...first, ...second].filter((journey) => journey.id === `${PLATFORM_PREFIX}-journey-race`);
      expect(claims).toHaveLength(1);
    });

    it('leaves an unscheduled journey alone', async () => {
      await scheduled(`${PLATFORM_PREFIX}-journey-off`, { schedule: 'off' });

      const claimed = await store_.claimDueJourneys(10);

      expect(claimed.map((journey) => journey.id)).not.toContain(`${PLATFORM_PREFIX}-journey-off`);
    });

    it('leaves a journey scheduled for a different hour alone', async () => {
      await scheduled(`${PLATFORM_PREFIX}-journey-later`, { scheduleHour: (thisHour + 5) % 24 });

      const claimed = await store_.claimDueJourneys(10);

      expect(claimed.map((journey) => journey.id)).not.toContain(`${PLATFORM_PREFIX}-journey-later`);
    });

    // Scheduling a journey with no target would book a recurring failure.
    it('never claims a journey with no target URL', async () => {
      await scheduled(`${PLATFORM_PREFIX}-journey-targetless`, { targetUrl: undefined });

      const claimed = await store_.claimDueJourneys(10);

      expect(claimed.map((journey) => journey.id)).not.toContain(`${PLATFORM_PREFIX}-journey-targetless`);
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
      await scheduled(`${PLATFORM_PREFIX}-journey-blank-target`, { targetUrl: '' });

      const claimed = await store_.claimDueJourneys(10);

      expect(claimed.map((journey) => journey.id)).not.toContain(`${PLATFORM_PREFIX}-journey-blank-target`);
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
      await scheduled(`${PLATFORM_PREFIX}-journey-stepless`, { steps: [] });

      const claimed = await store_.claimDueJourneys(10);

      expect(claimed.map((journey) => journey.id)).not.toContain(`${PLATFORM_PREFIX}-journey-stepless`);
    });

    /**
     * `steps` is `jsonb`, and this column predates any write-time validation,
     * so a row can hold something that is not an array at all. Postgres needs
     * the `jsonb_typeof` guard for this: `jsonb_array_length` raises on a
     * non-array, which would take down the whole tick rather than skip one
     * journey.
     */
    it('never claims a journey whose steps are not an array', async () => {
      await scheduled(`${PLATFORM_PREFIX}-journey-badsteps`, {
        steps: { banana: 1 } as unknown as unknown[],
      });

      const claimed = await store_.claimDueJourneys(10);

      expect(claimed.map((journey) => journey.id)).not.toContain(`${PLATFORM_PREFIX}-journey-badsteps`);
    });

    it('never claims an archived journey', async () => {
      await scheduled(`${PLATFORM_PREFIX}-journey-archived`);
      await store_.archiveJourney(`${PLATFORM_PREFIX}-journey-archived`);

      const claimed = await store_.claimDueJourneys(10);

      expect(claimed.map((journey) => journey.id)).not.toContain(`${PLATFORM_PREFIX}-journey-archived`);
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
      await scheduled(`${PLATFORM_PREFIX}-journey-a`);
      await scheduled(`${PLATFORM_PREFIX}-journey-b`);
      await scheduled(`${PLATFORM_PREFIX}-journey-c`);

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
      expect(await store.getOperator(`${PLATFORM_PREFIX}-op-nobody`)).toBeNull();
      expect(await store.getOperatorByEmail(`${PLATFORM_PREFIX}-nobody@example.com`)).toBeNull();
    });

    // Upsert is by email, not id: a disabled operator keeps their row, so an
    // insert keyed on id would fail for anyone ever disabled — making "re-hire"
    // a manual psql session.
    it('updates in place when the same email is added again', async () => {
      const store = await makeStore();
      await seedOperator(store);
      await store.upsertOperator({
        id: `${PLATFORM_PREFIX}-op-a-different-id`,
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
        id: `${PLATFORM_PREFIX}-op-a-shouted`,
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
