# ADA Auditor — Agent Guide

This file is the project-level operating manual for coding agents (Cursor `AGENTS.md` / Claude.md equivalent). Follow it unless the user explicitly overrides it.

## Product

Evidence-first ADA/WCAG **accessibility risk auditor** for authenticated multi-step web apps. Hybrid system: deterministic checks + AI advisory. Not a legal certification authority.

Primary sources of truth:

- Spec: [`docs/superpowers/specs/2026-07-28-ada-auditor-design.md`](docs/superpowers/specs/2026-07-28-ada-auditor-design.md)
- Implementation plan: [`docs/superpowers/plans/2026-07-28-ada-auditor.md`](docs/superpowers/plans/2026-07-28-ada-auditor.md)

## Netflix-aligned engineering philosophy (non-negotiable)

User-locked principles for this repo:

1. **Chaos / steady-state confidence**
2. **Full-cycle: operate what you build**

Supporting Netflix practices we adopt:

- **Context, not control** — encode contracts and steady-state definitions; avoid process theater
- **Paved road** — one audit core; platform adapters enrich at the edge; opt-in adapters, not forked products
- **Minimize blast radius** — especially on customer production
- **Automate experiments continuously** — chaos hypotheses live as tests/scripts, not one-off manuals
- **Data over opinion** — CI/chaos results decide readiness to scale breadth

### Dual production surfaces

| Surface | Meaning | Blast radius |
|---|---|---|
| **Auditor platform** | Our Vercel-hosted control plane (APIs, cron, runners) | Chaos allowed with gates (`CHAOS_ENABLED`), auto-stop, structured logs |
| **Customer targets** | Sites/apps we audit | Production = strict action policy (mostly read-only); preview/staging richer; never exploratory destructive self-healing in customer prod |

### Steady-state rules (must not regress)

- Incomplete evidence → `ciStatus: 'inconclusive'` (never `pass`, never `fail`).
  Evidence is per page and the run takes the worst: one page missing an
  artifact makes the whole run inconclusive
- Deterministic findings from incomplete evidence are **rejected**, per page
- Every page a journey navigates to is audited — never only the last one — and
  every deterministic finding carries the `pageUrl` it was found on
- Explicit `platformHint` wins over rendered-DOM heuristics
- AI advisory is independent of deterministic hits; `gateable: false` in v1
- Run contracts are enforced (scope, confidence `minReport`, `failureMode`)
- Forbidden production actions never execute
- A run may only navigate to hosts in `scope.allowedDomains`; an empty scope
  denies everything rather than allowing it
- Credentials are referenced, never inlined — no secret in a request body, a
  stored journey, or a run log

### Full-cycle expectations

Anyone shipping a feature also ships:

- tests (prefer TDD: red → green → refactor)
- structured observability for new failure modes
- chaos/steady-state coverage when the change affects reliability semantics
- operable deploy path on **Vercel** (no “ops later”)

## Architecture boundaries

Follow `YAGNI → KISS → SRP → DRY`.

- `/src/domain` — contracts, policy, evidence, platforms (no HTTP/framework imports beyond validation libs)
- `/src/services` — orchestration (rule mapping, reporting, AI advisory, ax-tree pruning). Must not import Playwright or axe-core: browser work belongs in integrations, and keeping services framework-free is what keeps them in the fast unit suite, which excludes `tests/integrations/browser/**`.
- `/src/integrations` — browser, AI providers, platform adapters, schedulers
- `/src/app` or `/src/api` — Next.js / Vercel edges only
- Framework code at the edges; business rules in the center

`n8n` may orchestrate around the core; it must not become the audit brain.

## Testing policy

- Domain/service unit tests required for contract and reporting changes
- Chaos-style regressions required for steady-state claims (incomplete evidence, hint conflicts, scope fail-closed, complete-evidence CI fail path)
- Do not claim “done” without fresh `npm test`, `npm run test:browser`, `npm run test:db`, `npm run chaos` and `npm run build` evidence
- The fast suite launches no browser and opens no socket. New store behaviour
  goes in a shared contract (`tests/support/run-store-contract.ts`,
  `platform-store-contract.ts`) so the in-memory doubles and Postgres cannot
  drift apart — a double that quietly disagrees makes the fast suite green
  about behaviour production does not have
- Shared contracts run against a database that already holds real rows, so
  scope every assertion. `listClients()` and `listEvents()` take no filter that
  can isolate them: assert with `toContain`, never `toEqual`/`toHaveLength`
- Keep browser launches out of the unit suite. Handler tests mock the audit; the real browser is covered by `tests/integrations/browser/**` and by chaos.
- When adding Vercel routes: add route/handler tests or chaos script assertions for terminal statuses
- Before claiming a change works end to end, run one real audit through
  `next start` (not just `next dev`). Vitest loads modules unbundled, so
  packaging faults reach production with every suite green
