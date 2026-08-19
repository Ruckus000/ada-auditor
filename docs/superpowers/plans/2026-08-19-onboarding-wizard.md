# Client Onboarding Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Add Client modal with a guided, record-derived onboarding wizard that carries an operator from "no clients" to a first completed audit, with replay-verified step authoring and no machine-token instructions in the UI.

**Architecture:** Two guarded routes (`/clients/new`, `/clients/<id>/setup`) that derive their stage from the database on every render — the wizard holds no state of its own. Each stage writes real rows through the existing platform APIs. One new API route (`.../journeys/<id>/preview`) replays a journey's stored steps in our Chromium without auditing or persisting anything. "Setup incomplete" is derived (`no completed run exists`), never stored.

**Tech Stack:** Next.js App Router (Server Components + small client children), zod, Playwright/Chromium via the existing `journey-runner`, Vitest (unit, api, browser/hydration suites), Neon Postgres + memory double behind shared contracts.

**Spec:** `docs/superpowers/specs/2026-08-19-onboarding-wizard-design.md` (committed). This plan is Phase 1 of that spec. Phase 2 (auto-verify per save, per-step screenshots, enrichment prompt) is explicitly not here.

**House rules that bind every task** (from AGENTS.md):
- Structured events only via `services/logger` (`logInfo`/`logWarn`) — `tests/services/log-shape.test.ts` greps for hand-built envelopes.
- New store behaviour goes in the shared contracts (`tests/support/run-store-contract.ts`) so the memory double and Postgres cannot drift.
- Contract tests run against a database holding real rows: assert with `toContain`, never `toEqual`/`toHaveLength` on unscoped lists.
- Every `(platform)` page must be wrapped in `guarded()` — `tests/app/platform-group-guarded.test.ts` enforces this per file.
- UI changes need `npm run build` + `npm run test:hydration` (axe at **zero** violations).
- Never import a `scripts/*` entry point from a test.

---

## File structure

**New files**
| Path | Responsibility |
| --- | --- |
| `src/services/setup-state.ts` | Pure stage derivation: `ClientDetail` → `SetupStage` |
| `tests/services/setup-state.test.ts` | Every record shape maps to exactly one stage |
| `src/app/(platform)/clients/new/page.tsx` | Guarded stage-1 route (sibling of `[clientId]`, so the client layout does not wrap it) |
| `src/app/platform/components/setup/new-client-screen.tsx` | Stage-1 form (client) |
| `src/app/platform/components/setup/stage-indicator.tsx` | The 3-stage progress list — hook-free, so both the server dispatcher and the client stage-1 screen render it |
| `src/app/(platform)/clients/[clientId]/setup/page.tsx` | Guarded stage 2–5 route |
| `src/app/platform/components/setup/setup-screen.tsx` | Server dispatcher + stage indicator |
| `src/app/platform/components/setup/stage-heading.tsx` | Client: focuses the stage heading on mount |
| `src/app/platform/components/setup/where-screen.tsx` | Stage 2 (client): URL, fast path, advanced environment |
| `src/app/platform/components/setup/verify-button.tsx` | Stage 3 (client): calls preview, renders outcome + screenshot |
| `src/app/platform/components/setup/first-run-control.tsx` | Stage 4 (client): run + poll (adapted from `RunJourneyButton`) |
| `src/app/platform/components/setup/start-over-button.tsx` | Failed stage (client): archives the journey |
| `src/app/api/platform/clients/[clientId]/journeys/[journeyId]/preview/route.ts` | Replay-verified preview endpoint |
| `tests/api/journey-preview.test.ts` | Preview endpoint contract |
| `tests/api/journey-archive.test.ts` | DELETE (archive) route contract |
| `docs/journeys-api.md` | The API path (curl + machine token), moved out of UI copy |

**Modified files**
| Path | Change |
| --- | --- |
| `src/domain/persistence.ts` | `ListRunsOptions.status?: RunStatus` |
| `src/integrations/persistence/memory-run-store.ts:67-78` | status filter in `list` |
| `src/integrations/persistence/postgres-run-store.ts:396-416` | status filter in `list`; signature → `ListRunsOptions` |
| `tests/support/run-store-contract.ts` | contract test for the status filter |
| `src/services/client-detail.ts` | `ClientDetail.hasCompletedRun` |
| `src/services/portfolio.ts` | `PortfolioRow.setupIncomplete` |
| `src/app/platform/lib/params.ts:64` | `/clients/new` parses as no-tab, non-client route |
| `src/app/api/platform/clients/[clientId]/journeys/[journeyId]/route.ts` | add `DELETE` (archive) |
| `src/integrations/browser/types.ts` | `JourneyRunnerInput.skipScan?: boolean` |
| `src/integrations/browser/journey-runner.ts:504` | honour `skipScan` |
| `src/app/platform/components/header.tsx:134-153` | Add-a-client → `router.push('/clients/new')` |
| `src/app/platform/components/portfolio.tsx` | empty-state button → `/clients/new`; "Finish setup" text on incomplete rows |
| `src/app/platform/lib/state.ts` | delete `modal`/`ModalName` |
| `src/app/platform/components/platform-shell.tsx:43` | delete modal host |
| `src/app/platform/components/platform-provider.tsx:65` | drop `modal: null` patch |
| `src/app/platform/components/client/client-overview.tsx` | empty states link to `/setup` |
| `src/app/platform/components/client/client-journeys.tsx` | export `StepList`; empty state loses curl copy, gains `/setup` link |
| `tests/integrations/browser/platform-hydration.test.ts` | modal test → wizard walk; axe over new routes/stages |
| `tests/app/platform-params.test.ts` | `/clients/new` cases |

**Deleted files**
| Path | Why |
| --- | --- |
| `src/app/platform/components/add-client-modal.tsx` | Replaced by `/clients/new` |

---

### Task 1: `status` filter on `RunStore.list`

The wizard's "onboarded" test is *a completed run exists*. Newest-run checks cannot answer that (a failed retry hides an old success), so the store gains a status filter, held to the shared contract.

**Files:**
- Modify: `src/domain/persistence.ts:219-224`
- Modify: `src/integrations/persistence/memory-run-store.ts:67-78`
- Modify: `src/integrations/persistence/postgres-run-store.ts:396-416`
- Test: `tests/support/run-store-contract.ts`

- [ ] **Step 1: Write the failing contract test**

In `tests/support/run-store-contract.ts`, inside the existing `describe` over `list`, add (mirror the file's existing record-builder helpers — it already builds `StoredRunRecord`s with distinct `requestId`s; scope every assertion to this test's own ids):

```ts
it('filters by status, so "a completed run exists" is one query', async () => {
  await store.saveRun(record({ requestId: 'contract-rsc-complete-1', journeyId: 'contract-rsc-journey', status: 'complete' }));
  await store.saveRun(record({ requestId: 'contract-rsc-failed-1', journeyId: 'contract-rsc-journey', status: 'failed' }));

  const completed = await store.list({ journeyId: 'contract-rsc-journey', status: 'complete' });

  expect(completed.map((run) => run.requestId)).toContain('contract-rsc-complete-1');
  expect(completed.map((run) => run.requestId)).not.toContain('contract-rsc-failed-1');
  expect(completed.every((run) => run.status === 'complete')).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- run-store` — expected: FAIL (the filter is ignored, `contract-rsc-failed-1` present).
Also run: `npm run test:db -- run-store` if a local `DATABASE_URL` is configured; otherwise note that CI covers the Postgres side.

- [ ] **Step 3: Implement**

`src/domain/persistence.ts` — extend the options type:

```ts
export type ListRunsOptions = {
  journeyId?: string;
  environment?: Environment;
  /** Only runs in this state. `complete` is what "onboarded" is derived from. */
  status?: RunStatus;
  /** Clamped by the store. A caller cannot ask for the whole table. */
  limit?: number;
};
```

`memory-run-store.ts` — add one clause to the existing filter (before the stale-run reconcile map; a `running` row that would reconcile to `failed` can never match `complete`, which is the only value the product queries):

```ts
      .filter(
        (run) =>
          (options.journeyId === undefined || run.journeyId === options.journeyId) &&
          (options.environment === undefined || run.environment === options.environment) &&
          (options.status === undefined || run.status === options.status),
      )
```

`postgres-run-store.ts` — change the signature to `async list(options: ListRunsOptions = {})` (import the type; delete the inline re-declaration) and extend the query:

```ts
    const status = options.status ?? null;

    const runs = await this.sql<RunRow>`
      select * from runs
      where (${journeyId}::text is null or journey_id = ${journeyId})
        and (${environment}::text is null or environment = ${environment})
        and (${status}::text is null or status = ${status})
      order by created_at desc, request_id desc
      limit ${limit}
    `;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- run-store` — expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/persistence.ts src/integrations/persistence/memory-run-store.ts src/integrations/persistence/postgres-run-store.ts tests/support/run-store-contract.ts
git commit -m "RunStore.list can filter by status"
```

---

### Task 2: `hasCompletedRun` on `ClientDetail`, `setupIncomplete` on `PortfolioRow`

**Files:**
- Modify: `src/services/client-detail.ts`
- Modify: `src/services/portfolio.ts`
- Test: `tests/services/client-detail.test.ts`, `tests/services/portfolio.test.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/services/client-detail.test.ts` (mirror the file's existing store-double setup):

```ts
it('reports whether any journey ever completed a run', async () => {
  // seed: one journey whose newest run failed but an older one completed
  await runs.saveRun(run({ requestId: 'cd-hcr-old', journeyId: 'cd-hcr-j', status: 'complete' }));
  await runs.saveRun(run({ requestId: 'cd-hcr-new', journeyId: 'cd-hcr-j', status: 'failed' }));
  const detail = await buildClientDetail('cd-hcr-client', deps);
  expect(detail?.hasCompletedRun).toBe(true);
});