- Never import a `scripts/*` entry point from a test. They call `main()` at
  import, so the test runs the script: importing `migrate.ts` for one pure
  helper silently migrated the real database on every local `npm test`, and
  failed CI outright where no database exists. Extract the pure part into its
  own module and test that
- `npm run test:hydration` also runs our own axe engine against our own
  screens, asserted at **zero** violations. A threshold would be a budget for
  shipping barriers, which is not a position this product can hold. It found
  two real defects the first time it ran
- `AUDITOR_STORE=memory` is the only way to run the built server without a
  database, and exists for the hydration suite in CI. It is an explicit opt-in,
  never a fallback for a missing `DATABASE_URL` — a fallback would let a
  misconfigured deploy serve an empty portfolio and discard runs in silence.
  The ephemeral stores hang off `globalThis`, because Next bundles route
  handlers and pages separately and a module-level singleton would give each
  its own store
- UI changes additionally need `npm run test:hydration` (after `npm run
  build`). It drives the built app in a real browser and asserts the pages are
  *alive* — React attached, navigation changes the URL. An entirely inert UI
  once passed `tsc`, 453 unit tests and a clean build, because none of them
  can see whether a page hydrated

## Current status

Implemented and verified locally + on Vercel preview:

- Domain contracts, evidence, policy, platforms
- **Rule engine: axe-core (~100 rules) against the live page.** One finding per
  offending element, each carrying a selector, WCAG success criteria, a
  conformance level, a help URL and a snippet. The scan runs in
  `integrations/browser/axe-scan.ts`; `services/deterministic-audit.ts` maps its
  plain-data output and imports neither Playwright nor axe-core.
- **AI advisory: a real `claude-opus-5` call** with strict tool use, over the
  pruned accessibility tree plus axe's undecided checks. Judges what rules
  cannot — alt text that says nothing, headings used for size, error text that
  does not say what to fix. Gated on `ANTHROPIC_API_KEY`; absent or failing, the
  run completes without it. Always `gateable: false`.
- **Real targets.** `POST /api/audit/run` takes `targetUrl` and `steps`. Every
  target is checked on scheme, host, all resolved addresses, and again on the
  URL the page settled on after each navigation.
- **Multi-page runs.** `runJourney` scans after every navigation and returns
  `{ pages, truncatedPages }`; each page carries its own axe results, AX tree
  and artifact set under `runs/<requestId>/<pageKey>/`. Findings carry
  `pageUrl`, evidence is per page and the run takes the worst, and pages per
  run are capped (`AUDITOR_MAX_PAGES_PER_RUN`, default 20) with a
  `audit_page_cap_reached` log when the cap truncates a journey. The AI
  advisory runs **once over the aggregate**, not per page — N× cost otherwise,
  and cross-page issues only exist in aggregate.
- Reporting (`pass|fail|inconclusive`), regression comparison keyed on
  rule + page + selector
- **Conformance score**: `passed / (passed + failed)` over the checks axe
  actually evaluated (`services/score.ts`, pure). Undecided checks are in
  neither term — they are the human-review queue — advisory findings never
  touch it, and a run without complete evidence scores `null` rather than
  zero, because the denominator is unknown. Stored with `score_version` so a
  formula change cannot silently reinterpret historical runs. Note a run can
  score well and still fail CI: one critical finding fails a run regardless of
  the rate.
- **Vocabulary mapping lives in `services/presentation/`**, not beside the
  components: deciding whether the product says `pass` or "we could not tell"
  is a business rule with a steady-state contract behind it. `VerdictKind`
  carries `inconclusive` as a first-class outcome, and severity maps 5→5 —
  folding `needs-review` into a low-priority bucket would delete the
  human-review queue, and folding `advisory` anywhere would contradict
  `gateable: false`.
- **Triage is keyed on finding identity, per client** (`finding_triage`), never
  on the per-run `findings` row: `saveRun` deletes and reinserts a run's
  children on every write, so triage stored there would not survive one run.
  `fixed` is derived from the next run's absence, never stored.
- **Persistence: Neon Postgres** (Vercel Marketplace), schema in
  `src/integrations/persistence/schema.sql`, applied by `npm run migrate`.
  `run_pages` is a first-class table because a run is a journey and a journey
  is several pages. `RunStore` gained `list` — the gap called out in the
  Phase 1 plan — served by `GET /api/audit/runs`. `FileRunStore` and
  `KvRunStore` are deleted, not deprecated; `MemoryRunStore` is a test double
  only, and both stores are held to one shared contract.
- `GET /api/audit/runs`, `runs/latest`, `runs/[requestId]`
- **Readiness distinguishes broken from degraded.** `/api/ready` gates on the
  run token and the run store — `createRunStore()` fails closed without
  `DATABASE_URL`, but only on the first audit, long after the deploy that broke
  it. Anything non-fatal is reported in `warnings` instead, and the console
  renders `needs-store` rather than "cannot reach the service", which would
  send an operator to check the wrong thing.
- Chromium everywhere: the installed browser locally and in CI,
  `@sparticuz/chromium` on Vercel (`integrations/browser/launch.ts`).
  `@axe-core/playwright` and `axe-core` are in `serverExternalPackages`
  alongside them: axe is injected into the page as a *source string*, so
  bundling it breaks every run made through the app.
- **Console: findings grouped by page.** `groupFindingsByPage` in
  `app/components/audit-types.ts` (pure, unit-tested) drives the grouping; the
  evidence panel lists each audited page with its own artifact checklist, and
  a truncated run says so.
- Tests: Vitest unit + browser suites green; `npm run chaos` green

### Phase 2C — where it stopped

Slices 0, 1 and 3 are merged. Slice 2 onward is blocked on one product
decision nobody has made:

**How does a real client get into the system?** The database has one
`client-unassigned` row and whatever journeys runs have materialised. The
screens still read eight invented clients from `data.ts`.

**Answered:** the portfolio starts **empty** and an operator adds clients. The
alternative — seeding the eight fixture clients as real rows — is a faster demo
that puts invented client names in a real database, which is the exact thing
this phase exists to remove. Starting empty also makes the first-run state the
normal state rather than a screen nobody sees until the first real customer.
Slices 2 and 4-6 follow from that.

### Known gaps

Read this before claiming something works.

- **The unlock throttle can be memory-only.** Redis used to be required on
  Vercel because the run store needed it. The run store is Postgres now, so
  nothing forces Upstash to exist, and without it the throttle counts attempts
  in process memory — per-instance, reset on every cold start. No longer
  silent: `/api/ready` reports `unlockThrottleDurable` and warns, and the
  console shows it. It does not gate readiness, because a degraded security
  speed bump is not a reason to serve 503 to every operator. The real defence
  remains a high-entropy token.
- **The catalog tables still have no UI behind them.** `clients`, `journeys`,
  `client_config`, `reports`, `activity_events` and `finding_triage` now have a
  store and a tested contract, and `journeys` materialises on every run — but
  only the screens read or write the rest, and the screens land slice by slice
  through Phase 2C. Until then they are reachable but mostly empty.
- **The UI at `/` is still mostly a fixture prototype.** The portfolio is real
  — it lists what `clients` holds, starts empty, and the add-client modal posts
  to `/api/platform/clients`. Everything under `/clients/<slug>` is still
  `data.ts`, which is why the `[clientId]` layout only accepts fixture slugs:
  **a client added through the UI has nowhere to click through to yet.** Slice 4
  builds that page. Until it lands, do not remove the `knownSlug` guard — its
  fallback renders the *first* fixture client under any address. See
  `docs/superpowers/plans/2026-08-07-phase-2.md`.
- **The screens are still ~700 KB of shared client JavaScript**, most of it
  `data.ts` plus `ui.tsx`, `header.tsx` and `derive.ts`. The fixture half goes
  when `data.ts` does in slice 6. Route-specific code is split correctly
  (`components/routes/*`, one module per screen) — measured, not assumed.
- **A page cap of 20 is a guess, not a measurement.** No real journey has been
  run against it. If real journeys exceed it, that is the signal for a
  container worker rather than a bigger number.
- **Neither test suite exercises the app's own bundle.** Vitest loads modules
  unbundled, so a packaging fault in the Next build is invisible to all 344
  tests — which is exactly how `@axe-core/playwright` shipped with its
  injected source mangled by the bundler and every run through the app failing
  while the suites stayed green. The only thing that catches this class of bug
  is running a real audit through `next start`. Do that before claiming a
  change works end to end.

- **A run still cannot outlive one function invocation.** `maxDuration` is 300s
  (the Hobby ceiling; Pro allows 800s). The 202 + poll shape unblocks the caller
  but does not add compute — background work is bounded by the same limit. A
  real site-wide crawl needs a container worker, not a bigger number here.
- **The console still blocks.** It calls `?wait=1`, because its run flow renders
  a result rather than polling. The async shape is there for API and CI callers.
- **No tenancy.** One shared `AUDITOR_RUN_TOKEN`, a flat `journeyId:environment`
  keyspace, and `accountId: 'acct-demo'` hardcoded. Any authenticated caller can
  read any run by guessing a journeyId.
- **The UI at `/` is mostly a fixture prototype.** The portfolio reads the
  database; the client screens behind it do not. The working surface for a real
  audit is still `/console`.

## Agent behavior

- Do not invent Netflix process that isn’t grounded in these rules
- Prefer multitask/parallel agents for independent files/phases; serialize shared contract changes
- Do not edit plan files the user attached unless asked
- Ask before destructive git operations; commit only when asked (unless the user explicitly requests committing as part of the phase)