it('a failed-only history is not a completed run', async () => {
  await runs.saveRun(run({ requestId: 'cd-hcr-f', journeyId: 'cd-hcr2-j', status: 'failed' }));
  const detail = await buildClientDetail('cd-hcr2-client', deps);
  expect(detail?.hasCompletedRun).toBe(false);
});
```

In `tests/services/portfolio.test.ts`:

```ts
it('marks a client with no completed run as setup incomplete', async () => {
  const rows = await buildPortfolio(deps);
  const fresh = rows.find((row) => row.id === 'pf-fresh-client');
  expect(fresh?.setupIncomplete).toBe(true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- client-detail portfolio` — expected: FAIL (`hasCompletedRun`/`setupIncomplete` undefined).

- [ ] **Step 3: Implement**

`client-detail.ts` — add to the type:

```ts
export type ClientDetail = {
  id: string;
  name: string;
  owner?: string;
  createdAt: string;
  journeys: JourneySummary[];
  /** The newest run across every journey, or null before the first one. */
  lastRun: RunSummary | null;
  /**
   * Whether any journey has ever finished a run. Derived, never stored — this
   * is what "onboarded" means, and what the setup screens key their terminal
   * stage on. Newest-run checks cannot answer it: a failed retry would hide an
   * old success and un-onboard a client.
   */
  hasCompletedRun: boolean;
};
```

In `buildClientDetail`, alongside the existing per-journey newest-run query:

```ts
  const completedFlags = await Promise.all(
    journeys.map(async (journey) => {
      const [completed] = await deps.runs.list({
        journeyId: journey.id,
        status: 'complete',
        limit: 1,
      });
      return completed !== undefined;
    }),
  );
```

and in the return: `hasCompletedRun: completedFlags.some(Boolean),`.

`portfolio.ts` — add `setupIncomplete: boolean;` to `PortfolioRow` (doc: *"True until the first completed run — the portfolio's 'Finish setup' hint reads this."*). In `buildPortfolio`'s per-client mapper, compute the same `completedFlags` over that client's journeys and set `setupIncomplete: !completedFlags.some(Boolean),`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- client-detail portfolio` — expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/client-detail.ts src/services/portfolio.ts tests/services/client-detail.test.ts tests/services/portfolio.test.ts
git commit -m "Derive hasCompletedRun / setupIncomplete from the record"
```

---

### Task 3: Stage derivation (`services/setup-state.ts`)

**Files:**
- Create: `src/services/setup-state.ts`
- Test: `tests/services/setup-state.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { setupStage } from '../../src/services/setup-state';
import type { ClientDetail, JourneySummary, RunSummary } from '../../src/services/client-detail';

const journey = (over: Partial<JourneySummary> = {}): JourneySummary => ({
  id: 'j1', name: 'Homepage', targetUrl: 'https://example.com/', steps: [],
  runRefusal: null, schedule: 'off', environment: 'production', credentials: [],
  lastRun: null, ...over,
});
const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  requestId: 'r1', createdAt: '2026-08-19T00:00:00.000Z', verdict: 'pass', score: 90,
  mustFix: 0, shouldFix: 0, pagesAudited: 1, evidenceStatus: 'complete',
  durationMs: 1000, slowestPageMs: 500, ...over,
});
const detail = (over: Partial<ClientDetail>): ClientDetail => ({
  id: 'c1', name: 'Acme', createdAt: '2026-08-19T00:00:00.000Z',
  journeys: [], lastRun: null, hasCompletedRun: false, ...over,
});

describe('setupStage', () => {
  it('a client with no journeys needs a site', () => {
    expect(setupStage(detail({}))).toEqual({ stage: 'site' });
  });
  it('an unrunnable journey needs steps', () => {
    const j = journey({ runRefusal: 'journey_has_no_steps' });
    expect(setupStage(detail({ journeys: [j] }))).toEqual({ stage: 'steps', journey: j });
  });
  it('a runnable journey with no run needs its first audit', () => {
    const j = journey();
    expect(setupStage(detail({ journeys: [j] }))).toEqual({ stage: 'first-run', journey: j });
  });
  it('a run in flight is watched, not restarted', () => {
    const j = journey({ lastRun: run({ verdict: 'scan' }) });
    expect(setupStage(detail({ journeys: [j] }))).toEqual({
      stage: 'running', journey: j, requestId: 'r1',
    });
  });
  it('a failed first run gets the failure stage, with the reason', () => {
    const j = journey({ lastRun: run({ verdict: 'inconclusive', failureReason: 'target_unreachable' }) });
    expect(setupStage(detail({ journeys: [j] }))).toEqual({
      stage: 'failed', journey: j, requestId: 'r1', failureReason: 'target_unreachable',
    });
  });
  it('any completed run means done, whatever the newest run did', () => {
    const j = journey({ lastRun: run({ verdict: 'inconclusive', failureReason: 'target_unreachable' }) });
    expect(setupStage(detail({ journeys: [j], hasCompletedRun: true }))).toEqual({ stage: 'done' });
  });
  it('prefers a runnable journey over an unrunnable one', () => {
    const dead = journey({ id: 'dead', runRefusal: 'journey_not_runnable' });
    const live = journey({ id: 'live' });
    expect(setupStage(detail({ journeys: [dead, live] }))).toEqual({ stage: 'first-run', journey: live });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- setup-state` — expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import type { ClientDetail, JourneySummary } from './client-detail';

/**
 * Which setup screen a client's record has earned.
 *
 * Derived on every render and stored nowhere — the wizard has no state of its
 * own, so refresh, back, and deep links cannot disagree with the database.
 * Ordering is the contract: `done` wins over everything (a completed audit is
 * completed setup, whatever happened since), and a run in flight is watched
 * rather than offered a second Run button.
 */
export type SetupStage =
  | { stage: 'site' }
  | { stage: 'steps'; journey: JourneySummary }
  | { stage: 'first-run'; journey: JourneySummary }
  | { stage: 'running'; journey: JourneySummary; requestId: string }
  | { stage: 'failed'; journey: JourneySummary; requestId: string; failureReason: string | null }
  | { stage: 'done' };

export function setupStage(detail: ClientDetail): SetupStage {
  if (detail.hasCompletedRun) return { stage: 'done' };
  if (detail.journeys.length === 0) return { stage: 'site' };

  // The wizard walks one journey to its first result. A runnable one wins so
  // an abandoned draft cannot hold the flow hostage.
  const journey = detail.journeys.find((j) => j.runRefusal === null) ?? detail.journeys[0];

  if (journey.runRefusal) return { stage: 'steps', journey };

  const lastRun = journey.lastRun;
  if (!lastRun) return { stage: 'first-run', journey };
  if (lastRun.verdict === 'scan') {
    return { stage: 'running', journey, requestId: lastRun.requestId };
  }
  // No completed run exists (first branch) and this one is not in flight:
  // the newest attempt failed. `failureReason` is absent on rows recorded
  // before failures were classified.
  return {
    stage: 'failed',
    journey,
    requestId: lastRun.requestId,
    failureReason: lastRun.failureReason ?? null,
  };
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test -- setup-state` — expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/setup-state.ts tests/services/setup-state.test.ts
git commit -m "Pure setup-stage derivation for the onboarding wizard"
```

---

### Task 4: Route grammar — `/clients/new`

`parseRoute` currently reads `/clients/new` as client slug `new`, which would mislabel the header. `/clients/<id>/setup` needs no change: the unknown third segment already falls back to the `overview` tab, which is the right highlight for a setup screen living under the client bar.

**Files:**
- Modify: `src/app/platform/lib/params.ts:64`
- Test: `tests/app/platform-params.test.ts`

- [ ] **Step 1: Write the failing tests** (append to the existing describe):

```ts
it('reads /clients/new as the add-client screen, not a client called "new"', () => {
  expect(parseRoute('/clients/new')).toEqual({
    scope: 'client', screen: 'portfolio', clientTab: 'overview', clientSlug: null,
  });
});

it('reads /clients/acme/setup as that client, overview-highlighted', () => {
  expect(parseRoute('/clients/acme/setup')).toEqual({
    scope: 'client', screen: 'portfolio', clientTab: 'overview', clientSlug: 'acme',
  });
});
```

- [ ] **Step 2: Run to verify** — `npm test -- platform-params` — first case FAILS (`clientSlug: 'new'`).

- [ ] **Step 3: Implement** — in `parseRoute`, before the existing `clients` branch:

```ts
  if (segments[0] === 'clients' && segments[1] === 'new') {
    // The add-client screen. Not a client — `clientSlug: null` keeps the
    // header from highlighting a workspace tab and from naming a client bar
    // for a record that does not exist yet.
    return { ...base, scope: 'client' };
  }
```

- [ ] **Step 4: Run to verify** — `npm test -- platform-params` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/platform/lib/params.ts tests/app/platform-params.test.ts
git commit -m "Route grammar: /clients/new is the add-client screen"
```

---

### Task 5: `DELETE` (archive) on the journey route

`archiveJourney` already exists on both stores with contract coverage (`tests/support/platform-store-contract.ts:214`). Only the HTTP surface is missing; the wizard's "start over with a different URL" needs it because PATCH deliberately refuses `targetUrl`.

**Files:**
- Modify: `src/app/api/platform/clients/[clientId]/journeys/[journeyId]/route.ts`
- Test: `tests/api/journey-archive.test.ts`

- [ ] **Step 1: Write the failing tests.** Mirror the setup/auth helpers of `tests/api/platform-journey-schedule.test.ts` (same route file, same seeding). Cases:

```ts
it('refuses an unauthenticated request', async () => {
  const response = await DELETE(request('DELETE'), params('acme', 'acme-home'));
  expect(response.status).toBe(401);
});

it("refuses another client's journey", async () => {
  const response = await DELETE(authed('DELETE'), params('other-client', 'acme-home'));
  expect(response.status).toBe(404);
});

it('archives, records who did it, and the journey leaves the list', async () => {
  const response = await DELETE(authed('DELETE'), params('acme', 'acme-home'));
  expect(response.status).toBe(200);
  const journeys = await getPlatformStore().listJourneys('acme');
  expect(journeys.map((j) => j.id)).not.toContain('acme-home');
  const events = await getPlatformStore().listEvents('acme');
  expect(events.map((e) => e.action)).toContain('archived a journey');
});

it('answers 404 for a journey already archived', async () => {
  await getPlatformStore().archiveJourney('acme-home');
  const response = await DELETE(authed('DELETE'), params('acme', 'acme-home'));
  expect(response.status).toBe(404);
});
```

- [ ] **Step 2: Run to verify** — `npm test -- journey-archive` — FAIL (`DELETE` not exported).

- [ ] **Step 3: Implement** — append to the `[journeyId]/route.ts`:

```ts
/**
 * Archive a journey. Never a hard delete: `runs` cascades from journeys, and
 * a client's audit history must survive the path that produced it being
 * retired. The wizard's "start over with a different URL" lands here, because
 * PATCH refuses `targetUrl` on purpose — re-aiming a stored journey is the
 * one edit that must not be quiet.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ clientId: string; journeyId: string }> },
) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId, journeyId } = await params;
  const platform = getPlatformStore();

  const journey = await platform.getJourney(journeyId);
  // Same ownership check as PATCH, same reasoning — and an archived journey
  // answers 404 rather than archiving twice.
  if (!journey || journey.clientId !== clientId || journey.archivedAt) {
    return Response.json({ error: 'journey_not_found', requestId }, { status: 404 });
  }

  await platform.archiveJourney(journeyId);

  await platform.recordEvent({
    clientId,
    ...actorFields(principal),
    action: 'archived a journey',
    subject: journey.name,
  });

  return Response.json({ requestId, journeyId }, { status: 200 });
}
```

- [ ] **Step 4: Run to verify** — `npm test -- journey-archive` — PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/platform/clients/[clientId]/journeys/[journeyId]/route.ts" tests/api/journey-archive.test.ts
git commit -m "Journeys can be archived over HTTP"
```

---

### Task 6: `skipScan` on the journey runner

**Files:**
- Modify: `src/integrations/browser/types.ts` (`JourneyRunnerInput`)
- Modify: `src/integrations/browser/journey-runner.ts:504`
- Test: `tests/integrations/browser/journey-runner.test.ts` (browser suite)

- [ ] **Step 1: Write the failing test** (in the existing runner test file, using its fixture-run helpers):

```ts
it('skipScan walks the journey without invoking axe', async () => {
  const result = await runJourney({ ...fixtureInput(), skipScan: true });
  expect(result.pages.length).toBe(2); // pin the walk, like the sibling tests
  for (const page of result.pages) {
    expect(page.axe.violations).toEqual([]);
    expect(page.axe.incomplete).toEqual([]);
    expect(page.axe.passCount).toBeUndefined();
    // Omitted, never 0: "no scan happened" is not "an instant scan".
    expect(page.timing.scanMs).toBeUndefined();
    // The capture half of "walk and capture" still happens.
    expect(page.artifacts.screenshotPath).toBeTruthy();
    expect(page.artifacts.domSnapshotPath).toBeTruthy();
  }
});
```

- [ ] **Step 2: Run to verify** — `npm run test:browser -- journey-runner` — FAIL (violations found on the fixture, or type error).

- [ ] **Step 3: Implement.** In `types.ts`, add to `JourneyRunnerInput`:

```ts
  /**
   * Walk and capture without evaluating rules. The preview endpoint's whole
   * point: an authoring check should cost navigation, not an audit. `passCount`
   * stays absent — "not measured" and "zero passes" are different facts.
   */
  skipScan?: boolean;
```

In `journey-runner.ts`, at the scan call site (line ~504):

```ts
      const scanStartedAt = Date.now();
      const axe = input.skipScan
        ? { violations: [], incomplete: [] }
        : await scanPageWithAxe(page);
      const scanMs = input.skipScan ? undefined : Date.now() - scanStartedAt;
```

with `PageAudit.timing.scanMs` made optional in `types.ts` and the page record
omitting it under skipScan — absent means "not measured", never 0, matching the
repo's timing doctrine. (The empty object satisfies `AxeScanResult` because
`passCount` is optional.)

**Seal the audit path in the same task:** `RunBrowserAuditInput` must become
`Omit<JourneyRunnerInput, 'steps' | 'skipScan'>` and `runBrowserAudit`'s spread
into `runJourney` must force `skipScan: undefined` — an audit never skips its
scan; the preview endpoint calls `runJourney` directly.

- [ ] **Step 4: Run to verify** — `npm run test:browser -- journey-runner` — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/integrations/browser/types.ts src/integrations/browser/journey-runner.ts tests/integrations/browser/journey-runner.test.ts
git commit -m "journey-runner can walk without scanning"
```

---

### Task 7: The preview endpoint

**Files:**
- Create: `src/app/api/platform/clients/[clientId]/journeys/[journeyId]/preview/route.ts`
- Test: `tests/api/journey-preview.test.ts`

- [ ] **Step 1: Write the failing tests.** Mirror the setup of `tests/api/platform-journey-runs.test.ts` (same auth helpers, same store seeding — it exercises the sibling runs route). Mock the runner:

```ts
vi.mock('../../src/integrations/browser/journey-runner', () => ({
  runJourney: vi.fn(),
}));
```

Cases (complete list — each is one `it`):

```ts
it('refuses an unauthenticated request', /* 401, runJourney not called */);
it("refuses another client's journey", /* 404 */);
it('refuses an unrunnable journey with the refusal code', /* journey with no steps → 422 journey_has_no_steps */);
it('refuses stored steps that are not valid steps', /* steps: [{banana:1}] → 422 invalid_journey_steps */);
it('walks the stored steps and answers pages plus a screenshot', async () => {
  vi.mocked(runJourney).mockResolvedValue({
    pages: [{ page: { url: 'https://acme.test/', route: '/', title: 'Acme' },
      html: '', axe: { violations: [], incomplete: [] }, axTree: [],
      artifacts: { screenshotPath: screenshotFixturePath }, pageKey: 'p001-root',
      timing: { totalMs: 900, scanMs: 0 } }],
    truncatedPages: 0,
  });
  const response = await POST(authed('POST'), params('acme', 'acme-home'));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.ok).toBe(true);
  expect(body.pages).toEqual([{ url: 'https://acme.test/', title: 'Acme', statusCode: undefined }]);
  expect(body.screenshot.mimeType).toBe('image/png');
  // skipScan reached the runner — the preview never pays for an audit.
  expect(vi.mocked(runJourney).mock.calls[0][0].skipScan).toBe(true);
  expect(vi.mocked(runJourney).mock.calls[0][0].omitAxTree).toBe(true);
});
it('a failed walk answers the classified code and the step sentence', async () => {
  const cause = new Error('Step 2 ("login") could not click "#go": locator timed out.');
  vi.mocked(runJourney).mockRejectedValue(
    new PartialJourneyError(cause, { pages: [], truncatedPages: 0 }),
  );
  const response = await POST(authed('POST'), params('acme', 'acme-home'));
  expect(response.status).toBe(422);
  const body = await response.json();
  expect(body.ok).toBe(false);
  expect(typeof body.error).toBe('string');
  expect(body.detail).toBe('Step 2 ("login") could not click "#go": locator timed out.');
});
it('writes no run row', /* after a successful preview: getRunStore().list() does not grow */);
it('spends the run budget', async () => {
  process.env.AUDITOR_MAX_RUNS_PER_HOUR = '1';
  await POST(authed('POST'), params('acme', 'acme-home'));       // consumes the slot
  const second = await POST(authed('POST'), params('acme', 'acme-home'));
  expect(second.status).toBe(429);
  expect((await second.json()).error).toBe('run_budget_exceeded');
});
```

(Restore mutated env vars in `afterEach`, following the conventions already in `tests/api/`. `screenshotFixturePath`: write a small real PNG to the scratch dir in `beforeAll` — `Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')` is a 1×1 PNG.)

- [ ] **Step 2: Run to verify** — `npm test -- journey-preview` — FAIL (route missing).

- [ ] **Step 3: Implement the route:**

```ts
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { environmentSchema } from '../../../../../../../../domain/contracts';
import { journeyStepSchema } from '../../../../../../../../domain/journey-step';
import { journeyRunRefusal } from '../../../../../../../../domain/platform';
import { firstForbiddenAction } from '../../../../../../../../domain/policy';
import { runJourney } from '../../../../../../../../integrations/browser/journey-runner';
import { PartialJourneyError } from '../../../../../../../../integrations/browser/partial-run';
import type { PageAudit } from '../../../../../../../../integrations/browser/types';
import { getPlatformStore } from '../../../../../../../../integrations/persistence';
import { logInfo, logWarn } from '../../../../../../../../services/logger';
import { consumeRunBudget } from '../../../../../../../../services/run-budget';
import { authorizePrincipal } from '../../../../../../_lib/authorize';
import { createRequestId } from '../../../../../../_lib/request-id';
import { getRunCounter } from '../../../../../../_lib/run-counter';
import { classifyRunFailure } from '../../../../../../_lib/run-failure';

/**
 * Verify a journey's stored steps: the runner minus the audit.
 *
 * Same ownership check, same SSRF/target guards, same `allowedHosts` union and
 * the same action policy as a real run — `runJourney` owns all of those — but
 * no axe scan, no advisory, no scoring, and **nothing persisted**. Verdicts,
 * baselines and the portfolio never see a preview. The response carries the
 * pixels inline instead: throwaway screenshots of a client's authenticated
 * pages must not enter the blob store and its lifecycle.
 *
 * It replays the *stored* steps. The editor saves first, then verifies — one
 * source of truth, no "preview of unsaved steps" variant to disagree with it.
 *
 * It spends the shared run budget. Browser time against a client's live site
 * is the cost `AUDITOR_MAX_RUNS_PER_HOUR` exists to cap, and a preview is
 * exactly that; a free variant would be the loophole.
 */

// Launches Chromium, exactly like the runs route beside it.
export const runtime = 'nodejs';
export const maxDuration = 300;

/** Inline bytes cap: base64 adds a third, and the platform rejects function
 *  responses past ~4.5 MB — a successful preview must not die at that layer. */
const MAX_INLINE_SCREENSHOT_BYTES = 3_000_000;

/** The last screenshot the walk wrote, inlined; null when nothing captured;
 *  'omitted' when it exists but would blow the response ceiling. */
async function lastScreenshot(
  pages: PageAudit[],
): Promise<{ mimeType: string; base64: string } | 'omitted' | null> {
  const path = [...pages].reverse().find((p) => p.artifacts.screenshotPath)?.artifacts
    .screenshotPath;
  if (!path) return null;
  try {
    const bytes = await readFile(path);
    if (bytes.byteLength > MAX_INLINE_SCREENSHOT_BYTES) return 'omitted';
    return { mimeType: 'image/png', base64: bytes.toString('base64') };
  } catch {
    // A missing file degrades the preview, it does not fail it.
    return null;
  }
}
```

(The route spreads `screenshot` when inlined and `screenshotOmitted: true` when
capped, on both paths. `new URL(targetUrl)` is guarded — a malformed legacy
target answers 422 `journey_not_runnable`, never a 500 — and the 429 path logs
`run_budget_exceeded` like `startRun` does.)

```ts

/** What a screen needs to say "the walk reached these pages" — nothing else. */
function pageMeta(pages: PageAudit[]) {
  return pages.map((p) => ({
    url: p.page.url,
    title: p.page.title,
    statusCode: p.page.statusCode,
  }));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string; journeyId: string }> },
) {
  const requestId = createRequestId();

  const principal = await authorizePrincipal(request);
  if (!principal) {
    return Response.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const { clientId, journeyId } = await params;
  const platform = getPlatformStore();

  const journey = await platform.getJourney(journeyId);
  // Same check as the runs route: naming any journey under any client's URL
  // must not walk it.
  if (!journey || journey.clientId !== clientId || journey.archivedAt) {
    return Response.json({ error: 'journey_not_found', requestId }, { status: 404 });
  }

  const refusal = journeyRunRefusal(journey);
  if (refusal) {
    return Response.json({ error: refusal, requestId, journeyId }, { status: 422 });
  }

  const validated = z.array(journeyStepSchema).safeParse(journey.steps);
  if (!validated.success) {
    return Response.json({ error: 'invalid_journey_steps', requestId, journeyId }, { status: 422 });
  }

  const environment = environmentSchema.safeParse(journey.environment).data ?? 'production';

  // Refused before a browser launches, not at step N of a client's live site.
  const forbidden = firstForbiddenAction(validated.data, environment);
  if (forbidden) {
    return Response.json(
      { error: 'action_not_allowed_here', requestId, action: forbidden },
      { status: 422 },
    );
  }

  const budget = await consumeRunBudget(getRunCounter());
  if (!budget.allowed) {
    return Response.json(
      {
        error: 'run_budget_exceeded',
        requestId,
        window: budget.window,
        resetsInSeconds: budget.resetsInSeconds,
      },
      { status: 429 },
    );
  }

  // The target's own host plus anything the journey named — the same union
  // `runBrowserAudit` builds, for the same reason.
  const targetUrl = journey.targetUrl as string; // journeyRunRefusal guarantees it
  const allowedHosts = [new URL(targetUrl).hostname, ...(journey.allowedHosts ?? [])];

  // Always under tmpdir, never the repo's artifacts/: these files exist only
  // long enough to be read back into the response.
  const artifactsDir = join(tmpdir(), 'preview-artifacts', requestId);
  const startedAt = Date.now();

  try {
    const result = await runJourney({
      journeyId: journey.id,
      environment,
      stepId: 'preview',
      fixtureDir: join(process.cwd(), 'fixtures/journey-app'),
      artifactsDir,
      steps: validated.data,
      targetUrl,
      allowedHosts,
      omitAxTree: true,
      skipScan: true,
    });

    const screenshot = await lastScreenshot(result.pages);
    logInfo('journey_preview', {
      requestId,
      journeyId,
      pages: result.pages.length,
      durationMs: Date.now() - startedAt,
    });

    return Response.json({
      requestId,
      ok: true,
      pages: pageMeta(result.pages),
      truncatedPages: result.truncatedPages,
      ...(screenshot ? { screenshot } : {}),
    });
  } catch (error) {
    const partial = error instanceof PartialJourneyError ? error.captured.pages : [];
    const message = error instanceof Error ? error.message : 'preview_failed';
    const code = classifyRunFailure(message, error instanceof Error ? error.name : undefined);
    const screenshot = await lastScreenshot(partial);

    logWarn('journey_preview_failed', {
      requestId,
      journeyId,
      reason: code,
      pages: partial.length,
      durationMs: Date.now() - startedAt,
    });

    return Response.json(
      {
        requestId,
        ok: false,
        error: code,
        // Only the step sentence `attemptStep` composes — the classifier's
        // `journey_step_failed` anchor only matches those runner-authored,
        // value-free lines. Any other error (SSRF refusals carry full URLs,
        // fs errors carry paths) stays a bare code, the same rule the run
        // handler applies.
        ...(code === 'journey_step_failed' && error instanceof PartialJourneyError
          ? { detail: (message.split('\n')[0] ?? '').trim() }
          : {}),
        ...(partial.length ? { truncatedPages: (error as PartialJourneyError).captured.truncatedPages } : {}),
        pages: pageMeta(partial),
        ...(screenshot ? { screenshot } : {}),
      },
      { status: 422 },
    );
  } finally {
    await rm(artifactsDir, { recursive: true, force: true }).catch(() => {});
  }
}
```

- [ ] **Step 4: Run to verify** — `npm test -- journey-preview` — PASS. Also `npm test -- log-shape` (the two log calls must satisfy the envelope test).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/platform/clients/[clientId]/journeys/[journeyId]/preview/route.ts" tests/api/journey-preview.test.ts
git commit -m "Preview endpoint: replay a journey's stored steps, audit nothing"
```

---

### Task 8: Stage 1 — `/clients/new`, and the modal's deletion

**Files:**
- Create: `src/app/(platform)/clients/new/page.tsx`
- Create: `src/app/platform/components/setup/new-client-screen.tsx`
- Create: `src/app/platform/components/setup/stage-indicator.tsx`
- Delete: `src/app/platform/components/add-client-modal.tsx`
- Modify: `src/app/platform/lib/state.ts` (drop `modal` + `ModalName`), `src/app/platform/components/platform-shell.tsx:43` (drop the modal host and its import), `src/app/platform/components/platform-provider.tsx:65` (drop `modal: null` from `goWorkspace`), `src/app/platform/components/header.tsx:134-153` (button → `router.push('/clients/new')`; the header already has no `useRouter`, add it), `src/app/platform/components/portfolio.tsx` (empty-state button → `router.push('/clients/new')`)

- [ ] **Step 1: The page** (`clients/new/page.tsx`). `guarded()` is mandatory — `tests/app/platform-group-guarded.test.ts` fails otherwise:

```tsx
import { getPlatformStore } from '../../../../integrations/persistence';
import { NewClientScreen } from '../../../platform/components/setup/new-client-screen';
import { guarded } from '../../guard';

/**
 * Stage 1 of onboarding: the client. A route rather than a modal so it can be
 * linked, resumed and tested like every other screen — and so browser-back
 * from the setup stages has somewhere honest to land.
 */
export default guarded(async function NewClientPage() {
  // For the duplicate hint only. Names are not secrets to an operator who can
  // already read the whole portfolio.
  const clients = await getPlatformStore().listClients();

  return <NewClientScreen existingNames={clients.map((client) => client.name)} />;
});
```

- [ ] **Step 1b: The stage indicator** (`stage-indicator.tsx`) — created here because stage 1 shows it too (decided 2026-08-19); Task 9's dispatcher reuses it:

```tsx
import { FONT, T } from '../../lib/tokens';

/**
 * Where the operator is in onboarding. A list, not tabs: stages are earned by
 * the record, never clicked into. Hook-free on purpose — the server dispatcher
 * (Task 9) and the client stage-1 screen both render it.
 */
const STAGE_LABELS = ['Client', 'Site & path', 'First audit'] as const;

export function StageIndicator({ current }: { current: 0 | 1 | 2 }) {
  return (
    <nav aria-label="Setup progress">
      <ol style={{ display: 'flex', gap: 18, margin: 0, padding: 0, listStyle: 'none' }}>
        {STAGE_LABELS.map((label, index) => (
          <li
            key={label}
            aria-current={index === current ? 'step' : undefined}
            style={{
              fontFamily: FONT.sans,
              fontSize: 12.5,
              fontWeight: index === current ? 650 : 400,
              color: index === current ? T.accent : index < current ? T.inkSoft : T.inkMuted,
            }}
          >
            {index + 1}. {label}
            {index < current ? ' ✓' : ''}
          </li>
        ))}
      </ol>
    </nav>
  );
}
```

- [ ] **Step 2: The screen** (`new-client-screen.tsx`). Complete file — **with these
  post-review corrections applied over the snippet below** (the snippet predates the
  a11y review; the corrections are the authority where they disagree):
  - Title via `ScreenHeading` (h1), never a bare h2 — `page-has-heading-one` gates.
  - The duplicate hint's `role="status"` span is ALWAYS mounted with its text toggled,
    and its id always sits in the name input's `aria-describedby` (toast.tsx's rule).
  - Submit uses `inertWhen(...)` (lib/inert-button), not `disabled`, with the
    empty-name guard moved into the submit handler.
  - `autoFocus` on the name input (the modal's behavior, restored).
  - State holds the error CODE; `aria-invalid`/`-error` describedby apply only for
    `invalid_request_body` — page-level failures don't describe the name field.
  - StageIndicator: `role="list"` on the ol, ✓ aria-hidden with a visually-hidden
    "(complete)".

  Snippet:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { usePlatform } from '../../lib/state';
import { FONT, T } from '../../lib/tokens';
import { StageIndicator } from './stage-indicator';

/**
 * Stage 1: name the client. The Add Client modal, promoted to a route and
 * given the two things the modal never had — human error copy and a duplicate
 * hint — because this is now the front door of a flow, not a detour.
 */
const MESSAGES: Record<string, string> = {
  invalid_request_body: 'Check the client’s name — it needs 1 to 120 characters.',
  unauthorized: 'Your session expired. Reload and sign in again.',
};

export function NewClientScreen({ existingNames }: { existingNames: string[] }) {
  const { actions } = usePlatform();
  const router = useRouter();
  const nameId = useId();
  const ownerId = useId();

  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const duplicate = existingNames.some(
    (existing) => existing.trim().toLowerCase() === name.trim().toLowerCase(),
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/platform/clients', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, ...(owner.trim() ? { owner: owner.trim() } : {}) }),
      });

      const body = (await response.json().catch(() => null)) as
        | { error?: string; client?: { id: string } }
        | null;

      if (!response.ok || !body?.client) {
        setError(
          (body?.error && MESSAGES[body.error]) ??
            `Could not add the client (${response.status}). Try again.`,
        );
        setSaving(false);
        return;
      }

      actions.flash(`${name.trim()} added.`);
      // `replace`, not `push`: browser-back from the setup stages must land on
      // the portfolio, not on an empty create form that reads as "edit".
      router.replace(`/clients/${body.client.id}/setup`);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setSaving(false);
    }
  }

  return (
    <div data-screen-label="Add a client" style={{ maxWidth: 520 }}>
      <div style={{ marginBottom: 14 }}>
        <StageIndicator current={0} />
      </div>
      <h2 style={{ margin: '0 0 4px', fontSize: 19, fontWeight: 700, letterSpacing: '-0.01em' }}>
        Add a client
      </h2>
      <p style={{ margin: '0 0 18px', fontFamily: FONT.sans, fontSize: 13.5, color: T.inkSoft }}>
        Then say where we audit, and run their first audit — about two minutes end to end.
      </p>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label htmlFor={nameId} style={labelStyle}>
            Client name
          </label>
          <input
            id={nameId}
            value={name}
            maxLength={120}
            required
            placeholder="Rosewood Dental"
            onChange={(event) => setName(event.target.value)}
            aria-invalid={error !== null && MESSAGES.invalid_request_body === error ? true : undefined}
            aria-describedby={`${nameId}-note${error ? ` ${nameId}-error` : ''}`}
            style={inputStyle}
          />
          <span id={`${nameId}-note`} style={noteStyle}>
            Used for their address, e.g. /clients/rosewood-dental.
          </span>
          {duplicate ? (
            <span role="status" style={{ ...noteStyle, color: T.inkSoft }}>
              You already have a client named {name.trim()} — adding this one creates a second
              client, not an update.
            </span>
          ) : null}
        </span>

        <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label htmlFor={ownerId} style={labelStyle}>
            Owner
          </label>
          <input
            id={ownerId}
            value={owner}
            maxLength={120}
            placeholder="Optional"
            onChange={(event) => setOwner(event.target.value)}
            aria-describedby={`${ownerId}-note`}
            style={inputStyle}
          />
          <span id={`${ownerId}-note`} style={noteStyle}>
            Who at your agency answers for this account.
          </span>
        </span>

        {error ? (
          <p id={`${nameId}-error`} role="alert" style={errorStyle}>
            {error}
          </p>
        ) : null}

        <span style={{ display: 'flex', gap: 10 }}>
          <button
            type="submit"
            disabled={saving || name.trim() === ''}
            className="ph-primary"
            style={{
              padding: '9px 18px',
              border: 'none',
              borderRadius: 9,
              background: T.accent,
              color: '#fff',
              fontFamily: FONT.sans,
              fontSize: 12.5,
              fontWeight: 650,
              opacity: saving || name.trim() === '' ? 0.55 : 1,
              cursor: saving || name.trim() === '' ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Adding…' : 'Add client'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="ph-ghost"
            style={{
              padding: '9px 15px',
              borderRadius: 9,
              border: `1px solid ${T.rule}`,
              background: '#fff',
              fontFamily: FONT.sans,
              fontSize: 12.5,
              fontWeight: 600,
              color: T.inkSoft,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </span>
      </form>
    </div>
  );
}

const labelStyle = {
  fontFamily: FONT.sans,
  fontSize: 12,
  fontWeight: 650,
  color: T.inkSoft,
} as const;

const inputStyle = {
  padding: '9px 11px',
  borderRadius: 8,
  border: `1px solid ${T.rule}`,
  background: '#fff',
  fontFamily: FONT.sans,
  fontSize: 13.5,
  color: T.ink,
} as const;

const noteStyle = {
  fontFamily: FONT.sans,
  fontSize: 11.5,
  color: T.inkMuted,
} as const;

const errorStyle = {
  margin: 0,
  padding: '9px 12px',
  borderRadius: 8,
  background: T.failWash,
  border: `1px solid ${T.failEdge}`,
  color: T.failDeep,
  fontFamily: FONT.sans,
  fontSize: 12.5,
} as const;
```

- [ ] **Step 3: Delete the modal and unhook it.**
  - `git rm src/app/platform/components/add-client-modal.tsx`
  - `state.ts`: delete `export type ModalName = 'addClient' | null;` and the `modal: ModalName;` field (and `modal: null` in `INITIAL_STATE`).
  - `platform-shell.tsx`: delete the `AddClientModal` import and the `{state.modal === 'addClient' ? <AddClientModal /> : null}` line; `state` may become unused — destructure only `actions` if so, or drop `usePlatform` if nothing else reads it (the `Toast` reads its own context; check and remove what is dead).
  - `platform-provider.tsx`: in `goWorkspace`, delete `setEphemeral((prev) => ({ ...prev, modal: null }));`.
  - `header.tsx`: add `import { useRouter } from 'next/navigation';`, `const router = useRouter();`, and change the button's `onClick` to `() => router.push('/clients/new')`.
  - `portfolio.tsx`: the empty state's button `onClick` becomes `() => router.push('/clients/new')` (a `router` is already in scope).

- [ ] **Step 3b: Reserve the slug `new` in `clientIdFromName`.** This task creates the static route that shadows any client whose id is `new`, so the minter must never produce it. In `src/services/portfolio.ts`, `clientIdFromName`:

```ts
/** Ids that are routes, not clients: a client minted onto one would be shadowed. */
const RESERVED_CLIENT_IDS = ['new'];

export function clientIdFromName(name: string, taken: readonly string[] = []): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'client';

  if (!taken.includes(base) && !RESERVED_CLIENT_IDS.includes(base)) {
    return base;
  }

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.includes(candidate) && !RESERVED_CLIENT_IDS.includes(candidate)) {
      return candidate;
    }
  }
}
```

Failing test first, in `tests/services/portfolio.test.ts`'s `clientIdFromName` describe:

```ts
it('never mints a reserved route as an id', () => {
  expect(clientIdFromName('New')).toBe('new-2');
});
```

Also fix the mechanism claim in the `/clients/new` comment in `src/app/platform/lib/params.ts` (landed in Task 4 with wording that attributes the header behavior to `clientSlug`): reword to "Not a client: `scope: 'client'` keeps the header from highlighting a workspace tab, and `clientSlug` stays null because there is no record to name yet."

- [ ] **Step 4: Fix compile fallout and run the fast suite.**

Run: `npx tsc --noEmit` then `npm test` — expected: everything green except any test that referenced the modal (`grep -rn "addClient\|AddClientModal" tests/ src/` must come back empty outside the hydration suite, which Task 12 rewrites).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Stage 1: /clients/new replaces the Add Client modal"
```

---

### Task 9: The setup route, dispatcher, and stage indicator

**Files:**
- Create: `src/app/(platform)/clients/[clientId]/setup/page.tsx`
- Create: `src/app/platform/components/setup/setup-screen.tsx`
- Create: `src/app/platform/components/setup/stage-heading.tsx`

- [ ] **Step 1: The page:**

```tsx
import { notFound } from 'next/navigation';
import { setupStage } from '../../../../../services/setup-state';
import { SetupScreen } from '../../../../platform/components/setup/setup-screen';
import { loadClient } from '../load';
import { guarded } from '../../../guard';

/**
 * Stages 2–5 of onboarding, derived from the record on every render. The
 * wizard has no memory: refresh, back and deep links land on whatever stage
 * the data has earned, and a finished client sees the results summary — not a
 * redirect, so the page is idempotent.
 */
export default guarded(async function ClientSetupPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const detail = await loadClient(clientId);

  if (!detail) notFound();

  return <SetupScreen detail={detail} stage={setupStage(detail)} />;
});
```

- [ ] **Step 2: The heading focuser** (`stage-heading.tsx`) — one tiny client component so a screen-reader user hears where the flow moved:

```tsx
'use client';

import { useEffect, useRef } from 'react';

/**
 * The stage's h2, focused on mount. Stage changes re-render the server page,
 * so "on mount" is exactly "on stage change" — no state to coordinate.
 */
export function StageHeading({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <h2
      ref={ref}
      tabIndex={-1}
      style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-0.01em', outline: 'none' }}
    >
      {children}
    </h2>
  );
}
```

- [ ] **Step 3: The dispatcher** (`setup-screen.tsx`) — server component. Stage components for 2–5 arrive in Tasks 10–11; to keep this task shippable, create them as minimal placeholders here and fill them in the next tasks (each placeholder renders its `StageHeading` and nothing else — never merged beyond the next two tasks):

```tsx
import type { ClientDetail } from '../../../../services/client-detail';
import type { SetupStage } from '../../../../services/setup-state';
import { FailedStage } from './failed-stage';
import { FirstRunStage } from './first-run-stage';
import { ResultsStage } from './results-stage';
import { StageIndicator } from './stage-indicator';
import { StepsStage } from './steps-stage';
import { WhereScreen } from './where-screen';

/**
 * One of five stages, plus the indicator that says which (`StageIndicator`,
 * shared with `/clients/new`, which renders it at stage 0).
 */
function stageIndex(stage: SetupStage['stage']): 0 | 1 | 2 {
  if (stage === 'site' || stage === 'steps') return 1;
  return 2; // first-run, running, failed, done
}

export function SetupScreen({ detail, stage }: { detail: ClientDetail; stage: SetupStage }) {
  const current = stageIndex(stage.stage);

  return (
    <div data-screen-label="Client setup" style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }}>
      <StageIndicator current={current} />

      {stage.stage === 'site' ? <WhereScreen clientId={detail.id} /> : null}
      {stage.stage === 'steps' ? <StepsStage detail={detail} journey={stage.journey} /> : null}
      {stage.stage === 'first-run' ? <FirstRunStage detail={detail} journey={stage.journey} /> : null}
      {stage.stage === 'running' ? (
        <FirstRunStage detail={detail} journey={stage.journey} runningRequestId={stage.requestId} />
      ) : null}
      {stage.stage === 'failed' ? (
        <FailedStage detail={detail} journey={stage.journey} failureReason={stage.failureReason} />
      ) : null}
      {stage.stage === 'done' ? <ResultsStage detail={detail} /> : null}
    </div>
  );
}
```

- [ ] **Step 4: Verify the guard test still passes and the group compiles.**

Run: `npm test -- platform-group-guarded && npx tsc --noEmit` — expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(platform)/clients/[clientId]/setup" src/app/platform/components/setup/
git commit -m "Setup route: record-derived stage dispatch"
```

---

### Task 10: Stage 2 — Where do we audit? (fast path + multi-page)

**Files:**
- Create (replacing the Task 9 placeholder): `src/app/platform/components/setup/where-screen.tsx`

(Note: `StageIndicator` renders once in the Task 9 dispatcher — stage components must not render a second one.)

- [ ] **Step 1: Implement.** Client component. Complete behaviour: schemeless normalization, the homepage fast path (auto `goto` step preserving the pasted path), the multi-page choice (journey with no steps → stage flips to `steps`), environment behind a disclosure, `MESSAGES` map:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { FONT, T } from '../../lib/tokens';
import { StageHeading } from './stage-heading';

const MESSAGES: Record<string, string> = {
  invalid_request_body: 'That does not look like a URL we can audit. Check it and try again.',
  unauthorized: 'Your session expired. Reload and sign in again.',
  inline_credential: 'A step carried a credential of its own. Use a stored credential by name instead.',
};

/** `rosewooddental.com` is what people paste; a scheme is what `new URL` needs. */
function normalizeUrl(raw: string): URL | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim())
    ? raw.trim()
    : `https://${raw.trim()}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function WhereScreen({ clientId }: { clientId: string }) {
  const router = useRouter();
  const urlId = useId();
  const [raw, setRaw] = useState('');
  const [mode, setMode] = useState<'homepage' | 'journey'>('homepage');
  const [environment, setEnvironment] = useState<'production' | 'preview' | 'staging'>('production');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;

    const url = normalizeUrl(raw);
    if (!url) {
      setError('That does not look like a URL we can audit. Check it and try again.');
      return;
    }

    setSaving(true);
    setError(null);

    // The fast path writes the one step it needs itself — the target URL's own
    // path, not "/", so a pasted /shop stays audited as /shop.
    const body =
      mode === 'homepage'
        ? {
            name: 'Homepage',
            targetUrl: url.toString(),
            environment,
            steps: [
              { action: 'navigate', type: 'goto', path: `${url.pathname}${url.search}` || '/' },
            ],
          }
        : { name: 'First journey', targetUrl: url.toString(), environment };

    try {
      const response = await fetch(`/api/platform/clients/${clientId}/journeys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const parsed = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(
          (parsed?.error && MESSAGES[parsed.error]) ??
            `Could not save that (${response.status}). Try again.`,
        );
        setSaving(false);
        return;
      }

      // The record changed; the stage derives from it. Refresh, don't route.
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StageHeading>Where do we audit?</StageHeading>
      <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13.5, color: T.inkSoft, maxWidth: 480 }}>
        Every audit walks a recorded path through the client’s site and reports what a real user
        would hit. Start with their homepage — you can record deeper paths after the first result.
      </p>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label htmlFor={urlId} style={{ fontFamily: FONT.sans, fontSize: 12, fontWeight: 650, color: T.inkSoft }}>
            Their website
          </label>
          <input
            id={urlId}
            value={raw}
            required
            placeholder="rosewooddental.com"
            inputMode="url"
            onChange={(event) => setRaw(event.target.value)}
            aria-invalid={error ? true : undefined}
            style={{
              padding: '9px 11px', borderRadius: 8, border: `1px solid ${T.rule}`,
              background: '#fff', fontFamily: FONT.mono, fontSize: 13, color: T.ink,
            }}
          />
        </span>

        <fieldset style={{ margin: 0, padding: 0, border: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend style={{ fontFamily: FONT.sans, fontSize: 12, fontWeight: 650, color: T.inkSoft, padding: 0 }}>
            What should the first audit cover?
          </legend>
          <label style={radioLabel}>
            <input
              type="radio"
              name="mode"
              checked={mode === 'homepage'}
              onChange={() => setMode('homepage')}
            />{' '}
            Start with the homepage (recommended) — one page, audited now.
          </label>
          <label style={radioLabel}>
            <input
              type="radio"
              name="mode"
              checked={mode === 'journey'}
              onChange={() => setMode('journey')}
            />{' '}
            Record a multi-page journey — a checkout, a booking, a sign-in. You’ll add the steps
            next.
          </label>
        </fieldset>

        <details>
          <summary style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted, cursor: 'pointer' }}>
            Advanced: where this journey runs
          </summary>
          <label style={{ ...radioLabel, display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            Environment{' '}
            <select
              value={environment}
              onChange={(event) => setEnvironment(event.target.value as typeof environment)}
              style={{ fontFamily: FONT.sans, fontSize: 12.5, padding: '5px 8px', borderRadius: 8, border: `1px solid ${T.rule}` }}
            >
              <option value="production">Production (read-only, the default)</option>
              <option value="preview">Preview</option>
              <option value="staging">Staging</option>
            </select>
          </label>
        </details>

        {error ? (
          <p role="alert" style={{ margin: 0, padding: '9px 12px', borderRadius: 8, background: T.failWash, border: `1px solid ${T.failEdge}`, color: T.failDeep, fontFamily: FONT.sans, fontSize: 12.5 }}>
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={saving || raw.trim() === ''}
          className="ph-primary"
          style={{
            alignSelf: 'flex-start', padding: '9px 18px', border: 'none', borderRadius: 9,
            background: T.accent, color: '#fff', fontFamily: FONT.sans, fontSize: 12.5, fontWeight: 650,
            opacity: saving || raw.trim() === '' ? 0.55 : 1,
            cursor: saving || raw.trim() === '' ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}

const radioLabel = {
  fontFamily: FONT.sans,
  fontSize: 13,
  color: T.ink,
} as const;
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit && npm test` — PASS (behavioural coverage lands in the hydration task; this stage is driven end-to-end there).

- [ ] **Step 3: Commit**

```bash
git add src/app/platform/components/setup/where-screen.tsx
git commit -m "Stage 2: URL + homepage fast path + multi-page choice"
```

---

### Task 11: Stages 3–5 — steps + verify, first run, failure, results

**Files:**
- Create (replacing placeholders): `src/app/platform/components/setup/steps-stage.tsx`, `verify-button.tsx`, `first-run-stage.tsx`, `first-run-control.tsx`, `start-over-button.tsx`, `failed-stage.tsx`, `results-stage.tsx`
- Modify: `src/app/platform/components/client/client-journeys.tsx` (add `export` to `StepList`), `src/app/platform/components/client/client-overview.tsx` (add `export` to `Stat`)

- [ ] **Step 1: `steps-stage.tsx`** (server component — the editor and credential list are the existing, already-redacting components):

```tsx
import type { ClientDetail, JourneySummary } from '../../../../services/client-detail';
import { FONT, T } from '../../lib/tokens';
import { JourneyStepsEditor } from '../client/journey-steps-editor';
import { StepList } from '../client/client-journeys';
import { StageHeading } from './stage-heading';
import { VerifyButton } from './verify-button';

/**
 * Stage 3: the path, in the same structured editor the journeys screen uses —
 * same policy, same redaction, same tests. "Verify so far" is the only thing
 * this stage adds: a walk in a real browser, no audit, nothing saved.
 */
export function StepsStage({ detail, journey }: { detail: ClientDetail; journey: JourneySummary }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StageHeading>Record the path</StageHeading>
      <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13.5, color: T.inkSoft, maxWidth: 480 }}>
        Add the steps a real user takes — go to a page, click, fill, then say what “arrived”
        looks like. Save them, then verify: we walk the path in a real browser and show you where
        it ends up. Nothing is audited or saved by a verify.
      </p>

      <JourneyStepsEditor
        clientId={detail.id}
        journeyId={journey.id}
        journeyName={journey.name}
        environment={journey.environment}
        steps={journey.steps}
      >
        <StepList steps={journey.steps} />
      </JourneyStepsEditor>

      <VerifyButton clientId={detail.id} journeyId={journey.id} journeyName={journey.name} />
    </div>
  );
}
```

- [ ] **Step 2: `verify-button.tsx`:**

```tsx
'use client';

import { useState } from 'react';
import { describeRunFailure } from '../../lib/run-failure-copy';
import { FONT, T } from '../../lib/tokens';
import { inertWhen } from '../../lib/inert-button';

const MESSAGES: Record<string, string> = {
  journey_not_runnable: 'This journey has no target URL, so nothing can walk it.',
  journey_has_no_steps: 'Save at least one step first.',
  invalid_journey_steps: 'These stored steps are not ones a walk could follow.',
  run_budget_exceeded: 'The run budget for this window is used up. Try again later.',
  unauthorized: 'Your session expired. Reload and sign in again.',
};

type Outcome =
  | { kind: 'ok'; pages: Array<{ url: string; title: string }>; screenshot?: { mimeType: string; base64: string } }
  | { kind: 'failed'; error: string; detail?: string; pages: Array<{ url: string; title: string }>; screenshot?: { mimeType: string; base64: string } };

export function VerifyButton({
  clientId,
  journeyId,
  journeyName,
}: {
  clientId: string;
  journeyId: string;
  journeyName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setBusy(true);
    setError(null);
    setOutcome(null);

    try {
      const response = await fetch(
        `/api/platform/clients/${clientId}/journeys/${journeyId}/preview`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      );
      const body = (await response.json().catch(() => null)) as
        | (Outcome extends never ? never : Record<string, unknown>)
        | null;

      if (!body) {
        setError('Could not read the server’s answer. Try again.');
      } else if (response.ok) {
        setOutcome({ kind: 'ok', pages: body.pages as Outcome['pages'], screenshot: body.screenshot as never });
      } else if (typeof body.error === 'string' && MESSAGES[body.error] && !('ok' in body)) {
        setError(MESSAGES[body.error]);
      } else {
        setOutcome({
          kind: 'failed',
          error: String(body.error ?? 'preview_failed'),
          ...(typeof body.detail === 'string' ? { detail: body.detail } : {}),
          pages: (body.pages ?? []) as Outcome['pages'],
          screenshot: body.screenshot as never,
        });
      }
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          {...inertWhen(busy, verify)}
          aria-label={`Verify ${journeyName} so far`}
          style={{
            alignSelf: 'flex-start', fontFamily: FONT.sans, fontSize: 12.5, fontWeight: 600,
            padding: '6px 12px', borderRadius: 8, border: `1px solid ${T.rule}`,
            background: busy ? T.surfaceSunk : T.surface, color: busy ? T.inkMuted : T.ink,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Walking the path…' : 'Verify so far'}
        </button>
        <span role="status" style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.inkMuted }}>
          {busy ? 'Walking the path in a real browser — usually under a minute.' : ''}
        </span>
      </span>

      {error ? (
        <p role="alert" style={{ margin: 0, fontFamily: FONT.sans, fontSize: 12.5, color: T.fail }}>
          {error}
        </p>
      ) : null}

      {outcome ? (
        <div
          style={{
            display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px',
            borderRadius: 10, border: `1px solid ${outcome.kind === 'ok' ? T.rule : T.failEdge}`,
            background: T.surface,
          }}
        >
          <span role="status" style={{ fontFamily: FONT.sans, fontSize: 13, fontWeight: 650 }}>
            {outcome.kind === 'ok'
              ? `The path works — walked ${outcome.pages.length} ${outcome.pages.length === 1 ? 'page' : 'pages'}, ended on “${outcome.pages[outcome.pages.length - 1]?.title ?? 'an untitled page'}”.`
              : 'The walk stopped before the end.'}
          </span>
          {outcome.kind === 'failed' ? (
            <span style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.inkSoft }}>
              {outcome.detail ?? describeRunFailure(outcome.error)}
            </span>
          ) : null}
          {outcome.screenshot ? (
            <img
              src={`data:${outcome.screenshot.mimeType};base64,${outcome.screenshot.base64}`}
              alt={`Screenshot of the last page the walk reached${outcome.pages.length ? `: ${outcome.pages[outcome.pages.length - 1]?.title}` : ''}`}
              style={{ maxWidth: '100%', borderRadius: 8, border: `1px solid ${T.rule}` }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: `first-run-control.tsx`** — copy `RunJourneyButton`'s poll mechanics verbatim (`POLL_INTERVAL_MS`, `MAX_POLLS`, the `cancelled` ref and cleanup effect, the same `MESSAGES` map) with three changes: the button label is "Run the first audit", the `aria-label` is `Run the first audit of ${journeyName}`, and both the completion path and the `slow` path call `router.refresh()` (the stage rederives to `done`, `failed`, or stays `running`). No refusal branch — the stage dispatcher only renders it for a runnable journey.

- [ ] **Step 4: `first-run-stage.tsx`:**

```tsx
import type { ClientDetail, JourneySummary } from '../../../../services/client-detail';
import { FONT, T } from '../../lib/tokens';
import { FirstRunControl } from './first-run-control';
import { StageHeading } from './stage-heading';

export function FirstRunStage({
  detail,
  journey,
  runningRequestId,
}: {
  detail: ClientDetail;
  journey: JourneySummary;
  runningRequestId?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StageHeading>{runningRequestId ? 'First audit running…' : 'Run the first audit'}</StageHeading>
      <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13.5, color: T.inkSoft, maxWidth: 480 }}>
        {runningRequestId
          ? 'A real browser is walking the path and evaluating every page it reaches. This page will show the results when it finishes — usually under a minute.'
          : `This walks “${journey.name}” in a real browser, evaluates every page against ~100 accessibility rules, and saves the results — scored, on the record.`}
      </p>
      <FirstRunControl
        clientId={detail.id}
        journeyId={journey.id}
        journeyName={journey.name}
        alreadyRunning={Boolean(runningRequestId)}
      />
    </div>
  );
}
```

(`FirstRunControl` with `alreadyRunning` starts in the `running` phase and begins polling `/api/audit/runs/<requestId>`… it does not have the requestId. Pass `pollUrl={runningRequestId ? `/api/audit/runs/${runningRequestId}` : undefined}` instead and start polling it on mount — mirror the poll loop it already has.)

- [ ] **Step 5: `start-over-button.tsx` and `failed-stage.tsx`:**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FONT, T } from '../../lib/tokens';

/**
 * Archives the wizard's journey and returns the flow to "where do we audit".
 * Archive, not delete — the label says so, because the row and any runs it
 * produced survive in the database.
 */
export function StartOverButton({ clientId, journeyId }: { clientId: string; journeyId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startOver() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/platform/clients/${clientId}/journeys/${journeyId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        setError(`Could not archive the journey (${response.status}).`);
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {error ? (
        <span role="alert" style={{ fontFamily: FONT.sans, fontSize: 12.5, color: T.fail }}>
          {error}
        </span>
      ) : null}
      <button
        type="button"
        onClick={startOver}
        disabled={busy}
        style={{
          fontFamily: FONT.sans, fontSize: 12.5, fontWeight: 600, padding: '6px 12px',
          borderRadius: 8, border: `1px solid ${T.rule}`, background: T.surface,
          color: T.inkSoft, cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy ? 'Archiving…' : 'Archive this journey and start over with a different URL'}
      </button>
    </span>
  );
}
```

`failed-stage.tsx` (server): `StageHeading` "The first audit stopped", the classified reason through `describeRunFailure(failureReason ?? 'audit_run_failed')`, then — in order — the embedded `JourneyStepsEditor` + `StepList` + `VerifyButton` (fix the path), a `FirstRunControl` ("Run again"), and the `StartOverButton`. Every affordance the spec's failure state names, on one screen, no dead end.

- [ ] **Step 6: `results-stage.tsx`** (server) — the terminal stage:

```tsx
import Link from 'next/link';
import type { ClientDetail } from '../../../../services/client-detail';
import { FONT, T } from '../../lib/tokens';
import { Stat } from '../client/client-overview';
import { JourneySchedule } from '../client/journey-schedule';
import { StageHeading } from './stage-heading';

/**
 * Stage 5, and the page a finished client keeps: the first audit's numbers,
 * the way into the findings, and — now that the operator has seen what a run
 * is — the schedule. Idempotent: revisiting /setup shows the latest summary.
 */
export function ResultsStage({ detail }: { detail: ClientDetail }) {
  const run = detail.lastRun;
  const journey = detail.journeys.find((j) => j.runRefusal === null) ?? detail.journeys[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <StageHeading>First audit complete</StageHeading>

      {run ? (
        <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, margin: 0 }}>
          <Stat label="Score" value={run.score === null ? '—' : String(run.score)} />
          <Stat label="Must fix" value={String(run.mustFix)} tone={run.mustFix > 0} />
          <Stat label="Should fix" value={String(run.shouldFix)} />
          <Stat label="Pages audited" value={String(run.pagesAudited)} />
        </dl>
      ) : null}

      <span style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <Link
          href={`/clients/${detail.id}/findings`}
          style={{
            padding: '9px 18px', borderRadius: 9, background: T.accent, color: '#fff',
            fontFamily: FONT.sans, fontSize: 12.5, fontWeight: 650, textDecoration: 'none',
          }}
        >
          Go to the findings
        </Link>
        {journey ? (
          <JourneySchedule
            clientId={detail.id}
            journeyId={journey.id}
            journeyName={journey.name}
            schedule={journey.schedule}
            runRefusal={journey.runRefusal}
          />
        ) : null}
      </span>
    </div>
  );
}
```

- [ ] **Step 7: Exports.** In `client-journeys.tsx` change `function StepList` to `export function StepList`; in `client-overview.tsx` change `function Stat` to `export function Stat`.

- [ ] **Step 8: Verify** — `npx tsc --noEmit && npm test && npm run build` — PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/platform/components/setup/ src/app/platform/components/client/client-journeys.tsx src/app/platform/components/client/client-overview.tsx
git commit -m "Stages 3-5: steps + verify, first run, failure recovery, results"
```

---

### Task 12: Copy sweep — the machine token leaves the UI

**Files:**
- Modify: `src/app/platform/components/client/client-journeys.tsx` (empty state), `src/app/platform/components/client/client-overview.tsx` (empty states), `src/app/platform/components/portfolio.tsx` (row hint), `src/app/platform/components/header.tsx:155-162` (stale comment)
- Create: `docs/journeys-api.md`

- [ ] **Step 1: `client-journeys.tsx`** — replace the empty state (the curl + bearer-token text) with:

```tsx
        <Empty
          title="No journeys yet"
          body="A journey is the path we re-walk on every run — a checkout, a booking, a sign-in. Finish this client's setup to record the first one and run it."
          action={{ href: `/clients/${detail.id}/setup`, label: 'Finish setup' }}
        />
```

- [ ] **Step 2: `client-overview.tsx`** — the no-journeys empty state gains the same action (`{ href: `/clients/${detail.id}/setup`, label: 'Finish setup' }`) and its body drops "Record one and this page fills in" for "Finish setup to say where we audit and run the first audit."; the has-journeys/no-runs state keeps its "See the journeys" action.

- [ ] **Step 3: `portfolio.tsx`** — in the client-name cell, under the journey count, when `client.setupIncomplete`:

```tsx
                    {client.setupIncomplete ? (
                      <span style={{ fontFamily: FONT.sans, fontSize: 11, color: T.accent, fontWeight: 650 }}>
                        Setup incomplete
                      </span>
                    ) : null}
```

(Text, not a link — the row is already a button, and a nested interactive control is an axe violation. The row lands on the overview, which carries the "Finish setup" link.) Add `client.setupIncomplete ? ', setup incomplete' : ''` into the row's `aria-label` so the hint is announced too.

- [ ] **Step 4: `header.tsx`** — rewrite the stale avatar comment (lines 155-162) to say the name is the signed-in operator's, resolved by the platform layout, with the configured fallback for machine principals.

- [ ] **Step 5: `docs/journeys-api.md`** — the API path, moved out of product copy:

```markdown
# Journeys over the API

For CI and scripts. Operators use the console — these endpoints exist so a
pipeline can register and run journeys with the machine credential
(`AUDITOR_RUN_TOKEN`), which is deliberately not something the UI teaches
humans to hold: what it does is not attributed to a person.

Create a journey:

    curl -X POST https://<host>/api/platform/clients/<clientId>/journeys \
      -H "authorization: Bearer $AUDITOR_RUN_TOKEN" \
      -H "content-type: application/json" \
      -d '{"name":"Checkout","targetUrl":"https://client.example/",
           "steps":[{"action":"navigate","type":"goto","path":"/"}]}'

Run it: `POST /api/platform/clients/<clientId>/journeys/<journeyId>/runs`.
Verify without auditing: `POST .../journeys/<journeyId>/preview`.
Archive: `DELETE .../journeys/<journeyId>`.

Steps must satisfy `authoredStepSchema` (`src/domain/journey-step.ts`).
Credentials are always `credentialRef` — a literal password in a step body is
refused as `inline_credential`.
```

- [ ] **Step 6: Verify** — `grep -rn "bearer token" src/app/platform src/app/components` returns nothing; `npm test && npm run build` — PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/platform/components/ docs/journeys-api.md
git commit -m "Copy sweep: setup links everywhere, machine token out of the UI"
```

---

### Task 13: Hydration suite — the wizard is the front door now

**Files:**
- Modify: `tests/integrations/browser/platform-hydration.test.ts`

- [ ] **Step 1: Rewrite the modal test** (`'starts with an empty portfolio and adds a client through the modal'`, line 273) as the wizard walk. Same position (first, so the client it creates serves the later tests), same store-round-trip philosophy:

```ts
it('starts with an empty portfolio and onboards a client through the wizard', async () => {
  const page = await openAuthenticatedPage();
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => isHydrated(page, 'button'), { timeout: 15_000 }).toBe(true);
    expect(await page.innerText('body')).toContain('No clients yet');

    // Stage 1: the client. A route now, not a modal.
    await page.getByRole('button', { name: 'Add the first client', exact: true }).click();
    await expect.poll(() => page.url(), { timeout: 15_000 }).toContain('/clients/new');
    await page.getByLabel('Client name').fill('Harness Client');
    await page.getByLabel('Owner').fill('Alex Reed');
    await page.getByRole('button', { name: 'Add client', exact: true }).click();

    // Stage 2 renders from the record; the URL is the client's setup route.
    await expect.poll(() => page.url(), { timeout: 15_000 }).toContain('/clients/harness-client/setup');
    await expect.poll(() => page.innerText('body')).toContain('Where do we audit?');

    // The homepage fast path writes the journey and its one step itself.
    await page.getByLabel('Their website').fill('https://wizard-target.invalid/shop');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // A runnable journey with no run: the first-audit stage.
    await expect.poll(() => page.innerText('body'), { timeout: 15_000 }).toContain('Run the first audit');

    // The fast path preserved the pasted path — the record says so.
    const journeys = (await (
      await fetch(`${BASE}/api/platform/clients/harness-client/journeys`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      })
    ).json()) as { journeys: Array<{ id: string; steps: Array<{ path?: string }> }> };
    expect(journeys.journeys[0].steps[0].path).toBe('/shop');

    // Run it. `.invalid` cannot resolve, so this is the failure stage's test:
    // the operator's first failure must explain itself and offer a way back.
    await page.getByRole('button', { name: /Run the first audit/ }).click();
    await expect
      .poll(() => page.innerText('body'), { timeout: 120_000, intervals: [3000] })
      .toContain('The first audit stopped');
    const failedBody = await page.innerText('body');
    expect(failedBody).toContain('Verify so far');           // the editor path back
    expect(failedBody).toContain('start over');              // the URL path back

    // Complete a run through the fixture path under the same journey, then the
    // terminal stage renders — idempotent, no redirect.
    const journeyId = journeys.journeys[0].id;
    await fetch(`${BASE}/api/audit/run?wait=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ journeyId, environment: 'preview' }),
    });
    await page.goto(`${BASE}/clients/harness-client/setup`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.innerText('body'), { timeout: 15_000 }).toContain('First audit complete');
    expect(await page.innerText('body')).toContain('Go to the findings');
  } finally {
    await page.close();
  }
}, 240_000);
```

Adjust the assertions that the old modal test carried (operator avatar name, "Never audited" on the portfolio) into a short follow-on check of `/` after the wizard walk, so nothing the old test proved goes unproven.

- [ ] **Step 2: Axe coverage.** Add `'/clients/new'` to the suite's `ROUTES` list (zero-violation loop at line 978). For the setup stages — which need the runtime-created client — add one test after the wizard walk that runs the suite's existing `AxeBuilder` pattern (with `ENABLED_BY_US`) against `/clients/harness-client/setup` in its terminal state, and against `/clients/new`, asserting zero violations. Also assert focus: after Stage 2 renders, `document.activeElement` is the stage heading (`page.evaluate(() => document.activeElement?.tagName)` → `'H2'`).

- [ ] **Step 3: Sweep stale references.** The later hydration tests that seed journeys over the API keep working (the API is unchanged). Any assertion on the journeys empty state's old curl copy must move to the new copy ("Finish setup").

- [ ] **Step 4: Run the full gauntlet.**

```bash
npm run build && npm run test:hydration
```

Expected: PASS, axe at zero on every route including the wizard.

- [ ] **Step 5: Commit**

```bash
git add tests/integrations/browser/platform-hydration.test.ts
git commit -m "Hydration: the wizard is the front door, axe-zero included"
```

---

### Task 14: Full verification

- [ ] **Step 1:** `npm test` — fast suite green.
- [ ] **Step 2:** `npm run test:browser` — browser suite green (runner `skipScan` test included).
- [ ] **Step 3:** `npm run test:db` — store contracts green against Postgres (status filter). Skip only if no local `DATABASE_URL`; say so in the report.
- [ ] **Step 4:** `npm run chaos` — steady-state green.
- [ ] **Step 5:** `npm run build` — clean.
- [ ] **Step 6:** `npm run test:hydration` — wizard walk + axe-zero green.
- [ ] **Step 7:** Report results with the actual output. Per AGENTS.md, no "done" claim without all six fresh.

---

## Self-review (completed at planning time)

- **Spec coverage:** stage table → Task 3; fast path + URL normalization + path preservation → Task 10 + hydration assertion; store-then-verify preview, inline screenshot, budget, no-run-row → Tasks 6–7; failure-stage affordances incl. archive-and-recreate → Tasks 5, 11; modal deletion + `replace` navigation + duplicate hint → Task 8; derived resume + portfolio/overview links → Tasks 2, 12; machine token out of UI + docs → Task 12; axe-zero + focus + error-copy maps → Tasks 8–13. Phase 2 items deliberately absent.
- **Type consistency:** `SetupStage` shapes in Task 3 match the dispatcher in Task 9; `hasCompletedRun` (Task 2) is consumed by Task 3's tests and Task 9's page; `skipScan` (Task 6) matches the preview call (Task 7); `StepList`/`Stat` exports (Task 11) match their imports.
- **Known execution-time checks** (verify, don't assume): exact helper names in the mirrored test files (`tests/api/platform-journey-runs.test.ts`, `platform-journey-schedule.test.ts`, contract files); whether `platform-shell.tsx` still needs `usePlatform` after the modal host goes; `FirstRunControl`'s poll-on-mount wiring for the `running` stage.
